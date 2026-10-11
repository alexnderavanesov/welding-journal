import { createHash } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { documentOperationReceipts, generatedDocuments, generatedDocumentWeldJoints, preHeatTreatmentControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import { getRequestConclusionNamingKind } from '@/lib/request-conclusion-settings'
import { assertDocumentOperationIntent, buildDocumentOperationGroups, documentOperationIdentity, isCycleDocument, type DocumentOperationGroup, type DocumentOperationRequest, type DocumentOperationSource } from '@/lib/system-document-operation'
import { SYSTEM_DOCUMENT_SPLIT_MODES, getSystemDocumentSplitSettingId } from '@/lib/system-document-splitting'
import { SYSTEM_DOCUMENT_TYPES, getSystemDocumentFileName, type SystemDocumentSummary } from '@/lib/system-document-types'
import { getSystemDocumentTemplateId, SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '@/lib/system-document-template-types'
import { REBUILD_DOCUMENT_LIMIT, REBUILD_POSITION_LIMIT, REBUILD_METADATA_LIMIT, REBUILD_FACT_BYTES_LIMIT, REBUILD_PREVIEW_BYTES_LIMIT, selectRebuildBatch, type RebuildCatalogSize } from '@/lib/system-document-rebuild-batch'
import { readRequestConclusionSettings, readSystemDocumentNextNumbers, reserveSystemDocumentNames, lockSystemDocumentNumberCounter, type SystemDocumentSequenceTransaction } from './system-document-sequences'
import { initializeSystemDocumentIndexesInTransaction, loadIndexedSystemDocumentSummaries, lockSystemDocumentIndexes, parseSystemDocumentMetadata, serializeSystemDocumentSummary, syncSystemDocumentsForWeldChangesInTransaction, upsertSourcedSystemDocumentsInTransaction, type SourcedSystemDocumentUpsertInput } from './system-document-index'
import { attachRebuildCyclePositions, persistRebuildDocumentNames } from './system-document-rebuild'
import { assertRebuildFactBudget, loadRebuildOccupiedNumbers } from './system-document-rebuild-batch'
import { loadRebuildWeldFacts } from './system-document-rebuild-facts'
import { buildNumberArrayMatch } from './weld-request-utils'
import { assertSecurityScope } from './security-functions'
import { lockAllControlProcessSettings } from './control-process-settings-lock'
import { lockLayeredControlDocumentsForWeldChange } from './layered-control-documents'
import { lockDocumentGroupingPreference, rememberDocumentGrouping } from './document-grouping-preferences'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url')
const stale = () => new Error('Документы, номера или настройки имён изменились. Нажмите «Проверить изменения» и подтвердите актуальный результат.')
const types = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map(profile => `system:${profile.id}`)

export function normalizeOperationRequest(input: DocumentOperationRequest): DocumentOperationRequest {
  const documentIds = normalizeIds(input?.documentIds, REBUILD_DOCUMENT_LIMIT)
  if (!['split', 'rename', 'merge'].includes(input?.action) || !SYSTEM_DOCUMENT_SPLIT_MODES.includes(input?.mode) || typeof input?.merge !== 'boolean') throw new Error('Некорректные параметры изменения документов.')
  assertDocumentOperationIntent({ ...input, documentIds })
  const names: NonNullable<DocumentOperationRequest['names']> = {}
  let bytes = 0, count = 0
  for (const [key, value] of Object.entries(input.names ?? {})) {
    if (!value || !['system', 'custom'].includes(value.mode) || typeof value.name !== 'string' || typeof value.membership !== 'string') throw new Error('Некорректное название документа.')
    bytes += (key.length + value.name.length + value.membership.length) * 2
    if (++count > REBUILD_POSITION_LIMIT || bytes > REBUILD_PREVIEW_BYTES_LIMIT || value.name.length > 2000) throw new Error('Названия превышают безопасный объём операции.')
    names[key] = { mode: value.mode, name: value.name.trim(), membership: value.membership }
  }
  return { documentIds, action: input.action, mode: input.mode, merge: input.merge && documentIds.length > 1, names }
}

function normalizeIds(input: unknown, max: number) {
  if (!Array.isArray(input) || !input.length || input.length > max || input.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(input).size !== input.length) throw new Error(`Выберите от 1 до ${max} различных документов.`)
  return [...input as number[]].sort((a, b) => a - b)
}
function operationId(value: unknown) {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) throw new Error('Некорректный идентификатор операции.')
  return value
}

async function catalog(tx: SystemDocumentSequenceTransaction, ids: number[]) {
  const result = await tx.execute(sql`
    select d.id as "documentId", d.title,
      greatest(d.row_count, coalesce((d.source_metadata::jsonb->>'positionCount')::integer, 0),
        coalesce(jsonb_array_length(d.source_metadata::jsonb->'sourcePositions'), 0),
        (select count(*) from ${generatedDocumentWeldJoints} a where a.document_id = d.id))::integer as "positionCount",
      (coalesce(octet_length(d.source_metadata), 0) + octet_length(d.title) + octet_length(d.file_name)) as "metadataBytes"
    from ${generatedDocuments} d where ${buildNumberArrayMatch(sql`d.id`, ids)} and d.type = any(${sql.param(types)}::text[]) order by d.id
  `)
  if (result.rows.length !== ids.length) throw new Error('Часть выбранных документов не найдена или не относится к заявкам и заключениям. Обновите список.')
  return result.rows as RebuildCatalogSize[]
}

export async function planOperationBatches(input: { documentIds: number[]; merge: boolean }) {
  await assertSecurityScope('edit')
  const ids = normalizeIds(input?.documentIds, 10_000)
  await requireDb().transaction(initializeSystemDocumentIndexesInTransaction)
  return requireDb().transaction(async tx => {
    const sizes = await catalog(tx, ids)
    // Probe only cheap-catalog candidates; return byte counts, not wide facts.
    const candidates = sizes.filter(item => item.positionCount <= REBUILD_POSITION_LIMIT && item.metadataBytes <= REBUILD_METADATA_LIMIT)
    for (let start = 0; start < candidates.length;) {
      // Bound the SQL byte probe by positions/metadata too, not just by 200
      // document IDs: one selected document can itself contain 60,000 positions.
      const probe = selectRebuildBatch(candidates.slice(start), { afterId: 0, throughId: ids.at(-1)! })
      const entries = candidates.slice(start, start + probe.documentIds.length)
      if (!entries.length) throw new Error('Не удалось проверить безопасный объём выбранных документов.')
      start += entries.length
      const result = await tx.execute(sql`
        select d.id, coalesce((select sum(octet_length(jsonb_strip_nulls(to_jsonb(w))::text))
          from ${generatedDocumentWeldJoints} a join ${weldJoints} w on w.id = a.weld_joint_id where a.document_id = d.id), 0) +
          coalesce((select sum(octet_length(to_jsonb(c)::text)) from jsonb_array_elements(coalesce(d.source_metadata::jsonb->'sourcePositions', '[]'::jsonb)) p
            join ${pstoRepeatCycles} c on c.id = (p->>'relationId')::integer
            where p->>'kind' = 'pstoRepeat' or p->>'kind' = 'pstoCycle' and (p->>'sequence')::integer >= 2), 0) +
          coalesce((select sum(octet_length(to_jsonb(c)::text)) from jsonb_array_elements(coalesce(d.source_metadata::jsonb->'sourcePositions', '[]'::jsonb)) p
            join ${preHeatTreatmentControls} c on c.id = (p->>'relationId')::integer where p->>'kind' = 'beforeHeatTreatment'), 0) as bytes
        from ${generatedDocuments} d where ${buildNumberArrayMatch(sql`d.id`, entries.map(entry => entry.documentId))}
      `)
      const bytes = new Map(result.rows.map(row => [Number(row.id), Number(row.bytes)]))
      for (const entry of entries) entry.factBytes = bytes.get(entry.documentId) ?? REBUILD_FACT_BYTES_LIMIT + 1
    }
    const batches: number[][] = [], blocked: Array<{ documentId: number; title: string; reason: string }> = []
    let remaining = sizes
    while (remaining.length) {
      const batch = selectRebuildBatch(remaining, { afterId: 0, throughId: ids.at(-1)! })
      if (batch.documentIds.length) batches.push(batch.documentIds)
      blocked.push(...batch.blocked)
      const consumed = new Set([...batch.documentIds, ...batch.blocked.map(item => item.documentId)])
      if (!consumed.size) throw new Error('Не удалось определить безопасный пакет документов.')
      remaining = remaining.filter(item => !consumed.has(item.documentId))
    }
    if (input.merge && (batches.length !== 1 || blocked.length)) throw new Error('Объединение неделимо и превышает безопасный объём одного пакета. Уменьшите выбор; частичное объединение не выполняется.')
    return { batches, blocked, selectedCount: ids.length }
  })
}

export async function loadDocumentOperationSelection(tx: SystemDocumentSequenceTransaction, ids: number[]) {
  const sizes = await catalog(tx, ids)
  if (sizes.reduce((sum, item) => sum + Number(item.positionCount), 0) > REBUILD_POSITION_LIMIT || sizes.reduce((sum, item) => sum + Number(item.metadataBytes), 0) > REBUILD_METADATA_LIMIT) throw new Error('Состав выбранных документов превышает безопасный объём пакета. Документы не изменены.')
  const documents: SystemDocumentSummary[] = []
  for (const type of SYSTEM_DOCUMENT_TYPES) documents.push(...await loadIndexedSystemDocumentSummaries(tx, type, ids))
  documents.sort((a, b) => a.documentId - b.documentId)
  const metadata = await tx.select({ id: generatedDocuments.id, value: generatedDocuments.sourceMetadata }).from(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, ids))
  const positions = new Map(metadata.map(row => [row.id, parseSystemDocumentMetadata(row.value)?.sourcePositions ?? []]))
  const rowIds = [...new Set(documents.flatMap(doc => doc.rowIds))].sort((a, b) => a - b)
  const cycleIds = [...new Set([...positions.values()].flat().filter(p => p.kind === 'pstoRepeat' || p.kind === 'pstoCycle' && Number(p.sequence) >= 2).map(p => p.relationId))].sort((a, b) => a - b)
  const controlIds = [...new Set([...positions.values()].flat().filter(p => p.kind === 'beforeHeatTreatment').map(p => p.relationId))].sort((a, b) => a - b)
  if ([...positions.values()].reduce((sum, value) => sum + value.length, 0) > REBUILD_POSITION_LIMIT || rowIds.length > REBUILD_POSITION_LIMIT) throw new Error('Состав вырос сверх лимита позиций. Нажмите «Проверить изменения».')
  return { documents, positions, rowIds, cycleIds, controlIds }
}

