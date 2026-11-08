import { getDateInputValidationReason } from '@/lib/date-format'
import { PreHeatTreatmentDateError } from '@/lib/pre-heat-treatment-control-updates'
import { requireDb } from '@/db'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPreHeatTreatmentFillItems, groupPreHeatTreatmentFillItems, type PreHeatTreatmentFillOptions, type PreHeatTreatmentFillGroup } from '@/lib/pre-heat-treatment-fill'
import { PRE_HEAT_TREATMENT_LNK_METHODS, isPreHeatTreatmentLnkAvailable, type PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import { normalizeSystemDocumentSplitSettings, SYSTEM_DOCUMENT_SPLIT_MODES } from '@/lib/system-document-splitting'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { assertWorkflowSelectionLimit } from '@/lib/workflow-selection-limit'
import { assertNoNewLnkChronologyIssues, type LnkChronologyIssueKind } from '@/lib/lnk-chronology-checks'
import { getLayeredControlSaveError } from '@/lib/layered-control-rules'
import { loadControlProcessSettingsFromTransaction } from './control-process-settings'
import { readPreHeatTreatmentChain } from './pre-heat-treatment-chain'
import { lockWeldLineMembershipsForWeldIds, haveSameWeldLineMemberships } from './weld-line-membership-lock'
import { lockInteractiveWeldRows } from './weld-row-version'
import { attachHeatTreatmentControlRelations } from './heat-treatment-control-relations'
import { attachDuplicateControlRelations } from './duplicate-control-relations'
import { assertSecurityScope } from './security-functions'
import { requireContextPermission } from './access-payload'
import { hashJsonRecordTuple } from './json-record-token'
import { loadWeldWorkflowSettingsFromTransaction } from './weld-workflow-settings'
import { readRequestConclusionSettings, reserveSystemDocumentNames, lockSystemDocumentNumberCounter, type SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildGroupWrites, getSequenceRequest, savePreHeatTreatmentControlWrites, syncPreHeatTreatmentDocuments, persistPreHeatTreatmentTouchedRows } from './pre-heat-treatment-lnk-workflow'
import { assertNewDocumentNamesAvailable, prepareDocumentCreationIndex, DocumentNameOccupiedError } from './document-name-conflicts'
import { assignCreatedDocumentSpecialists, loadSelectedSpecialists } from './specialists'
import { getSpecialistDocumentProfile, resolveDocumentSpecialists } from '@/lib/document-specialists'
import { readSpecialistDefaults } from './specialist-defaults'
import { lockDocumentGroupingPreference, rememberDocumentGrouping } from './document-grouping-preferences'
import { assertStoredEarlyCoilDecisionSourcesRemainValid } from './early-coil-decision-guard'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'
import { beginDocumentSaveReceipt, finishDocumentSaveReceipt } from './document-save-receipt'

const PRIMARY_LNK_STAGE_DEBT_ISSUE_KINDS = new Set<LnkChronologyIssueKind>(['post-before-psto-cycle'])
const PRE_HEAT_FILL_CHANGED = 'Данные или настройки НК до ТО изменились после открытия окна. Ничего не сохранено. Закройте окно заполнения, откройте его заново и проверьте состав документов.'
type Tx = SystemDocumentSequenceTransaction
export type PreHeatTreatmentFillRequest = { rowIds: number[]; chainRootId?: number; options: PreHeatTreatmentFillOptions }

function normalizeInput(input: PreHeatTreatmentFillRequest): PreHeatTreatmentFillRequest {
  if (!Array.isArray(input?.rowIds) || input.rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Выберите стыки для заполнения.')
  const rowIds = [...new Set(input.rowIds)].sort((a, b) => a - b)
  assertWorkflowSelectionLimit(rowIds)
  if (input.chainRootId !== undefined && (!Number.isSafeInteger(input.chainRootId) || input.chainRootId <= 0)) throw new Error('Не указан исходный стык.')
  if (Object.values(input.options?.splitModes ?? {}).some(mode => !SYSTEM_DOCUMENT_SPLIT_MODES.includes(mode))) throw new Error('Неизвестный вариант разделения.')
  return { rowIds, ...(input.chainRootId ? { chainRootId: input.chainRootId } : {}), options: input.options ?? {} }
}

/** Same process → counter → membership → row order as ordinary document creation. */
export async function lockPreHeatTreatmentFillCounters(tx: Tx) {
  await loadControlProcessSettingsFromTransaction(tx)
  await lockDocumentGroupingPreference(tx, { settingId: 'lnkRequest', mode: 'none' })
  const ids = ['lnkRequest', ...PRE_HEAT_TREATMENT_LNK_METHODS.map(method => getSystemDocumentTemplateId({ type: 'lnkConclusion', methodCode: method.code }))].sort()
  for (const id of ids) await lockSystemDocumentNumberCounter(tx, id as Parameters<typeof lockSystemDocumentNumberCounter>[1])
}

async function readFillRows(tx: Tx, input: PreHeatTreatmentFillRequest) {
  await lockPreHeatTreatmentFillCounters(tx)
  if (input.chainRootId) {
    requireContextPermission('welding.view')
    const context = await readPreHeatTreatmentChain(tx, input.chainRootId)
    if (context.chain.reason) throw new Error(context.chain.reason)
    if (context.root.id !== input.chainRootId) throw new Error('Откройте карточку исходного стыка.')
    // The card confirms the flag and documents together; preview itself writes nothing.
    return context.rows.map(row => ({ ...row, preHeatTreatmentRequired: true }))
  }
  const memberships = await lockWeldLineMembershipsForWeldIds(tx, input.rowIds)
  const stored = await lockInteractiveWeldRows(tx, input.rowIds)
  if (stored.length !== input.rowIds.length || !haveSameWeldLineMemberships(memberships, stored)) throw new Error(PRE_HEAT_FILL_CHANGED)
  const rows = await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(stored, tx), tx)
  return rows.filter(isPreHeatTreatmentLnkAvailable)
}

const reference = (group: PreHeatTreatmentFillGroup) => ({ type: group.action === 'request' ? 'lnkRequest' as const : 'lnkConclusion' as const,
  title: group.name, date: group.date, sourceKind: 'beforeHeatTreatment' as const,
  ...(group.action === 'result' ? { methodCode: group.positions[0]?.methodCode } : {}) })

export async function planPreHeatTreatmentFill(tx: Tx, rows: WeldRow[], options: PreHeatTreatmentFillOptions) {
  const processSettings = await loadControlProcessSettingsFromTransaction(tx)
  const workflow = await loadWeldWorkflowSettingsFromTransaction(tx)
  const naming = await readRequestConclusionSettings(tx)
  const defaults = await readSpecialistDefaults(tx)
  const specialists = Object.fromEntries(PRE_HEAT_TREATMENT_LNK_METHODS.map(method => [method.code,
    options.specialists?.[method.code] ?? defaults.specialistDefaults[getSystemDocumentTemplateId({ type: 'lnkConclusion', methodCode: method.code }) as keyof typeof defaults.specialistDefaults] ?? {},
  ])) as NonNullable<PreHeatTreatmentFillOptions['specialists']>
  const splitModes = normalizeSystemDocumentSplitSettings({ ...naming.splitModes, ...options.splitModes })
  const { items, errors, issues } = buildPreHeatTreatmentFillItems(rows, { ...options, specialists })
  const grouped = groupPreHeatTreatmentFillItems(rows, items, splitModes)
  errors.push(...grouped.errors)
  issues.push(...grouped.issues)
  const groups = grouped.groups
  const selectedSpecialists = await loadSelectedSpecialists(tx, groups.flatMap(group => group.specialists ? [group.specialists] : []))
  for (const group of groups) if (group.action === 'result' && group.specialists) {
    try { resolveDocumentSpecialists(null, group.specialists, selectedSpecialists, getSpecialistDocumentProfile('lnkConclusion', group.positions[0]?.methodCode)!) }
    catch (error) { errors.push((error as Error).message) }
  }
  const rowMap = new Map(rows.map(row => [row.id, row]))
  const autoGroups = groups.filter(group => group.useSystemName && group.date)
  if (autoGroups.length) {
    try {
      const reservations = await reserveSystemDocumentNames(tx, autoGroups.map(group => ({
        request: getSequenceRequest(group.action, group.date, 'Предварительное имя', [...new Set(group.positions.map(position => position.methodCode))]),
        rows: [...new Set(group.items.map(item => item.rowId))].map(id => rowMap.get(id)!),
      })), { previewOnly: true, countersAlreadyLocked: true })
      autoGroups.forEach((group, index) => { group.name = reservations[index]!.name })
    } catch (error) { errors.push((error as Error).message) }
  }
  const names = new Map<string, PreHeatTreatmentFillGroup[]>()
  for (const group of groups) {
    if (!group.name.trim()) {
      const message = 'Укажите название каждого нового документа.'
      errors.push(message)
      issues.push(...group.items.map(item => ({ message, rowId: item.rowId, itemKey: item.key, field: 'name' as const })))
    }
    const ref = reference(group), key = JSON.stringify([getSystemDocumentTemplateId(ref), ref.date, ref.title.trim().toLowerCase()])
    const sameName = names.get(key) ?? []
    sameName.push(group)
    names.set(key, sameName)
  }
  for (const sameName of names.values()) if (sameName.length > 1) {
    const message = `Название «${sameName[0]!.name}» повторяется у отдельных документов одного вида и даты.`
    errors.push(message)
    issues.push(...sameName.flatMap(group => group.items.map(item => ({ message, rowId: item.rowId, itemKey: item.key, field: 'name' as const }))))
  }
  if (groups.every(group => group.date && group.name.trim())) {
    try { await assertNewDocumentNamesAvailable(tx, groups.map(reference)) } catch (error) {
      const message = (error as Error).message
      errors.push(message)
      if (error instanceof DocumentNameOccupiedError) {
        issues.push(...groups.filter(group => group.date === error.reference.date && group.name.trim().toLocaleLowerCase('ru-RU') === error.reference.title.trim().toLocaleLowerCase('ru-RU') && getSystemDocumentTemplateId(reference(group)) === getSystemDocumentTemplateId(error.reference))
          .flatMap(group => group.items.map(item => ({ message, rowId: item.rowId, itemKey: item.key, field: 'name' as const }))))
      }
    }
  }
  // Simulate request and VIK creation first, then other results. All validation
  // sees the final merged record while the database remains untouched.
  const proposed = new Map(rows.map(row => [row.id, { ...row, preHeatTreatmentControls: [...(row.preHeatTreatmentControls ?? [])] }]))
  const writes = new Map<string, ReturnType<typeof buildGroupWrites>>()
  let placeholder = -1
  for (const group of groups) {
    // Validate every joint independently so one bad position cannot hide the
    // others or create false missing-request errors on healthy positions.
    const groupWrites: ReturnType<typeof buildGroupWrites> = []
    for (const item of group.items) {
      try {
        const result = buildGroupWrites({ action: group.action, date: group.date,
          group: { ...group, positions: item.methods.map(methodCode => ({ rowId: item.rowId, methodCode })) }, rowsById: proposed,
          resultByPosition: new Map(item.methods.map(methodCode => [`${item.rowId}:${methodCode}`, { rowId: item.rowId, methodCode, result: 'годен' }])),
          rkExposureTable: workflow.otherSettings.rkExposureTable, saveCheckSettings: workflow.saveCheckSettings, systemIndexSettings: workflow.systemIndexSettings })
        groupWrites.push(...result)
        for (const write of result) {
          const row = proposed.get(write.weldJointId)!
          const next = { ...write, id: write.id ?? placeholder-- } as PreHeatTreatmentControlRecord
          row.preHeatTreatmentControls = [...row.preHeatTreatmentControls.filter(control => control.method !== write.method), next]
        }
      } catch (error) {
        const message = (error as Error).message
        errors.push(message)
        const field = getDateInputValidationReason(group.date, 'Дата', { required: true }) || error instanceof PreHeatTreatmentDateError
          ? 'date' as const : !group.name.trim() ? 'name' as const : undefined
        issues.push({ message, rowId: item.rowId, itemKey: item.key, field })
      }
    }
    writes.set(group.key, groupWrites)
  }
  for (const row of proposed.values()) {
    try {
      const reason = getLayeredControlSaveError(row, rowMap.get(row.id), processSettings.pvkGoodOnly)
      if (reason) throw new Error(reason)
      assertNoNewLnkChronologyIssues([row], [rowMap.get(row.id)!], workflow.saveCheckSettings, { ignoredKinds: PRIMARY_LNK_STAGE_DEBT_ISSUE_KINDS })
    } catch (error) {
      const message = (error as Error).message
      errors.push(message); issues.push({ message, rowId: row.id })
    }
  }
  const token = hashJsonRecordTuple([rows, processSettings, workflow, naming, defaults])
  return { rows, items, groups, writes, token, splitModes, specialists, issues, errors: [...new Set(errors)], proposed: [...proposed.values()] }
}

export async function savePreHeatTreatmentFillInTransaction(tx: Tx, rows: WeldRow[], options: PreHeatTreatmentFillOptions, card = false) {
  requireContextPermission('lnk.edit')
  const plan = await planPreHeatTreatmentFill(tx, rows, options)
  if (!card && (!options.token || options.token !== plan.token)) throw new Error(PRE_HEAT_FILL_CHANGED)
  const composition = plan.groups.map(group => ({ key: group.key, name: group.name, date: group.date, itemKeys: group.items.map(item => item.key) }))
  if (hashJsonRecordTuple([composition]) !== hashJsonRecordTuple([options.confirmedGroups])) throw new Error('Состав, даты или названия новых документов изменились. Обновите предпросмотр.')
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  const auto = plan.groups.filter(group => group.useSystemName)
  const rowsById = new Map(rows.map(row => [row.id, row]))
  await reserveSystemDocumentNames(tx, auto.map(group => ({ request: getSequenceRequest(group.action, group.date, group.name,
    [...new Set(group.positions.map(position => position.methodCode))]), rows: group.items.map(item => rowsById.get(item.rowId)!),
  })), { countersAlreadyLocked: true, rejectChangedProvisionalNames: true })
  await assertNewDocumentNamesAvailable(tx, plan.groups.map(reference))
  const requestGroups = plan.groups.filter(group => group.action === 'request'), resultGroups = plan.groups.filter(group => group.action === 'result')
  const requestWrites = requestGroups.flatMap(group => plan.writes.get(group.key) ?? [])
  const requests = requestWrites.length ? await savePreHeatTreatmentControlWrites(tx, 'request', requestWrites) : []
  const controls = new Map(rows.flatMap(row => row.preHeatTreatmentControls ?? []).map(control => [`${control.weldJointId}:${control.method}`, control]))
  for (const control of requests) controls.set(`${control.weldJointId}:${control.method}`, control)
  const resultWrites = resultGroups.flatMap(group => plan.writes.get(group.key) ?? []).map(write => ({ ...write, id: controls.get(`${write.weldJointId}:${write.method}`)!.id }))
  const results = resultWrites.length ? await savePreHeatTreatmentControlWrites(tx, 'result', resultWrites) : []
  for (const control of results) controls.set(`${control.weldJointId}:${control.method}`, control)
  await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rows.map(row => row.id))
  if (requestGroups.length) await syncPreHeatTreatmentDocuments({ tx, action: 'request', groups: requestGroups, rowsById, controls: requests })
  if (resultGroups.length) await syncPreHeatTreatmentDocuments({ tx, action: 'result', groups: resultGroups, rowsById, controls: results })
  for (const method of PRE_HEAT_TREATMENT_LNK_METHODS) {
    const groups = resultGroups.filter(group => group.positions[0]?.methodCode === method.code)
    const assignments = groups.filter(group => group.specialists && Object.values(group.specialists).some(id => typeof id === 'number'))
      .map(group => ({ title: group.name, date: group.date, selection: group.specialists! }))
    if (assignments.length) await assignCreatedDocumentSpecialists(tx, assignments, groups.map(reference))
  }
  const byRow = new Map<number, PreHeatTreatmentControlRecord[]>()
  for (const control of controls.values()) { const bucket = byRow.get(control.weldJointId) ?? []; bucket.push(control); byRow.set(control.weldJointId, bucket) }
  const touched = await persistPreHeatTreatmentTouchedRows(tx, rows.map(row => ({ ...row, preHeatTreatmentControls: byRow.get(row.id) ?? [] })))
  for (const group of new Map(plan.groups.map(group => [group.splitSettingId, group])).values()) {
    await rememberDocumentGrouping(tx, { settingId: group.splitSettingId, mode: group.splitMode,
      ...(group.action === 'result' ? { specialistDefaults: plan.specialists[group.positions[0]!.methodCode] } : {}),
    })
  }
  await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(touched, new Map()) })
  return { rows: touched, references: plan.groups.map(reference) }
}

