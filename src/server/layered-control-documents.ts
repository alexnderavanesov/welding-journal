import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  appSettings,
  documentTemplates,
  generatedDocuments,
  generatedDocumentWeldJoints,
  weldJoints,
} from '@/db/schema'
import { isControlEnabledValue, normalizeControlAvailabilityText } from '@/lib/control-availability-values'
import { isAngularConnectionType } from '@/lib/connection-type'
import { buildDocumentTemplateName, type DocumentTemplateNameConfig } from '@/lib/document-template-name'
import { resolveGeneratedDocumentNamePattern } from '@/lib/generated-document-naming'
import {
  LAYERED_CONTROL_DOCUMENT_TYPES,
  isLayeredControlDocumentType,
  type LayeredControlDocumentType,
} from '@/lib/generated-document-types'
import {
  buildLayeredControlFallbackTitle,
  getLayeredControlDocumentProfile,
  getRequiredLayeredControlDocumentTypes,
  normalizeLayeredControlDate,
} from '@/lib/layered-control-documents'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_CONTROL_PROCESS_SETTINGS, normalizeControlProcessSettings } from '@/lib/control-process-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  lockGeneratedDocumentNumberSequence,
  type GeneratedDocumentNumberSequence,
  type GeneratedDocumentsTransaction,
} from '@/server/generated-document-number-sequence'
import { lockControlProcessSettings } from '@/server/control-process-settings-lock'

const LAYERED_CONTROL_INDEX_SETTING_KEY = 'layered-control-document-index-version'
const LAYERED_CONTROL_INDEX_VERSION = '1'
const LAYERED_CONTROL_SYNC_LOCK_KEY = 'layered-control-documents:sync'
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type LayeredRow = Partial<WeldRow> & Pick<WeldRow, 'id'>

type ExistingLayeredAssignment = {
  weldJointId: number
  documentId: number
  type: LayeredControlDocumentType
  title: string
  fileName: string
  mimeType: string
  periodFrom: string | null
  periodTo: string | null
  rowCount: number
  wdiTotal: number | null
  documentNumber: number | null
  createdAt: Date
}

export function getLayeredControlDocumentTypesToRetain(
  current: Partial<WeldRow>,
  previous?: Partial<WeldRow>,
) {
  return [...new Set([
    ...getRequiredLayeredControlDocumentTypes(current),
    ...(previous ? getRequiredLayeredControlDocumentTypes(previous) : []),
  ])]
}

export function getLayeredControlHistoryGuardError({
  previous,
  current,
  methodsWithDocuments = [],
  protectPreviousEligibility = true,
}: {
  previous?: LayeredRow
  current: LayeredRow
  methodsWithDocuments?: Array<'ВИК' | 'ПВК'>
  protectPreviousEligibility?: boolean
}) {
  const previousHadLayeredVik = previous
    ? hasLayeredControlBasis(previous, 'hasVik')
    : false
  const previousHadLayeredPvk = previous
    ? hasLayeredControlBasis(previous, 'hasPvk')
    : false
  const hasLayeredHistory =
    methodsWithDocuments.length > 0 ||
    (protectPreviousEligibility && (previousHadLayeredVik || previousHadLayeredPvk))
  if (!hasLayeredHistory) return null

  const joint = String(current.joint ?? previous?.joint ?? current.id).trim()
  if (!normalizeLayeredControlDate(current.weldDate)) {
    return `Нельзя очистить дату сварки стыка ${joint}: по нему уже создан послойный контроль.`
  }
  if (!isAngularConnectionType(current.connectionType)) {
    return `Нельзя изменить У-стык ${joint} на другой тип соединения: по нему уже создан послойный контроль.`
  }

  const protectedMethods = new Set<'ВИК' | 'ПВК'>(methodsWithDocuments)
  if (protectPreviousEligibility && previousHadLayeredVik) protectedMethods.add('ВИК')
  if (protectPreviousEligibility && previousHadLayeredPvk) protectedMethods.add('ПВК')
  for (const method of protectedMethods) {
    const assignmentKey = method === 'ВИК' ? 'hasVik' : 'hasPvk'
    const value = normalizeControlAvailabilityText(current[assignmentKey])
    if (!isControlEnabledValue(value) && value !== 'отменен') {
      return `Нельзя очистить назначение ${method} у стыка ${joint}: выберите «отменен», чтобы сохранить историю послойного контроля.`
    }
  }
  return null
}