export async function loadDocumentOperationSnapshot(tx: SystemDocumentSequenceTransaction, ids: number[]) {
  const selection = await loadDocumentOperationSelection(tx, ids)
  await assertRebuildFactBudget(tx, selection.rowIds, selection.cycleIds, selection.controlIds)
  const rows = new Map<number, WeldRow>(), revisions: string[] = []
  for (let start = 0; start < selection.rowIds.length; start += 5000) for (const item of await loadRebuildWeldFacts(tx, selection.rowIds.slice(start, start + 5000))) { rows.set(item.row.id, item.row); revisions.push(item.revision) }
  const sources: DocumentOperationSource[] = selection.documents.map(document => ({ document, rows: document.rowIds.map(id => rows.get(id)).filter((row): row is WeldRow => Boolean(row)) }))
  await attachRebuildCyclePositions(tx, sources)
  const controls = selection.controlIds.length ? await tx.select().from(preHeatTreatmentControls).where(buildNumberArrayMatch(preHeatTreatmentControls.id, selection.controlIds)).orderBy(asc(preHeatTreatmentControls.id)) : []
  const controlMap = new Map(controls.map(control => [control.id, control]))
  for (const source of sources) if (source.document.sourceKind === 'beforeHeatTreatment') {
    source.controls = (selection.positions.get(source.document.documentId) ?? []).map(position => {
      const control = controlMap.get(position.relationId)
      if (!control) throw stale()
      return { position, control }
    })
  }
  const settings = await readRequestConclusionSettings(tx)
  const templateIds = [...new Set(sources.map(source => getSystemDocumentTemplateId(source.document)))]
  const nextNumbers = await readSystemDocumentNextNumbers(tx, templateIds)
  const occupiedNumbers = await loadRebuildOccupiedNumbers(tx, settings, templateIds)
  const namingSettings = Object.fromEntries([...new Set(sources.map(s => getRequestConclusionNamingKind(s.document)))].map(kind => [kind, {
    systemPattern: settings[kind].systemPattern, systemPatternHistory: settings[kind].systemPatternHistory,
  }]))
  const fingerprint = hash({ documents: selection.documents, revisions, controls: controls.map(hash), cycles: sources.map(s => s.cyclePositions?.map(hash)), settings: namingSettings, nextNumbers,
    occupied: templateIds.map(id => [id, [...occupiedNumbers.get(id) ?? []].sort((a, b) => a - b)]) })
  return { ...selection, sources, settings, nextNumbers, occupiedNumbers, fingerprint }
}
type Snapshot = Awaited<ReturnType<typeof loadDocumentOperationSnapshot>>