export async function previewPreHeatTreatmentFill({ data: input }: { data: PreHeatTreatmentFillRequest }) {
  const data = normalizeInput(input)
  await assertSecurityScope('entry')
  return requireDb().transaction(async tx => {
    const rows = await readFillRows(tx, data)
    const plan = await planPreHeatTreatmentFill(tx, rows, data.options)
    return { items: plan.items, groups: plan.groups, errors: plan.errors, issues: plan.issues, token: plan.token, splitModes: plan.splitModes, specialists: plan.specialists,
      selectedCount: rows.length, existing: rows.flatMap(row => (row.preHeatTreatmentControls ?? []).map(control => ({ rowId: row.id, joint: row.joint, location: [row.projectTitle, row.subtitleCode, row.line].filter(Boolean).join(' · '), method: control.method, request: control.requestName, date: control.requestDate, conclusion: control.conclusionName, conclusionDate: control.conclusionDate, result: control.result }))) }
  })
}

export async function savePreHeatTreatmentFill({ data: input }: { data: PreHeatTreatmentFillRequest }) {
  const data = normalizeInput(input)
  await assertSecurityScope('edit')
  if (data.chainRootId) throw new Error('Заполнение всей цепочки сохраняется вместе с исходной карточкой.')
  requireContextPermission('lnk.edit')
  await prepareDocumentCreationIndex(true)
  return requireDb().transaction(async tx => {
    const receipt = await beginDocumentSaveReceipt(tx, data)
    const rows = await readFillRows(tx, data)
    const saved = await savePreHeatTreatmentFillInTransaction(tx, rows, data.options)
    await finishDocumentSaveReceipt(tx, receipt, saved.references)
    return saved.rows
  })
}
