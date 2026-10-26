import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { requireDb } from '@/db'
import { linePrograms, pstoChainExceptions, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { applyPstoChainPolicy, getPstoChainDecision, getPstoChainRoot, getPstoProgramState } from '@/lib/psto-chain-policy'
import { getPstoLineIdentityKey, normalizePstoLineIdentity, type PstoLineActivationDecision } from '@/lib/psto-line-assignment'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { getPstoContextualStageCorrectionReason } from '@/lib/psto-contextual-stage-correction'
import { assertSecurityScope } from './security-functions'
import { loadProgramSystemIndexSettings } from './line-program'
import { buildWeldLineIdentityWhere } from './weld-line-move-stage'
import { lockWeldLineMemberships } from './weld-line-membership-lock'
import { ensurePstoProgram, overlayPstoProgramPolicies } from './psto-chain-policy'
import { attachHeatTreatmentControlRelations } from './heat-treatment-control-relations'
import { attachDuplicateControlRelations } from './duplicate-control-relations'
import { WELD_TABLE_RETURNING } from './weld-server-shared'
import { assertExpectedInteractiveWeldVersions } from './weld-row-version'
import { loadControlProcessSettingsFromTransaction } from './control-process-settings'
import { buildRemovalPreview } from './psto-line-assignment'
import { applyPstoAssignmentRows } from './psto-assignment-transition'
import { markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { normalizePstoExceptionTableRequest, type PstoExceptionTableRequest } from '@/lib/psto-exception-table'
import { readPstoExceptionTable, readPstoExceptionFilterOptions } from './psto-exception-table'

type PreviewRequest = { rowId: number; required: boolean | null | 'auto' }
type SaveRequest = Omit<PreviewRequest, 'required'> & {
  required: boolean | null
  basis: string
  expectedExceptionId: number | null
  expectedProgramState: string
  expectedVersions: WeldRowVersionTarget[]
  decisions?: PstoLineActivationDecision[]
}

function normalizePreview(value: PreviewRequest) {
  if (!Number.isSafeInteger(value?.rowId) || value.rowId <= 0 || ![true, false, null, 'auto'].includes(value.required)) throw new Error('Выберите цепочку стыка.')
  return { rowId: value.rowId, required: value.required }
}

async function loadChain(db: Pick<SystemDocumentSequenceTransaction, 'select'>, rowId: number, lock = false) {
  const [source] = await db.select(WELD_TABLE_RETURNING).from(weldJoints).where(eq(weldJoints.id, rowId)).limit(1)
  if (!source || !source.line) throw new Error('Стык или его линия больше не найдены. Обновите окно.')
  if (lock) await lockWeldLineMemberships(db as SystemDocumentSequenceTransaction, [source])
  const query = db.select(WELD_TABLE_RETURNING).from(weldJoints).where(buildWeldLineIdentityWhere(normalizePstoLineIdentity(source))).orderBy(asc(weldJoints.id))
  const lineRows = lock ? await query.for('update') : await query
  if (!lineRows.some(row => row.id === rowId)) throw new Error('Стык перенесён на другую линию. Обновите окно.')
  const settings = await loadProgramSystemIndexSettings(db)
  const chain = getJointChainRows(lineRows as WeldRow[], source, settings)
  if (!chain.length) throw new Error('Не удалось определить цепочку стыка.')
  const policies = await overlayPstoProgramPolicies(db, [source], new Map([[getPstoLineIdentityKey(source), {
    rowCount: lineRows.length, assignedCount: lineRows.filter(row => isControlEnabledValue(row.pstoRequired)).length,
    cancelledCount: lineRows.filter(row => row.pstoRequired === 'отменен').length,
  }]]))
  const policy = policies.get(getPstoLineIdentityKey(source))!
  const state = getPstoProgramState(policy)
  if (state === 'mixed') throw new Error('Назначение ПСТО линии противоречиво. Сначала уточните программу линии.')
  const rows = await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(chain, db), db)
  return { source, lineRows, rows, settings, policy, state, exception: getPstoChainDecision(policy, source.joint, settings) }
}

function nextPolicy(context: Awaited<ReturnType<typeof loadChain>>, required: boolean | null, basis: string) {
  const exceptions = new Map(context.policy.exceptions)
  const root = getPstoChainRoot(context.source.joint, context.settings)
  if (required === null) exceptions.delete(root)
  else {
    if (required === (context.state === 'assigned')) throw new Error('Это назначение уже задано программой линии. Исключение не требуется.')
    exceptions.set(root, { id: context.exception?.id ?? 0, required, basis })
  }
  return { ...context.policy, programState: context.state, exceptions }
}

export const getPstoChainExceptionPreview = createServerFn({ method: 'POST' }).validator(normalizePreview)
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const context = await loadChain(db, data.rowId)
    const required = data.required === 'auto' ? context.exception?.required ?? context.state !== 'assigned' : data.required
    const policy = nextPolicy(context, required, context.exception?.basis ?? '')
    const preview = buildRemovalPreview(normalizePstoLineIdentity(context.source), context.rows)
    const processSettings = await loadControlProcessSettingsFromTransaction(db)
    preview.rows.forEach((item, index) => {
      const before = context.rows[index]!
      const after = applyPstoChainPolicy(before, policy, context.settings)
      if (isControlEnabledValue(before.pstoRequired) === isControlEnabledValue(after.pstoRequired)) return
      const targetStage = isControlEnabledValue(after.pstoRequired) ? 'beforeHeatTreatment' : 'primary'
      if (targetStage === 'primary' ? !item.preMethods.length : !item.primaryMethods.length) return
      item.stageCorrection = { targetStage, disabledReason: getPstoContextualStageCorrectionReason(after, targetStage, processSettings, context.settings) }
    })
    return { ...preview, rootJoint: getPstoChainRoot(context.source.joint, context.settings),
      programState: context.state, exception: context.exception ?? null,
      required: required ?? context.state === 'assigned', rowId: data.rowId }
  })