export function assertDocumentOperationLockCoverage(initial: Pick<Snapshot, 'rowIds' | 'cycleIds' | 'controlIds'>, current: Pick<Snapshot, 'rowIds' | 'cycleIds' | 'controlIds'>) {
  if (hash([current.rowIds, current.cycleIds, current.controlIds]) !== hash([initial.rowIds, initial.cycleIds, initial.controlIds])) throw stale()
}

function membership(group: DocumentOperationGroup) { return hash(group.positions.map(p => [p.sourceId, p.key])) }
function makeGroups(state: Snapshot, request: DocumentOperationRequest) {
  let groups = buildDocumentOperationGroups({ ...state, request })
  const groupKeys = new Set(groups.map(group => group.key))
  const movedManualDrafts = Object.entries(request.names ?? {}).flatMap(([key, draft]) => {
    if (draft.mode !== 'custom' || groupKeys.has(key)) return []
    try {
      const ids = JSON.parse(key)[0] as unknown
      return Array.isArray(ids) && ids.every(Number.isSafeInteger) ? [{ ids: ids as number[], draft }] : []
    } catch { return [] }
  })
  if (movedManualDrafts.length) {
    const names = { ...request.names }
    for (const group of groups) {
      if (names[group.key]) continue // An explicit naming choice wins.
      const inherited = movedManualDrafts.filter(item => item.ids.some(id => group.sourceIds.includes(id)))
      if (!inherited.length) continue
      const currentMembership = membership(group)
      names[group.key] = { mode: 'custom', name: inherited.find(item => item.draft.membership === currentMembership)?.draft.name ?? '', membership: currentMembership }
    }
    groups = buildDocumentOperationGroups({ ...state, request: { ...request, names } })
  }
  for (const group of groups) {
    const draft = request.names?.[group.key]
    if (draft && draft.membership !== membership(group)) { group.error = 'Состав группы изменился. Проверьте и заново задайте название.'; if (draft.mode === 'custom') group.name = '' }
  }
  return groups
}

