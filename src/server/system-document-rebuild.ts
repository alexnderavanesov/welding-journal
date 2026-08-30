import { createHash } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { inArray } from 'drizzle-orm'

import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import {
  getSystemDocumentRebuildDecisionError,
  buildSystemDocumentRebuildDocuments,
  type SystemDocumentRebuildCustomDecision,
  type SystemDocumentRebuildPreview,
  type SystemDocumentRebuildSource,
} from '@/lib/system-document-rebuild'
import type { SystemDocumentSummary } from '@/lib/system-document-types'
import {
  SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  getSystemDocumentTemplateId,
  isSystemDocumentTemplateId,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  hasSystemDocumentNumberField,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import {
  loadIndexedSystemDocumentSummaries,
  loadSystemDocumentSummaries,
  lockSystemDocumentIndex,
  syncSystemDocumentsForWeldChangesInTransaction,
} from '@/server/system-document-index'
import {
  lockSystemDocumentNumberCounter,
  readRequestConclusionSettings,
  readSystemDocumentNextNumber,
  reserveSystemDocumentName,
  type SystemDocumentSequenceTransaction,
} from '@/server/system-document-sequences'
import { assertSecurityScope } from '@/server/security-functions'
import { updateWeldJointsInBatches } from '@/server/weld-persistence'

type RebuildPreviewRequest = {
  templateIds?: SystemDocumentTemplateId[]
}

type RebuildApplyRequest = {
  templateIds: SystemDocumentTemplateId[]
  fingerprint: string
  scopeRevisions: Partial<Record<SystemDocumentTemplateId, string>>
  decisions?: SystemDocumentRebuildCustomDecision[]
}

type RebuildSnapshot = {
  preview: SystemDocumentRebuildPreview
  sources: SystemDocumentRebuildSource[]
  settings: RequestConclusionSettings
}

const SYSTEM_DOCUMENT_INDEX_LOCK_ORDER = [
  'lnkRequest',
  'lnkConclusion',
  'pstoRequest',
  'pstoConclusion',
] as const

export const previewSystemDocumentRebuild = createServerFn({ method: 'POST' })
  .validator((data: RebuildPreviewRequest | undefined) => ({
    templateIds: normalizeTemplateIds(data?.templateIds),
  }))
  .handler(async ({ data }): Promise<SystemDocumentRebuildPreview> => {
    await assertSecurityScope('settings')
    await ensureSystemDocumentIndexes()
    const db = requireDb()
    return db.transaction(async (tx) => {
      const snapshot = await loadRebuildSnapshot(tx)
      return filterRebuildPreview(snapshot.preview, data.templateIds)
    })
  })

export const applySystemDocumentRebuild = createServerFn({ method: 'POST' })
  .validator((data: RebuildApplyRequest) => ({
    templateIds: normalizeTemplateIds(data?.templateIds),
    fingerprint: String(data?.fingerprint ?? '').trim(),
    scopeRevisions: normalizeScopeRevisions(data?.scopeRevisions),
    decisions: normalizeDecisions(data?.decisions),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    if (data.templateIds.length === 0) {
      throw new Error('Выберите хотя бы один вид системных документов.')
    }
    await ensureSystemDocumentIndexes()
    const db = requireDb()
    return db.transaction(async (tx) => {
      for (const templateId of [...data.templateIds].sort()) {
        await lockSystemDocumentNumberCounter(tx, templateId)
      }

      const initialSnapshot = await loadRebuildSnapshot(tx)
      const selectedRowIds = initialSnapshot.sources
        .filter((source) => data.templateIds.includes(getSystemDocumentTemplateId(source.document)))
        .flatMap((source) => source.document.rowIds)
      if (selectedRowIds.length > 0) {
        await tx
          .select({ id: weldJoints.id })
          .from(weldJoints)
          .where(inArray(weldJoints.id, Array.from(new Set(selectedRowIds))))
          .for('update')
      }

      // Normal document creation locks counters, updates rows and then syncs
      // indexes. Rebuild follows the same order to avoid cross-workflow deadlocks.
      for (const type of SYSTEM_DOCUMENT_INDEX_LOCK_ORDER) await lockSystemDocumentIndex(tx, type)

      const snapshot = await loadRebuildSnapshot(tx)
      assertFreshRebuildSnapshot(snapshot.preview, data)
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
  for (const type of ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion'] as const) {
    await loadSystemDocumentSummaries(type)
  }
}

async function loadRebuildSnapshot(
  tx: SystemDocumentSequenceTransaction,
): Promise<RebuildSnapshot> {
  const settings = await readRequestConclusionSettings(tx)
  const documents: SystemDocumentSummary[] = []
  for (const type of ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion'] as const) {
    documents.push(...await loadIndexedSystemDocumentSummaries(tx, type))
  }
  const rowIds = Array.from(new Set(documents.flatMap((document) => document.rowIds)))
  const rows = rowIds.length > 0
    ? await tx.select().from(weldJoints).where(inArray(weldJoints.id, rowIds))
    : []
  const rowsById = new Map(rows.map((row) => [row.id, row as unknown as WeldRow]))
  const sources = documents.map((document) => ({
    document,
    rows: document.rowIds.map((id) => rowsById.get(id)).filter((row): row is WeldRow => Boolean(row)),
  }))
  const nextNumberEntries: Array<[SystemDocumentTemplateId, number]> = []
  for (const profile of SYSTEM_DOCUMENT_TEMPLATE_PROFILES) {
    nextNumberEntries.push([profile.id, await readSystemDocumentNextNumber(tx, profile.id)])
  }
  const nextNumbers = Object.fromEntries(nextNumberEntries) as Record<SystemDocumentTemplateId, number>
  const basePreview = buildSystemDocumentRebuildDocuments({ sources, settings, nextNumbers })
  const fingerprint = hashValue({
    splitModes: settings.splitModes,
    patterns: Object.fromEntries(
      ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion'].map((type) => [
        type,
        settings[type as keyof Pick<RequestConclusionSettings, 'lnkRequest' | 'lnkConclusion' | 'pstoRequest' | 'pstoConclusion'>].systemPattern,
      ]),
    ),
  })
  const scopeRevisions = Object.fromEntries(
    SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => {
      const scopedSources = sources
        .filter((source) => getSystemDocumentTemplateId(source.document) === profile.id)
        .map((source) => ({
          document: getDocumentRevisionValue(source.document),
          rows: source.rows.map(getRowRevisionValue),
        }))
      return [profile.id, hashValue({
        nextNumber: nextNumbers[profile.id],
        sources: scopedSources,
      })]
    }),
  ) as Record<SystemDocumentTemplateId, string>

  return {
    sources,
    settings,
    preview: {
      ...basePreview,
      fingerprint,
      scopeRevisions,
    },
  }
}

async function applyRebuildPlan({
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
  const targetIdentities = new Map<number, string[]>()
  const usedNumbersByTemplate = new Map<SystemDocumentTemplateId, Set<number>>()
  for (const document of snapshot.preview.documents) {
    const number = Number(document.systemNumber)
    if (!document.isSystemName || !Number.isInteger(number) || number <= 0) continue
    const used = usedNumbersByTemplate.get(document.templateId) ?? new Set<number>()
    used.add(number)
    usedNumbersByTemplate.set(document.templateId, used)
  }
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
    if (documentPreview.isSystemName && !hasSystemDocumentNumberField(snapshot.settings[documentPreview.type].systemPattern)) {
      throw new Error('В системном имени обязательно поле «Порядковый номер». Добавьте его в настройках заявок и заключений.')
    }

    const groupNames: string[] = []
    for (const [index, groupPreview] of documentPreview.groups.entries()) {
      const groupRows = groupPreview.rowIds
        .map((id) => source.rows.find((row) => row.id === id))
        .filter((row): row is WeldRow => Boolean(row))
      let nextName = ''
      if (documentPreview.isSystemName) {
        if (index === 0) {
          nextName = groupPreview.previewName
        } else {
          const fieldKeys = getMatchingFieldKeys(source.document, groupRows)
          const reserved = await reserveUniqueRebuildName({
            tx,
            document: source.document,
            templateId: documentPreview.templateId,
            fieldKeys,
            rows: groupRows,
            provisionalName: groupPreview.previewName,
            usedNumbersByTemplate,
          })
          nextName = reserved.name
        }
      } else {
        nextName = String(decision?.groupNames?.[groupPreview.key] ?? '').trim()
      }
      if (!nextName) throw new Error(`Не указано название группы «${groupPreview.label}».`)
      groupNames.push(nextName)
      applyDocumentGroupName({
        document: source.document,
        rows: groupRows,
        nextName,
        nextRowsById,
        previousRowsById,
      })
    }
    targetIdentities.set(
      source.document.documentId,
      groupNames.map((name) => getDocumentIdentityKey(source.document, name)),
    )
    rebuiltDocumentCount += 1
  }

  assertNoRebuildIdentityCollisions(snapshot.sources, targetIdentities)
  const changedRows = [...nextRowsById.values()]
  if (changedRows.length === 0) {
    return { rebuiltDocumentCount: 0, resultingDocumentCount: 0, affectedRowCount: 0 }
  }
  const updatedRows = await updateWeldJointsInBatches(tx, changedRows, previousRowsById)
  await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRowsById)
  return {
    rebuiltDocumentCount,
    resultingDocumentCount: [...targetIdentities.values()].reduce((count, identities) => count + identities.length, 0),
    affectedRowCount: updatedRows.length,
  }
}

async function reserveUniqueRebuildName({
  tx,
  document,
  templateId,
  fieldKeys,
  rows,
  provisionalName,
  usedNumbersByTemplate,
}: {
  tx: SystemDocumentSequenceTransaction
  document: SystemDocumentSummary
  templateId: SystemDocumentTemplateId
  fieldKeys: WeldFieldKey[]
  rows: WeldRow[]
  provisionalName: string
  usedNumbersByTemplate: Map<SystemDocumentTemplateId, Set<number>>
}) {
  const usedNumbers = usedNumbersByTemplate.get(templateId) ?? new Set<number>()
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const reserved = await reserveSystemDocumentName(tx, {
      type: document.type,
      date: document.date,
      ...(document.methodCode ? { methodCode: document.methodCode } : {}),
      fieldKeys,
      provisionalName,
    }, rows)
    if (!usedNumbers.has(reserved.number)) {
      usedNumbers.add(reserved.number)
      usedNumbersByTemplate.set(templateId, usedNumbers)
      return reserved
    }
  }
  throw new Error('Не удалось назначить уникальный порядковый номер системного документа.')
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
    const nextRow = { ...(nextRowsById.get(row.id) ?? row) }
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
      for (const method of LNK_METHODS) {
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

function assertNoRebuildIdentityCollisions(
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

function getDocumentIdentityKey(document: SystemDocumentSummary, title: string) {
  return JSON.stringify([
    document.type,
    document.methodCode ?? '',
    document.sourceKind ?? '',
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

function getRowRevisionValue(row: WeldRow) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key !== 'dispatcherTasks')
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function hashValue(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}

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
      Object.entries(rawNames).map(([key, name]) => [key, String(name ?? '')]),
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