export const savePstoChainException = createServerFn({ method: 'POST' })
  .validator((value: SaveRequest) => {
    const normalized = normalizePreview(value)
    if (normalized.required === 'auto') throw new Error('Сначала проверьте назначение в предварительном просмотре цепочки.')
    const basis = String(value.basis ?? '').trim()
    if (normalized.required !== null && (!basis || basis.length > 2000)) throw new Error('Укажите основание исключения (до 2000 символов).')
    if (!Array.isArray(value.expectedVersions) || !Array.isArray(value.decisions ?? [])) throw new Error('Обновите предварительный просмотр цепочки.')
    if ((value.decisions ?? []).some(decision => !decision || 'methodCodes' in decision || !['keepPrimary', 'movePrimaryToPreHeatTreatment', 'movePreHeatTreatmentToPrimary'].includes(decision.disposition))) {
      throw new Error('Переносится только целый комплект НК. Обновите окно и выберите этап заново.')
    }
    return { ...value, ...normalized, required: normalized.required, basis, decisions: value.decisions ?? [] }
  }).handler(async ({ data }) => {
    await assertSecurityScope('edit')
    return requireDb().transaction(async tx => {
      const processSettings = await loadControlProcessSettingsFromTransaction(tx)
      const context = await loadChain(tx, data.rowId, true)
      const { rows, exception, settings, state } = context
      assertExpectedInteractiveWeldVersions(rows.map(row => row.id), data.expectedVersions, rows)
      if ((exception?.id ?? null) !== data.expectedExceptionId || state !== data.expectedProgramState) throw new Error('Назначение ПСТО изменено другим пользователем. Обновите окно.')
      if (data.required === null && !exception) throw new Error('Исключение уже снято. Обновите окно.')
      const policy = nextPolicy(context, data.required, data.basis)
      const program = await ensurePstoProgram(tx, context.lineRows, state)
      if (exception) await tx.delete(pstoChainExceptions).where(eq(pstoChainExceptions.id, exception.id))
      if (data.required !== null) await tx.insert(pstoChainExceptions).values({ lineProgramId: program.id,
        rootJoint: getPstoChainRoot(context.source.joint, settings), required: data.required, basis: data.basis })
      const nextRows = rows.map(row => applyPstoChainPolicy(row, policy, settings))
      const saved = await applyPstoAssignmentRows(tx, rows, nextRows, data.decisions, processSettings, settings)
      await markDispatcherTaskIndexDirty(tx, { scopes: [normalizePstoLineIdentity(context.source)] })
      return saved
    })
  })