/** Candidate lookup is bounded by result names; unrelated document contents never load. */
export async function checkOperationNameConflicts(tx: SystemDocumentSequenceTransaction, groups: DocumentOperationGroup[], selectedIds: number[]) {
  const candidates = groups.filter(g => g.name).map(g => ({ type: `system:${getSystemDocumentTemplateId(g.reference)}`, date: g.reference.date, name: g.name.toLocaleLowerCase('ru-RU') }))
  if (!candidates.length) return
  const result = await tx.execute(sql`
    select distinct d.id, d.type, d.title, d.period_from::text as date,
      d.source_metadata::jsonb->>'methodCode' as method, d.source_metadata::jsonb->>'sourceKind' as source
    from ${generatedDocuments} d join jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb) as n(type text, date date, name text)
      on d.type = n.type and d.period_from = n.date and lower(btrim(d.title)) = n.name
    where not (${buildNumberArrayMatch(sql`d.id`, selectedIds)})
  `)
  const identities = new Set(result.rows.map(row => {
    const profile = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.find(p => `system:${p.id}` === row.type)!
    return documentOperationIdentity({ type: profile.documentType, title: String(row.title), date: String(row.date), methodCode: String(row.method ?? '') || undefined, sourceKind: row.source as SystemDocumentSummary['sourceKind'] }, String(row.title))
  }))
  for (const group of groups) if (identities.has(documentOperationIdentity(group.reference, group.name))) group.error = 'Название занято документом вне выбора. Он не будет присоединён автоматически.'
}