export async function syncLayeredControlDocumentsForWeldChangesInTransaction(
  tx: GeneratedDocumentsTransaction,
  currentRows: LayeredRow[],
  previousRows: ReadonlyMap<number, LayeredRow>,
) {
  const requestedIds = [...new Set(currentRows.map((row) => Number(row.id)).filter(Number.isInteger))]
  if (requestedIds.length === 0) return
  await lockControlProcessSettings(tx, 'layeredControl')
  await lockLayeredControlSync(tx)
  const persistedRows = await tx
    .select()
    .from(weldJoints)
    .where(inArray(weldJoints.id, requestedIds))
  await syncLayeredControlRowsInTransaction(
    tx,
    persistedRows,
    previousRows,
    { allowCreate: await isLayeredControlCreationEnabled(tx) },
  )
}

export async function ensureLayeredControlDocumentsInitialized() {
  const db = requireDb()
  await db.transaction(async (tx) => {
    await lockControlProcessSettings(tx, 'layeredControl')
    const [setting] = await tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, LAYERED_CONTROL_INDEX_SETTING_KEY))
      .limit(1)
    if (setting?.value === LAYERED_CONTROL_INDEX_VERSION) return
    await rebuildAllLayeredControlDocumentsInTransaction(tx, {
      allowCreate: await isLayeredControlCreationEnabled(tx),
    })
  })
}

export async function rebuildLayeredControlDocuments() {
  const db = requireDb()
  await db.transaction(async (tx) => {
    await rebuildLayeredControlDocumentsInTransaction(tx)
  })
}

export async function rebuildLayeredControlDocumentsInTransaction(
  tx: GeneratedDocumentsTransaction,
  { processSettingsLocked = false }: { processSettingsLocked?: boolean } = {},
) {
  if (!processSettingsLocked) await lockControlProcessSettings(tx, 'layeredControl')
  await rebuildAllLayeredControlDocumentsInTransaction(tx, {
    allowCreate: await isLayeredControlCreationEnabled(tx),
  })
}

export async function rebuildAllLayeredControlDocumentsInTransaction(
  tx: GeneratedDocumentsTransaction,
  { allowCreate }: { allowCreate: boolean },
) {
  await lockLayeredControlSync(tx)
  const rows = await tx
    .select()
    .from(weldJoints)
    .orderBy(
      asc(weldJoints.weldDate),
      asc(weldJoints.projectTitle),
      asc(weldJoints.subtitleCode),
      asc(weldJoints.line),
      asc(weldJoints.joint),
      asc(weldJoints.id),
    )
  await syncLayeredControlRowsInTransaction(tx, rows, new Map(), { allowCreate })
  await tx
    .insert(appSettings)
    .values({ key: LAYERED_CONTROL_INDEX_SETTING_KEY, value: LAYERED_CONTROL_INDEX_VERSION })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: LAYERED_CONTROL_INDEX_VERSION, updatedAt: sql`now()` },
    })
}