export const searchPstoExceptionJoints = createServerFn({ method: 'POST' })
  .validator(normalizePstoExceptionTableRequest)
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return readPstoExceptionTable(requireDb(), data, true)
  })

export const listPstoChainExceptions = createServerFn({ method: 'POST' })
  .validator(normalizePstoExceptionTableRequest)
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return readPstoExceptionTable(requireDb(), data, false)
  })

export const listPstoExceptionFilterOptions = createServerFn({ method: 'POST' })
  .validator((value: PstoExceptionTableRequest & { candidates: boolean; field: string; match?: string; offset?: number }) => ({
    ...normalizePstoExceptionTableRequest(value), candidates: value.candidates === true, field: String(value.field),
    match: String(value.match ?? '').trim().slice(0, 200), offset: Number.isSafeInteger(value.offset) && value.offset! > 0 ? value.offset! : 0,
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return readPstoExceptionFilterOptions(requireDb(), data, data.candidates, data.field, data.match, data.offset)
  })

/** Resolve an active list entry using configured chain naming, including an
 * unofficial namesake when no official root currently exists. */
export const getPstoExceptionRowId = createServerFn({ method: 'POST' }).validator((id: number) => Number(id))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const [entry] = await db.select({ exception: pstoChainExceptions, program: linePrograms }).from(pstoChainExceptions).innerJoin(linePrograms, eq(linePrograms.id, pstoChainExceptions.lineProgramId)).where(and(eq(pstoChainExceptions.id, data), isNull(pstoChainExceptions.closedAt)))
    if (!entry) throw new Error('Исключение уже закрыто. Обновите список.')
    const settings = await loadProgramSystemIndexSettings(db)
    const rows = await db.select({ id: weldJoints.id, joint: weldJoints.joint }).from(weldJoints).where(buildWeldLineIdentityWhere(entry.program)).orderBy(asc(weldJoints.id))
    const row = rows.find(row => getPstoChainRoot(row.joint, settings) === entry.exception.rootJoint)
    return row?.id ?? null
  })

export const closeEmptyPstoChainException = createServerFn({ method: 'POST' }).validator((id: number) => Number(id))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    await requireDb().transaction(async tx => {
      const [entry] = await tx.select({ exception: pstoChainExceptions, program: linePrograms }).from(pstoChainExceptions).innerJoin(linePrograms, eq(linePrograms.id, pstoChainExceptions.lineProgramId)).where(and(eq(pstoChainExceptions.id, data), isNull(pstoChainExceptions.closedAt)))
      if (!entry) throw new Error('Исключение уже закрыто. Обновите список.')
      await lockWeldLineMemberships(tx, [entry.program])
      const [currentProgram] = await tx.select().from(linePrograms).where(eq(linePrograms.id, entry.program.id))
      if (!currentProgram || getPstoLineIdentityKey(currentProgram) !== getPstoLineIdentityKey(entry.program)) throw new Error('Линия переименована другим пользователем. Обновите список исключений.')
      const settings = await loadProgramSystemIndexSettings(tx)
      const rows = await tx.select({ joint: weldJoints.joint }).from(weldJoints).where(buildWeldLineIdentityWhere(entry.program))
      if (rows.some(row => getPstoChainRoot(row.joint, settings) === entry.exception.rootJoint)) throw new Error('В цепочке появились стыки. Обновите список и проверьте весь состав перед снятием исключения.')
      const closed = await tx.delete(pstoChainExceptions).where(and(eq(pstoChainExceptions.id, data), isNull(pstoChainExceptions.closedAt))).returning({ id: pstoChainExceptions.id })
      if (!closed.length) throw new Error('Исключение уже закрыто. Обновите список.')
    })
    return { ok: true }
  })