function publicPreview(state: Snapshot, request: DocumentOperationRequest, groups: DocumentOperationGroup[]) {
  const original = new Map(state.sources.map(source => [source.document.documentId, source.document]))
  const result = { fingerprint: state.fingerprint, sources: state.sources.map(s => ({ id: s.document.documentId, title: s.document.title })), groups: groups.map(group => ({
    key: group.key, membership: membership(group), label: group.label, name: group.name, namingMode: group.namingMode, systemNumber: group.systemNumber,
    sourceIds: group.sourceIds, rowCount: group.rows.length, positionCount: group.positions.length, error: group.error,
    unchanged: group.sourceIds.length === 1 && group.name === original.get(group.sourceIds[0])!.title && group.rows.length === original.get(group.sourceIds[0])!.rowIds.length,
  })), selectedCount: state.sources.length, rowCount: state.rowIds.length, positionCount: groups.reduce((sum, g) => sum + g.positions.length, 0) }
  if (Buffer.byteLength(JSON.stringify(result)) > REBUILD_PREVIEW_BYTES_LIMIT) throw new Error('Результат разделения превышает безопасный объём предпросмотра. Уменьшите выбор или выберите более крупные группы.')
  return { ...result, previewHash: hash({ request, result }) }
}
export type DocumentOperationPreview = ReturnType<typeof publicPreview>
export type DocumentOperationResult = { changedDocumentCount: number; resultingDocumentCount: number; affectedRowCount: number }

export async function previewOperation(input: DocumentOperationRequest) {
  await assertSecurityScope('edit')
  const request = normalizeOperationRequest(input)
  await requireDb().transaction(initializeSystemDocumentIndexesInTransaction)
  return requireDb().transaction(async tx => {
    const state = await loadDocumentOperationSnapshot(tx, request.documentIds), groups = makeGroups(state, request)
    await checkOperationNameConflicts(tx, groups, request.documentIds)
    cacheComposition(state, request, groups)
    return publicPreview(state, request, groups)
  }, { isolationLevel: 'repeatable read' })
}