async function syncLayeredControlRowsInTransaction(
  tx: GeneratedDocumentsTransaction,
  rows: LayeredRow[],
  previousRows: ReadonlyMap<number, LayeredRow>,
  { allowCreate }: { allowCreate: boolean },
) {
  if (rows.length === 0) return
  const rowIds = rows.map((row) => Number(row.id))
  const assignments = await loadExistingLayeredAssignments(tx, rowIds)
  const assignmentsByRowAndType = new Map<string, ExistingLayeredAssignment[]>()
  const assignedMethodsByRow = new Map<number, Set<'ВИК' | 'ПВК'>>()
  for (const assignment of assignments) {
    const key = assignmentKey(assignment.weldJointId, assignment.type)
    const values = assignmentsByRowAndType.get(key) ?? []
    values.push(assignment)
    assignmentsByRowAndType.set(key, values)

    const methods = assignedMethodsByRow.get(assignment.weldJointId) ?? new Set<'ВИК' | 'ПВК'>()
    methods.add(getLayeredControlDocumentProfile(assignment.type).method)
    assignedMethodsByRow.set(assignment.weldJointId, methods)
  }

  const templateNameConfigs = await loadLayeredTemplateNameConfigs(tx)
  const sequences = new Map<LayeredControlDocumentType, GeneratedDocumentNumberSequence>()
  const getSequence = async (type: LayeredControlDocumentType) => {
    const existing = sequences.get(type)
    if (existing) return existing
    const sequence = await lockGeneratedDocumentNumberSequence(tx, type)
    sequences.set(type, sequence)
    return sequence
  }

  for (const row of rows) {
    const methodsWithDocuments = [...(assignedMethodsByRow.get(row.id) ?? [])]
    const guardError = getLayeredControlHistoryGuardError({
      previous: previousRows.get(row.id),
      current: row,
      methodsWithDocuments,
      protectPreviousEligibility: allowCreate,
    })
    if (guardError) throw new Error(guardError)

    const previousRow = previousRows.get(row.id)
    const requiredTypes = new Set(getLayeredControlDocumentTypesToRetain(row, previousRow))
    for (const type of LAYERED_CONTROL_DOCUMENT_TYPES) {
      const candidates = assignmentsByRowAndType.get(assignmentKey(row.id, type)) ?? []
      const existing = candidates[0]
      if (!existing && (!allowCreate || !requiredTypes.has(type))) continue

      let target = existing
      if (!target) {
        const sequence = await getSequence(type)
        const documentNumber = sequence.take()
        const now = new Date()
        const title = buildLayeredControlDocumentTitle({
          type,
          row,
          documentNumber,
          formedAt: now,
          nameConfig: templateNameConfigs.get(type),
        })
        const [created] = await tx
          .insert(generatedDocuments)
          .values({
            type,
            title,
            fileName: makeXlsxFileName(title),
            mimeType: XLSX_MIME_TYPE,
            periodFrom: normalizeLayeredControlDate(row.weldDate),
            periodTo: normalizeLayeredControlDate(row.weldDate),
            rowCount: 1,
            wdiTotal: Number(row.wdi) || 0,
            documentNumber,
            sourceMetadata: JSON.stringify({ kind: 'layeredControl', version: 1 }),
          })
          .returning()
        await tx.insert(generatedDocumentWeldJoints).values({
          documentId: created.id,
          weldJointId: row.id,
        })
        target = {
          weldJointId: row.id,
          documentId: created.id,
          type,
          title: created.title,
          fileName: created.fileName,
          mimeType: created.mimeType,
          periodFrom: created.periodFrom,
          periodTo: created.periodTo,
          rowCount: created.rowCount,
          wdiTotal: created.wdiTotal,
          documentNumber: created.documentNumber,
          createdAt: created.createdAt,
        }
      }

      const documentNumber = target.documentNumber ?? (await getSequence(type)).take()
      const title = buildLayeredControlDocumentTitle({
        type,
        row,
        documentNumber,
        formedAt: target.createdAt,
        nameConfig: templateNameConfigs.get(type),
      })
      const date = normalizeLayeredControlDate(row.weldDate)
      const fileName = makeXlsxFileName(title)
      const wdiTotal = Number(row.wdi) || 0
      if (
        target.title !== title ||
        target.fileName !== fileName ||
        target.mimeType !== XLSX_MIME_TYPE ||
        target.periodFrom !== date ||
        target.periodTo !== date ||
        target.rowCount !== 1 ||
        Number(target.wdiTotal ?? 0) !== wdiTotal ||
        target.documentNumber !== documentNumber
      ) {
        await tx
          .update(generatedDocuments)
          .set({
            title,
            fileName,
            mimeType: XLSX_MIME_TYPE,
            periodFrom: date,
            periodTo: date,
            rowCount: 1,
            wdiTotal,
            documentNumber,
            updatedAt: new Date(),
          })
          .where(eq(generatedDocuments.id, target.documentId))
      }

      for (const duplicate of candidates.slice(1)) {
        await detachDuplicateLayeredAssignment(tx, duplicate)
      }
    }
  }

  for (const sequence of sequences.values()) await sequence.persist()
}

