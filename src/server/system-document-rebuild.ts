import { createHash } from 'node:crypto'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { asc, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import { generatedDocuments, pstoRepeatCycles, weldJoints } from '@/db/schema'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import type { WeldRow } from '@/lib/dispatcher-types'
import { encodeRebuildPreview } from '@/lib/system-document-rebuild-transport'
import { normalizeRebuildCursor, REBUILD_DOCUMENT_LIMIT, REBUILD_POSITION_LIMIT, REBUILD_PREVIEW_BYTES_LIMIT, type RebuildCursor, type RebuildBatch } from '@/lib/system-document-rebuild-batch'
import { loadRebuildBatch, loadRebuildOccupiedNumbers, readRebuildIdentities, assertRebuildFactBudget } from '@/server/system-document-rebuild-batch'
import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import {
  getSystemDocumentRebuildDecisionError,
  buildSystemDocumentRebuildDocuments,
  type SystemDocumentRebuildCustomDecision,
  type SystemDocumentRebuildPreview,
  type SystemDocumentRebuildSource,
} from '@/lib/system-document-rebuild'
import type { SystemDocumentSummary, SystemDocumentReference } from '@/lib/system-document-types'
import {
  SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  getSystemDocumentTemplateId,
  isSystemDocumentTemplateId,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  REQUEST_CONCLUSION_NAMING_KINDS,
  hasSystemDocumentNumberField,
  getRequestConclusionNamingKind,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import {
  loadIndexedSystemDocumentSummaries,
  initializeSystemDocumentIndexesInTransaction,
  lockSystemDocumentIndexes,
  syncSystemDocumentsForWeldChangesInTransaction,
  parseSystemDocumentMetadata,
  upsertSourcedSystemDocumentsInTransaction,
  type SourcedSystemDocumentUpsertInput,
} from '@/server/system-document-index'
import { getRebuildCycleField, indexRebuildCyclePositions, planRebuildCycleGroup } from '@/server/system-document-rebuild-cycles'
import { lockAllControlProcessSettings } from '@/server/control-process-settings-lock'
import { lockLayeredControlDocumentsForWeldChange } from '@/server/layered-control-documents'
import {
  lockSystemDocumentNumberCounter,
  readRequestConclusionSettings,
  readSystemDocumentNextNumbers,
  reserveSystemDocumentNames,
  type SystemDocumentNameReservationInput,
  type SystemDocumentSequenceTransaction,
} from '@/server/system-document-sequences'
import { assertSecurityScope } from '@/server/security-functions'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'

type RebuildPreviewRequest = {
  templateIds?: SystemDocumentTemplateId[]
  cursor?: RebuildCursor
}

type RebuildApplyRequest = {
  cursor?: RebuildCursor
  templateIds: SystemDocumentTemplateId[]
  fingerprint: string
  scopeRevisions: Partial<Record<SystemDocumentTemplateId, string>>
  decisions?: SystemDocumentRebuildCustomDecision[]
}

type RebuildSnapshot = {
  preview: SystemDocumentRebuildPreview
  sources: SystemDocumentRebuildSource[]
  settings: RequestConclusionSettings
  occupiedNumbers?: Map<SystemDocumentTemplateId, Set<number>>
}

export const previewSystemDocumentRebuild = createServerFn({ method: 'POST' })
  .validator((data: RebuildPreviewRequest | undefined) => ({
    templateIds: normalizeTemplateIds(data?.templateIds),
    cursor: normalizeRebuildCursor(data?.cursor),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    await ensureSystemDocumentIndexes()
    const db = requireDb()
    return db.transaction(async (tx) => {
      const snapshot = await loadRebuildSnapshot(tx, await loadRebuildBatch(tx, data.cursor))
      return encodeRebuildPreview(filterRebuildPreview(snapshot.preview, data.templateIds))
    })
  })

export const applySystemDocumentRebuild = createServerFn({ method: 'POST' })
  .validator((data: RebuildApplyRequest) => ({
    templateIds: normalizeTemplateIds(data?.templateIds),
    cursor: normalizeRebuildCursor(data?.cursor),
    fingerprint: String(data?.fingerprint ?? '').trim(),
    scopeRevisions: normalizeScopeRevisions(data?.scopeRevisions),
    decisions: normalizeDecisions(data?.decisions),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    if (data.templateIds.length === 0) {
      throw new Error('Выберите хотя бы один вид системных документов.')
    }
    if (!data.cursor) throw new Error('Откройте новый предварительный просмотр пакета перед пересборкой.')
    await ensureSystemDocumentIndexes()
    const db = requireDb()
    return db.transaction(async (tx) => {
      await lockAllControlProcessSettings(tx)
      // Share the setting writer's lock until commit: reservations read these
      // rules too, so they must not observe a different pattern mid-rebuild.
      await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext(${PROJECT_SETTING_KEYS.requestConclusion}))`)
      for (const templateId of [...data.templateIds].sort()) {
        await lockSystemDocumentNumberCounter(tx, templateId)
      }

      const batch = await loadRebuildBatch(tx, data.cursor)
      const { rowIds: orderedSelectedRowIds, cycleIds: selectedCycleIds } = await loadRebuildLockTargets(tx, data.templateIds, batch.documentIds)
      await assertRebuildFactBudget(tx, orderedSelectedRowIds, selectedCycleIds)
      if (orderedSelectedRowIds.length > 0) {
        await tx
          .select({ id: weldJoints.id })
          .from(weldJoints)
          .where(buildNumberArrayMatch(weldJoints.id, orderedSelectedRowIds))
          .orderBy(asc(weldJoints.id))
          .for('update')
      }
      if (selectedCycleIds.length) {
        await tx.select({ id: pstoRepeatCycles.id }).from(pstoRepeatCycles)
          .where(buildNumberArrayMatch(pstoRepeatCycles.id, selectedCycleIds))
          .orderBy(asc(pstoRepeatCycles.id)).for('update')
      }

      // Normal document creation locks counters, rows, layered documents and
      // then system indexes. Rebuild follows the same order.
      await lockLayeredControlDocumentsForWeldChange(tx)
      await lockSystemDocumentIndexes(tx)

      const lockedBatch = await loadRebuildBatch(tx, data.cursor)
      if (JSON.stringify(lockedBatch) !== JSON.stringify(batch)) throw new Error('Состав пакета изменился. Обновите предварительный просмотр.')
      const snapshot = await loadRebuildSnapshot(tx, lockedBatch)
      assertFreshRebuildSnapshot(snapshot.preview, data)
      // Never acquire new row locks after the index lock: a writer may already
      // hold that row and be waiting for this index. Reject changed membership
      // instead of risking a deadlock or writing an unlocked row's old names.
      assertRebuildLocksCoverSnapshot(snapshot.sources, data.templateIds, orderedSelectedRowIds, selectedCycleIds)
      const selectedPreview = filterRebuildPreview(snapshot.preview, data.templateIds)
      const decisionError = getSystemDocumentRebuildDecisionError({
        documents: selectedPreview.documents,
        selectedTemplateIds: new Set(data.templateIds),
        decisions: data.decisions,
      })
      if (decisionError) throw new Error(decisionError)

      const result = await applyRebuildPlan({
        tx,
        snapshot,
        templateIds: data.templateIds,
        decisions: data.decisions,
      })
      return result
    })
  })

async function ensureSystemDocumentIndexes() {
  await requireDb().transaction(initializeSystemDocumentIndexesInTransaction)
}

export function assertRebuildLocksCoverSnapshot(sources: SystemDocumentRebuildSource[], templateIds: SystemDocumentTemplateId[], rowIds: number[], cycleIds: number[]) {
  const selected = new Set(templateIds), rows = new Set(rowIds), cycles = new Set(cycleIds)
  for (const source of sources) {
    if (!selected.has(getSystemDocumentTemplateId(source.document))) continue
    if (source.document.rowIds.some(id => !rows.has(id)) || source.cyclePositions?.some(({ position }) =>
      (position.kind === 'pstoRepeat' || Number(position.sequence) >= 2) && !cycles.has(position.relationId))) {
      throw new Error('Состав стыков или циклов пакета изменился во время проверки. Обновите предварительный просмотр.')
    }
  }
}

/** Discover only IDs before taking locks; full facts and revisions are read once, after locking. */
export async function loadRebuildLockTargets(tx: SystemDocumentSequenceTransaction, templateIds: SystemDocumentTemplateId[], documentIdsScope: number[]) {
  const selected = new Set(templateIds)
  const rowIds = new Set<number>(), documentIds: number[] = []
  for (const type of ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion'] as const) {
    for (const document of await loadIndexedSystemDocumentSummaries(tx, type, documentIdsScope)) {
      if (document.sourceKind === 'beforeHeatTreatment' || !selected.has(getSystemDocumentTemplateId(document))) continue
      if (document.rowIds.length > REBUILD_POSITION_LIMIT) throw new Error('Документ вырос сверх лимита пакета. Обновите предварительный просмотр.')
      for (const id of document.rowIds) rowIds.add(id)
      if (document.sourceKind === 'pstoCycle' || document.sourceKind === 'pstoRepeat') documentIds.push(document.documentId)
    }
  }
  const cycleIds = new Set<number>()
  if (documentIds.length) {
    const metadata = await tx.select({ sourceMetadata: generatedDocuments.sourceMetadata }).from(generatedDocuments)
      .where(buildNumberArrayMatch(generatedDocuments.id, documentIds))
    for (const row of metadata) {
      for (const position of parseSystemDocumentMetadata(row.sourceMetadata)?.sourcePositions ?? []) {
        if (position.kind === 'pstoRepeat' || Number(position.sequence) >= 2) cycleIds.add(position.relationId)
      }
    }
  }
  return { rowIds: [...rowIds].sort((a, b) => a - b), cycleIds: [...cycleIds].sort((a, b) => a - b) }
}

// Exported for server-side checks. The explicit boundary also keeps crypto
// out of the lazy settings dialog in Vite dev, without relying on tree shaking.
export const loadRebuildSnapshot = createServerOnlyFn(async (
  tx: SystemDocumentSequenceTransaction,
  batch: RebuildBatch,
): Promise<RebuildSnapshot> => {
  const settings = await readRequestConclusionSettings(tx)
  const documents: SystemDocumentSummary[] = []
  for (const type of ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion'] as const) {
    for (const document of await loadIndexedSystemDocumentSummaries(tx, type, batch.documentIds)) documents.push(document)
  }
  if (documents.length > REBUILD_DOCUMENT_LIMIT || documents.reduce((sum, doc) => sum + Math.max(doc.positionCount ?? 0, doc.rowIds.length), 0) > REBUILD_POSITION_LIMIT) {
    throw new Error('Документы выросли сверх лимита пакета. Обновите предварительный просмотр.')
  }
  const rowIds = new Set<number>()
  for (const document of documents) for (const id of document.rowIds) rowIds.add(id)
  // Bound the driver's raw-result allocation (in addition to Drizzle's mapped
  // objects). Keep all original facts for freshness; never truncate the scope.
  const rowsById = new Map<number, WeldRow>()
  const rowRevisions = new Map<number, string>()
  let rowRevisionKeys: string[] | undefined
  const orderedRowIds = [...rowIds].sort((a, b) => a - b)
  await assertRebuildFactBudget(tx, orderedRowIds)
  for (let offset = 0; offset < orderedRowIds.length; offset += 5000) {
    const batch = await tx.select().from(weldJoints)
      .where(buildNumberArrayMatch(weldJoints.id, orderedRowIds.slice(offset, offset + 5000)))
    // Hash in these same batches instead of blocking the event loop for an
    // uninterrupted traversal of every wide record after the complete read.
    if (!rowRevisionKeys && batch.length) rowRevisionKeys = Object.keys(batch[0]).filter(key => key !== 'dispatcherTasks').sort()
    for (const row of batch) {
      rowRevisions.set(row.id, hashValue(Object.fromEntries(rowRevisionKeys!.map(key => [key, row[key as keyof typeof row]]))))
      // Full facts (including null vs empty) have already entered the revision.
      // Naming/index consumers read optional WeldRow fields; absent and null
      // both mean no value. Retain EVERY populated field, not a fragile allowlist,
      // but don't keep ~150 mostly-null driver properties for every joint.
      // Names-only persistence below explicitly writes absent fields as SQL null.
      rowsById.set(row.id, Object.fromEntries(Object.entries(row).filter(([, value]) => value != null)) as unknown as WeldRow)
    }
  }
  const sources: SystemDocumentRebuildSource[] = documents.map((document) => ({
    document,
    rows: document.rowIds.map((id) => rowsById.get(id)).filter((row): row is WeldRow => Boolean(row)),
  }))
  await attachRebuildCyclePositions(tx, sources)
  const nextNumbers = await readSystemDocumentNextNumbers(
    tx,
    SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => profile.id),
  )
  const occupiedNumbers = await loadRebuildOccupiedNumbers(tx, settings)
  const basePreview = buildSystemDocumentRebuildDocuments({ sources, settings, nextNumbers, occupiedNumbers })
  const fingerprint = hashValue({
    splitModes: settings.splitModes,
    patterns: Object.fromEntries(
      REQUEST_CONCLUSION_NAMING_KINDS.map((kind) => [
        kind,
        { pattern: settings[kind].systemPattern, history: settings[kind].systemPatternHistory },
      ]),
    ),
  })
  // A weld may belong to many document kinds. Hash its facts once, and feed
  // each scope incrementally: JSON.stringify of all full rows exceeds V8's
  // single-string limit at the normal 200k-joint scale.
  const scopeRevisions = Object.fromEntries(
    SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => {
      const hash = createHash('sha256').update('rebuild-scope-v2\0')
      if (batch) hash.update(hashValue(batch))
      if (occupiedNumbers) hash.update(hashValue([...(occupiedNumbers.get(profile.id) ?? [])].sort((a, b) => a - b)))
      hash.update(hashValue({ nextNumber: nextNumbers[profile.id] }))
      for (const source of sources) {
        if (getSystemDocumentTemplateId(source.document) !== profile.id) continue
        hash.update('\0document\0').update(hashValue(getDocumentRevisionValue(source.document)))
        hash.update('\0rows\0')
        for (const row of source.rows) {
          hash.update(rowRevisions.get(row.id)!)
        }
        hash.update('\0cycles\0')
        for (const position of source.cyclePositions ?? []) hash.update(hashValue(position))
        hash.update('\0end-document\0')
      }
      return [profile.id, hash.digest('base64url')]
    }),
  ) as Record<SystemDocumentTemplateId, string>

  return {
    sources,
    settings,
    occupiedNumbers,
    preview: {
      ...basePreview,
      fingerprint,
      scopeRevisions,
      batch,
    },
  }
})

export async function attachRebuildCyclePositions(tx: SystemDocumentSequenceTransaction, sources: SystemDocumentRebuildSource[]) {
  const cycleSources = sources.filter(source => source.document.sourceKind === 'pstoCycle' || source.document.sourceKind === 'pstoRepeat')
  if (!cycleSources.length) return
  const metadataRows = await tx.select({ id: generatedDocuments.id, sourceMetadata: generatedDocuments.sourceMetadata })
    .from(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, cycleSources.map(source => source.document.documentId)))
  const metadataById = new Map(metadataRows.map(row => [row.id, parseSystemDocumentMetadata(row.sourceMetadata)]))
  const cycleIds = [...new Set(metadataRows.flatMap(row => (metadataById.get(row.id)?.sourcePositions ?? [])
    .filter(position => position.kind === 'pstoRepeat' || Number(position.sequence) >= 2).map(position => position.relationId)))]
  const cyclesById = new Map<number, typeof pstoRepeatCycles.$inferSelect>()
  if (metadataRows.reduce((sum, row) => sum + (metadataById.get(row.id)?.sourcePositions.length ?? 0), 0) > REBUILD_POSITION_LIMIT) {
    throw new Error('Состав циклов вырос сверх лимита пакета. Обновите предварительный просмотр.')
  }
  await assertRebuildFactBudget(tx, [...new Set(sources.flatMap(source => source.document.rowIds))], cycleIds)
  for (let offset = 0; offset < cycleIds.length; offset += 5000) {
    const batch = await tx.select().from(pstoRepeatCycles)
      .where(buildNumberArrayMatch(pstoRepeatCycles.id, cycleIds.slice(offset, offset + 5000)))
    for (const cycle of batch) cyclesById.set(cycle.id, cycle)
  }
  for (const source of cycleSources) {
    const metadata = metadataById.get(source.document.documentId)
    if (!metadata || metadata.sourceKind !== source.document.sourceKind || !metadata.sourcePositions.length) {
      throw new Error(`Не найден точный состав циклов документа «${source.document.title}». Обновите предварительный просмотр.`)
    }
    const rowIds = new Set(source.rows.map(row => row.id))
    const positionRowIds = new Set(metadata.sourcePositions.map(position => position.weldJointId))
    if (rowIds.size !== source.document.rowIds.length || rowIds.size !== positionRowIds.size ||
      metadata.sourcePositions.some(position => !rowIds.has(position.weldJointId) || position.kind !== metadata.sourceKind)) {
      throw new Error(`Состав стыков и циклов документа «${source.document.title}» расходится. Обновите предварительный просмотр.`)
    }
    source.cyclePositions = metadata.sourcePositions.map(position => ({ position,
      ...(position.kind === 'pstoRepeat' || Number(position.sequence) >= 2 ? { cycle: cyclesById.get(position.relationId) } : {}),
    }))
  }
}

export async function applyRebuildPlan({
  tx,
  snapshot,
  templateIds,
  decisions,
}: {
  tx: SystemDocumentSequenceTransaction
  snapshot: RebuildSnapshot
  templateIds: SystemDocumentTemplateId[]
  decisions: SystemDocumentRebuildCustomDecision[]
}) {
  const selectedTemplateIds = new Set(templateIds)
  const sourceByDocumentId = new Map(snapshot.sources.map((source) => [source.document.documentId, source]))
  const decisionByDocumentId = new Map(decisions.map((decision) => [decision.documentId, decision]))
  const nextRowsById = new Map<number, WeldRow>()
  const previousRowsById = new Map<number, typeof weldJoints.$inferSelect>()
  const nextCyclesById = new Map<number, PstoRepeatCycleRecord>()
  const sourcedDocuments: SourcedSystemDocumentUpsertInput[] = []
  const replacedSourcedIds: number[] = []
  const affectedRowIds = new Set<number>()
  const rowsById = new Map<number, WeldRow>()
  for (const source of snapshot.sources) for (const row of source.rows) rowsById.set(row.id, row)
  const targetIdentities = new Map<number, string[]>()
  const usedNumbersByTemplate = new Map<SystemDocumentTemplateId, Set<number>>(
    [...(snapshot.occupiedNumbers ?? new Map())].map(([id, numbers]) => [id, new Set(numbers)]),
  )
  for (const document of snapshot.preview.documents) {
    const number = Number(document.systemNumber)
    if (!document.isSystemName || !Number.isInteger(number) || number <= 0) continue
    const used = usedNumbersByTemplate.get(document.templateId) ?? new Set<number>()
    used.add(number)
    usedNumbersByTemplate.set(document.templateId, used)
  }
  const reservationInputs: SystemDocumentNameReservationInput[] = []
  const reservationIndexByGroup = new Map<string, number>()
  for (const documentPreview of snapshot.preview.documents) {
    if (!selectedTemplateIds.has(documentPreview.templateId) || !documentPreview.isSystemName) continue
    const decision = decisionByDocumentId.get(documentPreview.documentId)
    const shouldRebuild = documentPreview.willChangeAutomatically ||
      (documentPreview.requiresCustomNameDecision && decision?.action === 'rebuild')
    if (!shouldRebuild) continue
    if (!hasSystemDocumentNumberField(snapshot.settings[getRequestConclusionNamingKind(documentPreview)].systemPattern)) {
      throw new Error('В системном имени обязательно поле «Порядковый номер». Добавьте его в настройках заявок и заключений.')
    }
    const source = sourceByDocumentId.get(documentPreview.documentId)
    if (!source) throw new Error(`Системный документ ${documentPreview.documentId} больше не найден.`)
    for (const [index, groupPreview] of documentPreview.groups.entries()) {
      if (index === 0) continue
      const groupRows = groupPreview.rowIds
        .map((id) => rowsById.get(id))
        .filter((row): row is WeldRow => Boolean(row))
      reservationIndexByGroup.set(
        rebuildGroupKey(documentPreview.documentId, groupPreview.key),
        reservationInputs.length,
      )
      reservationInputs.push({
        request: {
          type: source.document.type,
          date: source.document.date,
          ...(source.document.methodCode ? { methodCode: source.document.methodCode } : {}),
          fieldKeys: source.cyclePositions ? [getRebuildCycleField(source.document).name] : getMatchingFieldKeys(source.document, groupRows),
          provisionalName: groupPreview.previewName,
        },
        rows: groupRows,
      })
    }
  }
  const reservations = await reserveSystemDocumentNames(tx, reservationInputs, {
    countersAlreadyLocked: true,
    occupiedNumbersBySequence: usedNumbersByTemplate,
  })
  let rebuiltDocumentCount = 0

  for (const documentPreview of snapshot.preview.documents) {
    if (!selectedTemplateIds.has(documentPreview.templateId)) continue
    const source = sourceByDocumentId.get(documentPreview.documentId)
    if (!source) throw new Error(`Системный документ ${documentPreview.documentId} больше не найден.`)

    const decision = decisionByDocumentId.get(documentPreview.documentId)
    const shouldRebuild = documentPreview.isSystemName
      ? documentPreview.willChangeAutomatically
      : documentPreview.requiresCustomNameDecision && decision?.action === 'rebuild'
    if (!shouldRebuild) continue
    if (documentPreview.isSystemName && !hasSystemDocumentNumberField(snapshot.settings[getRequestConclusionNamingKind(documentPreview)].systemPattern)) {
      throw new Error('В системном имени обязательно поле «Порядковый номер». Добавьте его в настройках заявок и заключений.')
    }

    // Only the current document needs this index, not all positions of all
    // document kinds simultaneously (the same cycle can belong to four kinds).
    const positionsByRow = source.cyclePositions ? indexRebuildCyclePositions(source) : undefined
    const groupNames: string[] = []
    for (const [index, groupPreview] of documentPreview.groups.entries()) {
      const groupRows = groupPreview.rowIds
        .map((id) => rowsById.get(id))
        .filter((row): row is WeldRow => Boolean(row))
      let nextName = ''
      if (documentPreview.isSystemName) {
        if (index === 0) {
          nextName = groupPreview.previewName
        } else {
          const reservationIndex = reservationIndexByGroup.get(
            rebuildGroupKey(documentPreview.documentId, groupPreview.key),
          )
          nextName = reservationIndex == null ? '' : reservations[reservationIndex]?.name ?? ''
        }
      } else {
        nextName = String(decision?.groupNames?.[groupPreview.key] ?? '').trim()
      }
      if (!nextName) throw new Error(`Не указано название группы «${groupPreview.label}».`)
      groupNames.push(nextName)
      groupRows.forEach(row => affectedRowIds.add(row.id))
      if (source.cyclePositions) {
        const planned = planRebuildCycleGroup({ source, rows: groupRows,
          positionsByRow: positionsByRow!, nextName, nextCyclesById })
        sourcedDocuments.push(planned.document)
        // A cycle rename also invalidates stale cards of its weld, even when
        // the first cycle itself is unchanged.
        for (const row of groupRows) {
          const next = getMutableRebuildRow(nextRowsById, row)
          next[source.document.type.startsWith('lnk') ? 'lnkUpdatedAt' : 'pstoUpdatedAt'] = new Date().toISOString()
          previousRowsById.set(row.id, row as unknown as typeof weldJoints.$inferSelect)
        }
        const field = getRebuildCycleField(source.document).name
        for (const primary of planned.primaryRows) {
          const original = rowsById.get(primary.id)!
          const next = getMutableRebuildRow(nextRowsById, original)
          next[field] = nextName
          next[source.document.type.startsWith('lnk') ? 'lnkUpdatedAt' : 'pstoUpdatedAt'] = new Date().toISOString()
          previousRowsById.set(primary.id, original as unknown as typeof weldJoints.$inferSelect)
        }
      } else {
        applyDocumentGroupName({ document: source.document, rows: groupRows, nextName, nextRowsById, previousRowsById })
      }
    }
    targetIdentities.set(
      source.document.documentId,
      groupNames.map((name) => getDocumentIdentityKey(source.document, name)),
    )
    rebuiltDocumentCount += 1
    if (source.cyclePositions) replacedSourcedIds.push(source.document.documentId)
  }

  assertNoRebuildIdentityCollisions(snapshot.sources, targetIdentities)
  // Existing documents outside the batch still own their names. Check them
  // while holding the same index locks as document creation and renaming.
  if (snapshot.preview.batch && targetIdentities.size) {
    const planned = new Set([...targetIdentities.values()].flat())
    for await (const existing of readRebuildIdentities(tx)) {
      if (!targetIdentities.has(existing.documentId) && planned.has(getDocumentIdentityKey(existing, existing.title))) {
        throw new Error('После пересборки получается название документа, уже занятого вне пакета. Измените название и повторите проверку.')
      }
    }
  }
  const changedRows = [...nextRowsById.values()]
  if (changedRows.length === 0 && nextCyclesById.size === 0) {
    return { rebuiltDocumentCount: 0, resultingDocumentCount: 0, affectedRowCount: 0 }
  }
  await persistRebuildDocumentNames(tx, changedRows, [...nextCyclesById.values()])
  // Delete only documents being replaced, not all documents of these cycles.
  // The transaction recreates every exact position under its new group name.
  if (replacedSourcedIds.length) {
    await tx.delete(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, replacedSourcedIds))
  }
  await syncSystemDocumentsForWeldChangesInTransaction(tx, changedRows, previousRowsById, { documentNamesOnly: true })
  await upsertSourcedSystemDocumentsInTransaction({ tx, documents: sourcedDocuments })
  // Persisted task rows contain exact document names in correction links. A
  // client cache refresh alone cannot update those saved dispatcher payloads.
  await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(changedRows, previousRowsById) })
  return {
    rebuiltDocumentCount,
    resultingDocumentCount: [...targetIdentities.values()].reduce((count, identities) => count + identities.length, 0),
    affectedRowCount: affectedRowIds.size,
  }
}

// Rebuilding names must not run general weld/cycle normalization: that can
// change legacy results, waiting labels or final status unrelated to naming.
export async function persistRebuildDocumentNames(
  tx: SystemDocumentSequenceTransaction, rows: WeldRow[], cycles: PstoRepeatCycleRecord[],
) {
  const primaryKeys = [...new Set([
    ...LNK_METHODS.flatMap(method => [method.requestKey, method.conclusionKey]),
    'pstoRequest', 'heatTreatmentDiagram',
  ])] as Array<keyof typeof weldJoints.$inferSelect>
  const cycleKeys = ['pstoRequest', 'heatTreatmentDiagram', 'tvmtRequest', 'tvmtConclusion'] as const
  for (const scope of [
    { table: weldJoints, records: rows, keys: primaryKeys, timestamps: ['lnkUpdatedAt', 'pstoUpdatedAt'] },
    { table: pstoRepeatCycles, records: cycles, keys: cycleKeys, timestamps: [] },
  ]) {
    const columns = [...scope.keys, ...scope.timestamps].map(key => ({ key,
      column: (scope.table as unknown as Record<string, { name: string }>)[key].name,
      type: (scope.timestamps as readonly string[]).includes(key) ? 'timestamptz' : 'text',
    }))
    for (let offset = 0; offset < scope.records.length; offset += 1000) {
      const records = scope.records.slice(offset, offset + 1000)
      const payload = records.map(record => ({ id: record.id, ...Object.fromEntries(columns.map(({ key, column }) =>
        [column, (record as unknown as Record<string, unknown>)[key] ?? null])) }))
      const result = await tx.execute(sql`
        update ${scope.table} as target set
          ${sql.join(columns.map(({ column }) => sql`${sql.identifier(column)} = renamed.${sql.identifier(column)}`), sql`, `)},
          updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as renamed(
          id integer, ${sql.join(columns.map(({ column, type }) => sql`${sql.identifier(column)} ${sql.raw(type)}`), sql`, `)}
        ) where target.id = renamed.id returning target.id
      `)
      if (result.rows.length !== records.length) throw new Error('Документы или циклы изменились. Обновите предварительный просмотр.')
    }
  }
}

function rebuildGroupKey(documentId: number, groupKey: string) {
  return `${documentId}:${groupKey}`
}

function getMutableRebuildRow(rows: Map<number, WeldRow>, original: WeldRow) {
  let row = rows.get(original.id)
  if (!row) { row = { ...original }; rows.set(original.id, row) }
  return row
}

function applyDocumentGroupName({
  document,
  rows,
  nextName,
  nextRowsById,
  previousRowsById,
}: {
  document: SystemDocumentSummary
  rows: WeldRow[]
  nextName: string
  nextRowsById: Map<number, WeldRow>
  previousRowsById: Map<number, typeof weldJoints.$inferSelect>
}) {
  const now = new Date().toISOString()
  for (const row of rows) {
    const fieldKeys = getMatchingFieldKeys(document, [row])
    if (fieldKeys.length === 0) {
      throw new Error(`Стык ${String(row.joint ?? row.id)} больше не относится к документу «${document.title}». Обновите предварительный просмотр.`)
    }
    const nextRow = getMutableRebuildRow(nextRowsById, row)
    for (const fieldKey of fieldKeys) {
      ;(nextRow as unknown as Record<string, unknown>)[fieldKey] = nextName
    }
    if (document.type.startsWith('lnk')) nextRow.lnkUpdatedAt = now
    else nextRow.pstoUpdatedAt = now
    nextRowsById.set(row.id, nextRow)
    previousRowsById.set(row.id, row as unknown as typeof weldJoints.$inferSelect)
  }
}

function getMatchingFieldKeys(document: SystemDocumentSummary, rows: WeldRow[]) {
  const fieldKeys = new Set<WeldFieldKey>()
  for (const row of rows) {
    if (document.type === 'lnkRequest') {
      const requestMethods = document.methodCode === 'ТВМТ'
        ? LNK_METHODS.filter((method) => method.code === 'ТВМТ')
        : LNK_METHODS.filter((method) => method.code !== 'ТВМТ')
      for (const method of requestMethods) {
        if (isSameValue(row[method.requestKey], document.title) && isSameDate(row[method.requestDateKey], document.date)) {
          fieldKeys.add(method.requestKey)
        }
      }
    } else if (document.type === 'lnkConclusion') {
      const method = LNK_METHODS.find((candidate) => candidate.code === document.methodCode)
      if (method && isSameValue(row[method.conclusionKey], document.title) && isSameDate(row[method.conclusionDateKey], document.date)) {
        fieldKeys.add(method.conclusionKey)
      }
    } else if (document.type === 'pstoRequest') {
      if (isSameValue(row.pstoRequest, document.title) && isSameDate(row.pstoRequestDate, document.date)) {
        fieldKeys.add('pstoRequest')
      }
    } else if (isSameValue(row.heatTreatmentDiagram, document.title) && isSameDate(row.pstoDate, document.date)) {
      fieldKeys.add('heatTreatmentDiagram')
    }
  }
  if (fieldKeys.size === 0) throw new Error(`Не найдены позиции документа «${document.title}». Обновите предварительный просмотр.`)
  return [...fieldKeys]
}

export function assertNoRebuildIdentityCollisions(
  sources: SystemDocumentRebuildSource[],
  targetIdentities: Map<number, string[]>,
) {
  const owners = new Map<string, number>()
  for (const source of sources) {
    const identities = targetIdentities.get(source.document.documentId) ?? [
      getDocumentIdentityKey(source.document, source.document.title),
    ]
    for (const identity of identities) {
      const owner = owners.get(identity)
      if (owner && owner !== source.document.documentId) {
        throw new Error('После пересборки получаются одинаковые названия документов одного вида и даты. Измените ручные названия и повторите проверку.')
      }
      owners.set(identity, source.document.documentId)
    }
  }
}

function assertFreshRebuildSnapshot(
  preview: SystemDocumentRebuildPreview,
  request: Pick<RebuildApplyRequest, 'templateIds' | 'fingerprint' | 'scopeRevisions'>,
) {
  if (!request.fingerprint || request.fingerprint !== preview.fingerprint) {
    throw new Error('Настройки разделения изменились после открытия окна. Обновите предварительный просмотр.')
  }
  for (const templateId of request.templateIds) {
    if (!request.scopeRevisions[templateId] || request.scopeRevisions[templateId] !== preview.scopeRevisions[templateId]) {
      throw new Error('Системные документы или стыки изменились после открытия окна. Обновите предварительный просмотр.')
    }
  }
}

function filterRebuildPreview(
  preview: SystemDocumentRebuildPreview,
  templateIds: SystemDocumentTemplateId[],
) {
  if (templateIds.length === 0) return preview
  const selected = new Set(templateIds)
  const documents = preview.documents.filter((document) => selected.has(document.templateId))
  const changed = documents.filter((document) => document.willChangeAutomatically)
  return {
    ...preview,
    documents,
    checkedDocumentCount: documents.length,
    changedDocumentCount: changed.length,
    resultingDocumentCount: documents.reduce(
      (count, document) => count + (document.willChangeAutomatically ? document.groups.length : 1),
      0,
    ),
    affectedRowCount: new Set(changed.flatMap((document) => document.groups.flatMap((group) => group.rowIds))).size,
  }
}

export function getDocumentIdentityKey(document: SystemDocumentReference, title: string) {
  // The cycle index adopts a compatible legacy first-cycle document on upsert.
  // They therefore share a collision scope even before that index conversion.
  const cycleKind = document.type.startsWith('psto') || document.methodCode === 'ТВМТ'
  const sourceKind = cycleKind && (!document.sourceKind || document.sourceKind === 'pstoCycle')
    ? 'pstoCycle' : document.sourceKind ?? ''
  return JSON.stringify([
    document.type,
    document.methodCode ?? '',
    sourceKind,
    document.date,
    title.trim().toLocaleLowerCase('ru-RU'),
  ])
}

function getDocumentRevisionValue(document: SystemDocumentSummary) {
  return {
    documentId: document.documentId,
    type: document.type,
    methodCode: document.methodCode ?? '',
    sourceKind: document.sourceKind ?? '',
    title: document.title,
    date: document.date,
    updatedAt: document.updatedAt,
    rowIds: document.rowIds,
  }
}

const hashValue = createServerOnlyFn((value: unknown) => {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url')
})

function normalizeTemplateIds(value: unknown) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .filter(isSystemDocumentTemplateId),
  ))
}

function normalizeScopeRevisions(value: unknown) {
  const source = typeof value === 'object' && value ? value as Record<string, unknown> : {}
  return Object.fromEntries(
    Object.entries(source)
      .filter(([id]) => isSystemDocumentTemplateId(id))
      .map(([id, revision]) => [id, String(revision ?? '').trim()]),
  ) as Partial<Record<SystemDocumentTemplateId, string>>
}

function normalizeDecisions(value: unknown): SystemDocumentRebuildCustomDecision[] {
  if (!Array.isArray(value)) return []
  if (value.length > REBUILD_DOCUMENT_LIMIT) throw new Error('Слишком много решений для одного пакета. Обновите предварительный просмотр.')
  let nameBytes = 0, nameCount = 0
  return value.flatMap((decision) => {
    if (!decision || typeof decision !== 'object') return []
    const source = decision as Record<string, unknown>
    const documentId = Math.floor(Number(source.documentId))
    if (!Number.isInteger(documentId) || documentId <= 0) return []
    const action = source.action === 'rebuild' ? 'rebuild' : 'keep'
    const rawNames = typeof source.groupNames === 'object' && source.groupNames
      ? source.groupNames as Record<string, unknown>
      : {}
    const groupNames = Object.fromEntries(
      Object.entries(rawNames).map(([key, name]) => {
        const text = String(name ?? '')
        nameBytes += (key.length + text.length) * 2
        nameCount += 1
        if (nameCount > REBUILD_POSITION_LIMIT || nameBytes > REBUILD_PREVIEW_BYTES_LIMIT) throw new Error('Ручные названия превышают безопасный объём пакета. Документы не изменены.')
        return [key, text]
      }),
    )
    return [{ documentId, action, groupNames }]
  })
}

function isSameValue(value: unknown, expected: string) {
  return String(value ?? '').trim() === expected.trim()
}

function isSameDate(value: unknown, expected: string) {
  return String(value ?? '').trim().slice(0, 10) === expected.trim().slice(0, 10)
}