export async function applyOperation(input: DocumentOperationRequest & { fingerprint: string; previewHash: string; operationId: string }) {
  await assertSecurityScope('edit')
  const request = normalizeOperationRequest(input), id = operationId(input.operationId)
  const requestHash = hash({ request, fingerprint: input.fingerprint, previewHash: input.previewHash })
  return requireDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`document-operation:${id}`}))`)
    const [receipt] = await tx.select().from(documentOperationReceipts).where(eq(documentOperationReceipts.id, id))
    if (receipt) { if (receipt.requestHash !== requestHash) throw new Error('Этот идентификатор уже использован для другой операции.'); return JSON.parse(receipt.result) as DocumentOperationResult }
    await lockAllControlProcessSettings(tx)
    // Exclusive naming/settings lock precedes every counter and record lock.
    await lockDocumentGroupingPreference(tx, { settingId: 'lnkRequest', mode: request.mode })
    const initial = await loadDocumentOperationSelection(tx, request.documentIds)
    for (const template of [...new Set(initial.documents.map(getSystemDocumentTemplateId))].sort()) await lockSystemDocumentNumberCounter(tx, template)
    if (initial.rowIds.length) await tx.select({ id: weldJoints.id }).from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, initial.rowIds)).orderBy(asc(weldJoints.id)).for('update')
    if (initial.cycleIds.length) await tx.select({ id: pstoRepeatCycles.id }).from(pstoRepeatCycles).where(buildNumberArrayMatch(pstoRepeatCycles.id, initial.cycleIds)).orderBy(asc(pstoRepeatCycles.id)).for('update')
    if (initial.controlIds.length) await tx.select({ id: preHeatTreatmentControls.id }).from(preHeatTreatmentControls).where(buildNumberArrayMatch(preHeatTreatmentControls.id, initial.controlIds)).orderBy(asc(preHeatTreatmentControls.id)).for('update')
    await lockLayeredControlDocumentsForWeldChange(tx)
    await lockSystemDocumentIndexes(tx)
    const state = await loadDocumentOperationSnapshot(tx, request.documentIds)
    if (state.fingerprint !== input.fingerprint) throw stale()
    assertDocumentOperationLockCoverage(initial, state)
    const groups = makeGroups(state, request)
    await checkOperationNameConflicts(tx, groups, request.documentIds)
    if (groups.some(group => group.error)) throw new Error(groups.filter(group => group.error).map(group => `${group.label}: ${group.error}`).join('\n'))
    if (publicPreview(state, request, groups).previewHash !== input.previewHash) throw stale()
    const unchanged = new Set(publicPreview(state, request, groups).groups.filter(group => group.unchanged).flatMap(group => group.sourceIds))
    const changedGroups = groups.filter(group => !group.sourceIds.every(sourceId => unchanged.has(sourceId)))
    const newNumbers = changedGroups.filter(group => group.reserveNumber)
    await reserveSystemDocumentNames(tx, newNumbers.map(group => ({ rows: group.rows, request: {
      type: group.reference.type, date: group.reference.date, methodCode: group.reference.methodCode, provisionalName: group.name,
      fieldKeys: sequenceFields(group),
    } })), { countersAlreadyLocked: true, rejectChangedProvisionalNames: true, occupiedNumbersBySequence: state.occupiedNumbers })
    const result = await persistOperation(tx, state, changedGroups)
    if (request.action === 'split' && result.changedDocumentCount) for (const settingId of new Set(changedGroups.map(group => getSystemDocumentSplitSettingId(group.reference)))) await rememberDocumentGrouping(tx, { settingId, mode: request.mode })
    await tx.insert(documentOperationReceipts).values({ id, requestHash, result: JSON.stringify(result) })
    return result
  })
}

function sequenceFields(group: DocumentOperationGroup): WeldFieldKey[] {
  if (group.reference.sourceKind !== 'beforeHeatTreatment') return [...new Set(group.positions.map(p => p.field))] as WeldFieldKey[]
  // Names are reserved in the same method counters as ordinary control.
  const map = { ВИК: ['vikRequest', 'vikConclusion'], РК: ['rkRequest', 'rkConclusion'], УЗК: ['uzkRequest', 'uzkConclusion'], ПВК: ['pvkRequest', 'pvkConclusion'] } as const
  return [...new Set(group.positions.map(p => map[p.method as keyof typeof map]?.[group.reference.type === 'lnkRequest' ? 0 : 1]).filter(Boolean))] as WeldFieldKey[]
}

async function persistOperation(tx: SystemDocumentSequenceTransaction, state: Snapshot, groups: DocumentOperationGroup[]): Promise<DocumentOperationResult> {
  const sourceMap = new Map(state.sources.map(s => [s.document.documentId, s]))
  const sourceControls = new Map(state.sources.flatMap(s => (s.controls ?? []).map(c => [c.control.id, c.control] as const)))
  const sourceCycles = new Map(state.sources.flatMap(s => (s.cyclePositions ?? []).flatMap(p => p.cycle ? [[p.cycle.id, p.cycle] as const] : [])))
  const changedRows = new Map<number, WeldRow>(), previous = new Map<number, typeof weldJoints.$inferSelect>()
  const cycles = new Map<number, PstoRepeatCycleRecord>(), controls = new Map<number, NonNullable<DocumentOperationSource['controls']>[number]['control']>()
  const sourced: SourcedSystemDocumentUpsertInput[] = [], replaced = new Set<number>()
  const retained = new Map<number, SourcedSystemDocumentUpsertInput>()
  for (const group of groups) {
    const positions: SourcedSystemDocumentUpsertInput['sourcePositions'] = []
    const sourcedGroup = Boolean(group.reference.sourceKind) || isCycleDocument(group.reference)
    for (const item of group.positions) {
      const row = changedRows.get(item.row.id) ?? { ...item.row }
      previous.set(row.id, item.row as unknown as typeof weldJoints.$inferSelect)
      row[group.reference.type.startsWith('lnk') ? 'lnkUpdatedAt' : 'pstoUpdatedAt'] = new Date().toISOString()
      if (item.stage === 'До ТО') {
        const original = sourceControls.get(item.relationId!)!
        controls.set(original.id, { ...(controls.get(original.id) ?? original), [item.field]: group.name })
      } else if (item.cycle && item.cycle >= 2) {
        const original = sourceCycles.get(item.relationId!)!
        cycles.set(original.id, { ...(cycles.get(original.id) ?? original), [item.field]: group.name })
      } else (row as unknown as Record<string, unknown>)[item.field] = group.name
      changedRows.set(row.id, row)
      if (sourcedGroup) positions.push(item.stage === 'До ТО' ? item.sourcePosition! : {
        kind: group.reference.sourceKind === 'pstoRepeat' ? 'pstoRepeat' : 'pstoCycle', weldJointId: row.id,
        relationId: item.relationId ?? row.id, sequence: item.cycle ?? 1, ...(group.reference.methodCode ? { methodCode: group.reference.methodCode } : {}),
      })
    }
    for (const id of group.sourceIds) if (sourceMap.get(id)!.document.sourceKind) replaced.add(id)
    if (sourcedGroup) {
      const original = sourceMap.get(group.sourceIds[0])!.document
      const summary: SourcedSystemDocumentUpsertInput['summary'] = { ...original, ...group.reference, title: group.name,
        fileName: getSystemDocumentFileName(group.name),
        sourceKind: group.reference.sourceKind ?? 'pstoCycle', rowIds: group.rows.map(row => row.id), rowCount: group.rows.length, positionCount: positions.length,
        methodCodes: [...new Set(group.positions.map(p => p.method))], cycleSequences: [...new Set(positions.flatMap(p => p.sequence ? [p.sequence] : []))].sort((a, b) => a - b),
        projects: values(group.rows, 'projectTitle'), subtitleCodes: values(group.rows, 'subtitleCode'), lines: values(group.rows, 'line'),
      }
      sourced.push({ summary, sourcePositions: positions })
      if (group.sourceIds.length === 1 && original.sourceKind && !retained.has(original.documentId)) retained.set(original.documentId, sourced.at(-1)!)
    }
  }
  const rows = [...changedRows.values()]
  await persistRebuildDocumentNames(tx, rows, [...cycles.values()])
  const controlList = [...controls.values()]
  for (let start = 0; start < controlList.length; start += 1000) {
    const batch = controlList.slice(start, start + 1000).map(c => ({ id: c.id, request_name: c.requestName, conclusion_name: c.conclusionName }))
    const result = await tx.execute(sql`update ${preHeatTreatmentControls} as target set request_name = n.request_name, conclusion_name = n.conclusion_name, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) as n(id integer, request_name text, conclusion_name text) where target.id = n.id returning target.id`)
    if (result.rows.length !== batch.length) throw stale()
  }
  for (const id of retained.keys()) replaced.delete(id)
  if (replaced.size) await tx.delete(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, [...replaced]))
  if (retained.size) {
    // Retain the original ID for renaming / the first stable split group, but
    // replace its exact membership before upsert (never union with old members).
    const payload = [...retained].map(([id, doc]) => ({ id, title: doc.summary.title, file_name: doc.summary.fileName, row_count: doc.summary.rowCount, source_metadata: serializeSystemDocumentSummary(doc.summary, doc.sourcePositions) }))
    await tx.execute(sql`update ${generatedDocuments} as d set title = n.title, file_name = n.file_name, row_count = n.row_count, source_metadata = n.source_metadata, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as n(id integer, title text, file_name text, row_count integer, source_metadata text) where d.id = n.id`)
    await tx.delete(generatedDocumentWeldJoints).where(buildNumberArrayMatch(generatedDocumentWeldJoints.documentId, [...retained.keys()]))
  }
  if (rows.length) {
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, previous, { documentNamesOnly: true })
    await upsertSourcedSystemDocumentsInTransaction({ tx, documents: sourced })
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(rows, previous) })
  }
  return { changedDocumentCount: new Set(groups.flatMap(g => g.sourceIds)).size, resultingDocumentCount: groups.length, affectedRowCount: rows.length }
}
function values(rows: WeldRow[], field: 'projectTitle' | 'subtitleCode' | 'line') { return [...new Set(rows.map(row => String(row[field] ?? '').trim()).filter(Boolean))] }

export async function getOperationResult(value: string) {
  await assertSecurityScope('edit')
  const [receipt] = await requireDb().select({ result: documentOperationReceipts.result }).from(documentOperationReceipts).where(eq(documentOperationReceipts.id, operationId(value)))
  return receipt ? JSON.parse(receipt.result) as DocumentOperationResult : null
}

type CompositionItem = { joint: string; project: string; subtitle: string; line: string; method: string; stage: string; cycle: number | null; source: string }
const compositionCache = new Map<string, { expires: number; bytes: number; groups: Map<string, CompositionItem[]> }>()
function compositionKey(fingerprint: string, request: DocumentOperationRequest) { return hash([fingerprint, request.documentIds, request.action, request.mode, request.merge]) }
function cacheComposition(state: Snapshot, request: DocumentOperationRequest, groups: DocumentOperationGroup[]) {
  const sourceMap = new Map(state.sources.map(s => [s.document.documentId, s.document.title]))
  const details = new Map(groups.map(group => [group.key, group.positions.map(p => ({ joint: String(p.row.joint ?? p.row.id), project: String(p.row.projectTitle ?? ''), subtitle: String(p.row.subtitleCode ?? ''), line: String(p.row.line ?? ''), method: p.method, stage: p.stage, cycle: p.cycle ?? null, source: sourceMap.get(p.sourceId)! }))]))
  const bytes = JSON.stringify([...details]).length * 2
  if (bytes > 32 * 1024 * 1024) return details
  for (const [key, value] of compositionCache) if (value.expires < Date.now()) compositionCache.delete(key)
  const key = compositionKey(state.fingerprint, request)
  compositionCache.delete(key)
  while (compositionCache.size && bytes + [...compositionCache.values()].reduce((sum, v) => sum + v.bytes, 0) > 32 * 1024 * 1024) compositionCache.delete(compositionCache.keys().next().value!)
  compositionCache.set(key, { expires: Date.now() + 15 * 60_000, bytes, groups: details })
  return details
}
export async function getOperationComposition(input: DocumentOperationRequest & { fingerprint: string; groupKey: string; query: string; page: number }) {
  await assertSecurityScope('edit')
  const request = normalizeOperationRequest(input), key = compositionKey(input.fingerprint, request)
  const cached = compositionCache.get(key)
  let items = cached?.groups.get(input.groupKey)
  if (!cached || cached.expires < Date.now()) {
    // Oversized cache entries remain fully viewable through the same bounded
    // snapshot/page path; the cache ceiling is not a content truncation.
    items = await requireDb().transaction(async tx => {
      const state = await loadDocumentOperationSnapshot(tx, request.documentIds)
      if (state.fingerprint !== input.fingerprint) throw stale()
      return cacheComposition(state, request, makeGroups(state, request)).get(input.groupKey)
    }, { isolationLevel: 'repeatable read' })
  }
  if (!items) throw new Error('Группа не найдена в этом расчёте. Нажмите «Проверить изменения».')
  const query = String(input.query ?? '').trim().toLocaleLowerCase('ru-RU').slice(0, 200)
  const filtered = query ? items.filter(item => Object.values(item).join(' ').toLocaleLowerCase('ru-RU').includes(query)) : items
  const page = Math.max(0, Math.min(Math.floor(Number(input.page) || 0), Math.max(0, Math.ceil(filtered.length / 50) - 1)))
  return { items: filtered.slice(page * 50, (page + 1) * 50), page, total: filtered.length, totalPositions: items.length }
}