async function loadExistingLayeredAssignments(
  tx: GeneratedDocumentsTransaction,
  rowIds: number[],
): Promise<ExistingLayeredAssignment[]> {
  const records = await tx
    .select({
      weldJointId: generatedDocumentWeldJoints.weldJointId,
      documentId: generatedDocuments.id,
      type: generatedDocuments.type,
      title: generatedDocuments.title,
      fileName: generatedDocuments.fileName,
      mimeType: generatedDocuments.mimeType,
      periodFrom: generatedDocuments.periodFrom,
      periodTo: generatedDocuments.periodTo,
      rowCount: generatedDocuments.rowCount,
      wdiTotal: generatedDocuments.wdiTotal,
      documentNumber: generatedDocuments.documentNumber,
      createdAt: generatedDocuments.createdAt,
    })
    .from(generatedDocumentWeldJoints)
    .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
    .where(and(
      inArray(generatedDocumentWeldJoints.weldJointId, rowIds),
      inArray(generatedDocuments.type, [...LAYERED_CONTROL_DOCUMENT_TYPES]),
    ))
    .orderBy(asc(generatedDocuments.id))
  return records.flatMap((record) =>
    isLayeredControlDocumentType(record.type)
      ? [{ ...record, type: record.type }]
      : [],
  )
}

async function loadLayeredTemplateNameConfigs(tx: GeneratedDocumentsTransaction) {
  const rows = await tx
    .select({ id: documentTemplates.id, constructorConfig: documentTemplates.constructorConfig })
    .from(documentTemplates)
    .where(inArray(documentTemplates.id, [...LAYERED_CONTROL_DOCUMENT_TYPES]))
  const result = new Map<LayeredControlDocumentType, DocumentTemplateNameConfig>()
  for (const row of rows) {
    if (!isLayeredControlDocumentType(row.id) || !row.constructorConfig) continue
    try {
      const parsed = JSON.parse(row.constructorConfig) as { nameConfig?: DocumentTemplateNameConfig }
      if (parsed.nameConfig?.parts?.length) result.set(row.id, parsed.nameConfig)
    } catch {
      // A damaged constructor must not prevent fallback document names.
    }
  }
  return result
}

function buildLayeredControlDocumentTitle({
  type,
  row,
  documentNumber,
  formedAt,
  nameConfig,
}: {
  type: LayeredControlDocumentType
  row: LayeredRow
  documentNumber: number
  formedAt: Date
  nameConfig?: DocumentTemplateNameConfig
}) {
  if (!nameConfig) return buildLayeredControlFallbackTitle(type, row)
  const date = normalizeLayeredControlDate(row.weldDate)
  const pattern = buildDocumentTemplateName({
    config: nameConfig,
    records: [row],
    periodFrom: date,
    periodTo: date,
    templateId: type,
  })
  return resolveGeneratedDocumentNamePattern(pattern, { documentNumber, formedAt })
}

async function detachDuplicateLayeredAssignment(
  tx: GeneratedDocumentsTransaction,
  assignment: ExistingLayeredAssignment,
) {
  await tx
    .delete(generatedDocumentWeldJoints)
    .where(and(
      eq(generatedDocumentWeldJoints.documentId, assignment.documentId),
      eq(generatedDocumentWeldJoints.weldJointId, assignment.weldJointId),
    ))
  const [{ total }] = await tx
    .select({ total: count() })
    .from(generatedDocumentWeldJoints)
    .where(eq(generatedDocumentWeldJoints.documentId, assignment.documentId))
  if (Number(total) === 0) {
    await tx.delete(generatedDocuments).where(eq(generatedDocuments.id, assignment.documentId))
  }
}

function hasLayeredControlBasis(row: LayeredRow, assignmentKey: 'hasVik' | 'hasPvk') {
  return Boolean(
    normalizeLayeredControlDate(row.weldDate) &&
      isAngularConnectionType(row.connectionType) &&
      isControlEnabledValue(row[assignmentKey]),
  )
}

function assignmentKey(weldJointId: number, type: LayeredControlDocumentType) {
  return `${weldJointId}:${type}`
}

function makeXlsxFileName(title: string) {
  const baseName = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Документ'
  return `${baseName.replace(/\.xlsx$/i, '')}.xlsx`
}

async function lockLayeredControlSync(tx: GeneratedDocumentsTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LAYERED_CONTROL_SYNC_LOCK_KEY}))`)
}

async function isLayeredControlCreationEnabled(tx: GeneratedDocumentsTransaction) {
  const [stored] = await tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses))
    .limit(1)
  if (!stored) return DEFAULT_CONTROL_PROCESS_SETTINGS.layeredControlEnabled
  try {
    return normalizeControlProcessSettings(JSON.parse(stored.value)).layeredControlEnabled
  } catch {
    return DEFAULT_CONTROL_PROCESS_SETTINGS.layeredControlEnabled
  }
}
