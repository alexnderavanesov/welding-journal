import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, eq, inArray, max, min, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import { appSettings, generatedDocuments, generatedDocumentWeldJoints, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildGeneratedDocumentAssignmentPlan } from '@/lib/generated-document-assignment'
import { resolveGeneratedDocumentNamePattern } from '@/lib/generated-document-naming'
import {
  GENERATED_DOCUMENT_TYPES,
  getGeneratedDocumentProfile,
  isGeneratedDocumentType,
  type GeneratedDocumentType,
} from '@/lib/generated-document-types'
import { DEFAULT_OTHER_SETTINGS, normalizeOtherSettings, type OtherSettings } from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import type { WeldInput } from '@/lib/weld-fields'
import { calculateWdi, isSystemWdiMode, withSystemWdi } from '@/lib/wdi'
import { attachGeneratedDocumentFields } from '@/server/generated-document-row-fields'
import { assertSecurityScope } from '@/server/security-functions'

export type { GeneratedDocumentType } from '@/lib/generated-document-types'

export type RemoteGeneratedDocument = {
  id: number
  type: GeneratedDocumentType
  title: string
  fileName: string
  mimeType: string
  createdAt: string
  updatedAt: string
  periodFrom?: string
  periodTo?: string
  rowCount: number
  wdiTotal?: number
  documentNumber?: number
  projects: string[]
  subtitleCodes: string[]
  lines: string[]
}

export type SaveGeneratedDocumentInput = {
  type: GeneratedDocumentType
  title: string
  fileName: string
  mimeType: string
  weldJointIds: number[]
  periodFrom?: string
  periodTo?: string
  rowCount?: number
  wdiTotal?: number
}

type GeneratedDocumentsTransaction = Parameters<
  Parameters<ReturnType<typeof requireDb>['transaction']>[0]
>[0]

export const listRemoteGeneratedDocuments = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  const db = requireDb()
  const records = await db
    .select({
      document: generatedDocuments,
      assignmentCount: count(generatedDocumentWeldJoints.weldJointId),
      periodFrom: min(weldJoints.weldDate),
      periodTo: max(weldJoints.weldDate),
      projects: sql<string[]>`
        coalesce(
          array_agg(distinct ${weldJoints.projectTitle} order by ${weldJoints.projectTitle})
            filter (where nullif(btrim(${weldJoints.projectTitle}), '') is not null),
          array[]::text[]
        )
      `,
      subtitleCodes: sql<string[]>`
        coalesce(
          array_agg(distinct ${weldJoints.subtitleCode} order by ${weldJoints.subtitleCode})
            filter (where nullif(btrim(${weldJoints.subtitleCode}), '') is not null),
          array[]::text[]
        )
      `,
      lines: sql<string[]>`
        coalesce(
          array_agg(distinct ${weldJoints.line} order by ${weldJoints.line})
            filter (where nullif(btrim(${weldJoints.line}), '') is not null),
          array[]::text[]
        )
      `,
    })
    .from(generatedDocuments)
    .leftJoin(generatedDocumentWeldJoints, eq(generatedDocumentWeldJoints.documentId, generatedDocuments.id))
    .leftJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
    .where(inArray(generatedDocuments.type, [...GENERATED_DOCUMENT_TYPES]))
    .groupBy(generatedDocuments.id)
    .orderBy(sql`${generatedDocuments.updatedAt} desc`)

  const currentWdiTotals = await calculateGeneratedDocumentWdiTotals(db, records.map(({ document }) => document.id))
  return records.map(({ document, assignmentCount, periodFrom, periodTo, projects, subtitleCodes, lines }) =>
    toRemoteGeneratedDocument({
      ...document,
      rowCount: Number(assignmentCount),
      periodFrom,
      periodTo,
      wdiTotal: currentWdiTotals.get(document.id) ?? 0,
      projects,
      subtitleCodes,
      lines,
    }),
  )
})

export const getRemoteGeneratedDocument = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => ({ id: requirePositiveId(data?.id, 'документа') }))
  .handler(async ({ data }): Promise<RemoteGeneratedDocument | null> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const [record] = await db
      .select()
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.id, data.id),
          inArray(generatedDocuments.type, [...GENERATED_DOCUMENT_TYPES]),
        ),
      )
      .limit(1)
    if (!record) return null
    const currentWdiTotals = await calculateGeneratedDocumentWdiTotals(db, [record.id])
    return toRemoteGeneratedDocument({
      ...record,
      wdiTotal: currentWdiTotals.get(record.id) ?? record.wdiTotal,
    })
  })

export const saveRemoteGeneratedDocuments = createServerFn({ method: 'POST' })
  .validator(normalizeSaveGeneratedDocumentBatch)
  .handler(async ({ data }): Promise<RemoteGeneratedDocument[]> => {
    await assertSecurityScope('documentGeneration')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const numberSequence = await lockGeneratedDocumentNumberSequence(tx, data[0].type)
      const otherSettings = await loadGeneratedDocumentOtherSettings(tx)
      const savedDocuments: RemoteGeneratedDocument[] = []
      for (const input of data) {
        savedDocuments.push(await saveGeneratedDocumentInTransaction(tx, input, numberSequence, otherSettings))
      }
      await numberSequence.persist()
      return savedDocuments
    })
  })

export const getRemoteGeneratedDocumentSequence = createServerFn({ method: 'GET' })
  .validator((data: { type: GeneratedDocumentType }) => ({ type: requireGeneratedDocumentType(data?.type) }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const db = requireDb()
    return {
      type: data.type,
      nextNumber: await readGeneratedDocumentNextNumber(db, data.type),
    }
  })

export const resetRemoteGeneratedDocumentSequence = createServerFn({ method: 'POST' })
  .validator((data: { type: GeneratedDocumentType }) => ({ type: requireGeneratedDocumentType(data?.type) }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const db = requireDb()
    await db.transaction(async (tx) => {
      await lockGeneratedDocumentNumberCounter(tx, data.type)
      await writeGeneratedDocumentNextNumber(tx, data.type, 1)
    })
    return { type: data.type, nextNumber: 1 }
  })

async function saveGeneratedDocumentInTransaction(
  tx: GeneratedDocumentsTransaction,
  data: SaveGeneratedDocumentInput,
  numberSequence: GeneratedDocumentNumberSequence,
  otherSettings: OtherSettings,
): Promise<RemoteGeneratedDocument> {
  const selectedIds = data.weldJointIds
  const currentWdiTotal = await calculateWeldJointWdiTotal(tx, selectedIds, otherSettings)
  const existingAssignments = await tx
    .select({
      documentId: generatedDocumentWeldJoints.documentId,
      weldJointId: generatedDocumentWeldJoints.weldJointId,
      documentNumber: generatedDocuments.documentNumber,
    })
    .from(generatedDocumentWeldJoints)
    .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
    .where(
      and(
        inArray(generatedDocumentWeldJoints.weldJointId, selectedIds),
        eq(generatedDocuments.type, data.type),
      ),
    )
  const existingDocumentIds = [...new Set(existingAssignments.map((assignment) => assignment.documentId))]
  const documentCounts = existingDocumentIds.length > 0
    ? await tx
        .select({
          documentId: generatedDocumentWeldJoints.documentId,
          total: count(),
        })
        .from(generatedDocumentWeldJoints)
        .where(inArray(generatedDocumentWeldJoints.documentId, existingDocumentIds))
        .groupBy(generatedDocumentWeldJoints.documentId)
    : []
  const assignmentPlan = buildGeneratedDocumentAssignmentPlan({
    selectedWeldJointIds: selectedIds,
    existingAssignments,
    documentAssignmentCounts: new Map(
      documentCounts.map((record) => [record.documentId, Number(record.total)]),
    ),
  })
  let targetDocumentId = assignmentPlan.targetDocumentId
  const existingDocumentNumber = targetDocumentId
    ? existingAssignments.find((assignment) => assignment.documentId === targetDocumentId)?.documentNumber
    : null
  const documentNumber = existingDocumentNumber ?? numberSequence.take()
  const title = resolveGeneratedDocumentNamePattern(data.title, { documentNumber })
  const fileName = resolveGeneratedDocumentNamePattern(data.fileName, { documentNumber })

  const now = new Date()
  let saved: typeof generatedDocuments.$inferSelect
  if (targetDocumentId) {
    ;[saved] = await tx
      .update(generatedDocuments)
      .set({
        title,
        fileName,
        mimeType: data.mimeType,
        periodFrom: data.periodFrom || null,
        periodTo: data.periodTo || null,
        rowCount: selectedIds.length,
        wdiTotal: currentWdiTotal,
        documentNumber,
        updatedAt: now,
      })
      .where(eq(generatedDocuments.id, targetDocumentId))
      .returning()
  } else {
    ;[saved] = await tx
      .insert(generatedDocuments)
      .values({
        type: data.type,
        title,
        fileName,
        mimeType: data.mimeType,
        periodFrom: data.periodFrom || null,
        periodTo: data.periodTo || null,
        rowCount: selectedIds.length,
        wdiTotal: currentWdiTotal,
        documentNumber,
      })
      .returning()
    targetDocumentId = saved.id
  }

  if (existingDocumentIds.length > 0) {
    await tx
      .delete(generatedDocumentWeldJoints)
      .where(
        and(
          inArray(generatedDocumentWeldJoints.weldJointId, selectedIds),
          inArray(generatedDocumentWeldJoints.documentId, existingDocumentIds),
        ),
      )
  }
  await tx
    .insert(generatedDocumentWeldJoints)
    .values(selectedIds.map((weldJointId) => ({ documentId: targetDocumentId!, weldJointId })))
    .onConflictDoNothing()

  const staleDocumentIds = assignmentPlan.affectedDocumentIds.filter((id) => id !== targetDocumentId)
  for (const staleDocumentId of staleDocumentIds) {
    const [{ total, periodFrom, periodTo }] = await tx
      .select({
        total: count(),
        periodFrom: min(weldJoints.weldDate),
        periodTo: max(weldJoints.weldDate),
      })
      .from(generatedDocumentWeldJoints)
      .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
      .where(eq(generatedDocumentWeldJoints.documentId, staleDocumentId))
    if (Number(total) === 0) {
      await tx.delete(generatedDocuments).where(eq(generatedDocuments.id, staleDocumentId))
    } else {
      const currentStaleWdiTotal = await calculateGeneratedDocumentWdiTotals(
        tx,
        [staleDocumentId],
        otherSettings,
      )
      await tx
        .update(generatedDocuments)
        .set({
          rowCount: Number(total),
          periodFrom,
          periodTo,
          wdiTotal: currentStaleWdiTotal.get(staleDocumentId) ?? 0,
          updatedAt: now,
        })
        .where(eq(generatedDocuments.id, staleDocumentId))
      }
  }

  await touchWeldingProfile(tx, selectedIds, now)

  return toRemoteGeneratedDocument(saved)
}

export const getRemoteGeneratedDocumentRows = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => ({ id: requirePositiveId(data?.id, 'документа') }))
  .handler(async ({ data }): Promise<WeldRow[]> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const rows = await db
      .select({ weld: weldJoints })
      .from(generatedDocumentWeldJoints)
      .innerJoin(
        generatedDocuments,
        and(
          eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
          inArray(generatedDocuments.type, [...GENERATED_DOCUMENT_TYPES]),
        ),
      )
      .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
      .where(eq(generatedDocumentWeldJoints.documentId, data.id))
      .orderBy(asc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
    const otherSettings = await loadGeneratedDocumentOtherSettings(db)
    const currentRows = rows.map(({ weld }) => weld as unknown as WeldRow)
    return attachGeneratedDocumentFields(
      isSystemWdiMode(otherSettings)
        ? currentRows.map((row) => withSystemWdi(row, otherSettings))
        : currentRows,
    )
  })

export const deleteRemoteGeneratedDocument = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => ({ id: requirePositiveId(data?.id, 'документа') }))
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    const db = requireDb()
    await db.transaction(async (tx) => {
      const assignedRows = await tx
        .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
        .from(generatedDocumentWeldJoints)
        .innerJoin(
          generatedDocuments,
          and(
            eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
            inArray(generatedDocuments.type, [...GENERATED_DOCUMENT_TYPES]),
          ),
        )
        .where(eq(generatedDocumentWeldJoints.documentId, data.id))
      const [deleted] = await tx
        .delete(generatedDocuments)
        .where(
          and(
            eq(generatedDocuments.id, data.id),
            inArray(generatedDocuments.type, [...GENERATED_DOCUMENT_TYPES]),
          ),
        )
        .returning({ id: generatedDocuments.id })
      if (deleted) {
        await touchWeldingProfile(tx, assignedRows.map((row) => row.weldJointId))
      }
    })
    return { ok: true }
  })

function normalizeSaveGeneratedDocumentInput(data: SaveGeneratedDocumentInput): SaveGeneratedDocumentInput {
  const weldJointIds = [...new Set((data?.weldJointIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  if (weldJointIds.length === 0) throw new Error('Для документа не выбраны стыки.')
  if (!isGeneratedDocumentType(data?.type)) {
    throw new Error('Неизвестный тип документа.')
  }

  const fallbackTitle = getGeneratedDocumentProfile(data.type).label
  return {
    type: data.type,
    title: String(data.title ?? '').trim() || fallbackTitle,
    fileName: String(data.fileName ?? '').trim() || `${fallbackTitle}.xlsx`,
    mimeType: String(data.mimeType ?? '').trim(),
    weldJointIds,
    periodFrom: normalizeDate(data.periodFrom),
    periodTo: normalizeDate(data.periodTo),
    rowCount: weldJointIds.length,
    wdiTotal: Number.isFinite(Number(data.wdiTotal)) ? Number(data.wdiTotal) : undefined,
  }
}

export function normalizeSaveGeneratedDocumentBatch(data: SaveGeneratedDocumentInput[]) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Для формирования не переданы документы.')
  }

  const inputs = data.map(normalizeSaveGeneratedDocumentInput)
  const firstType = inputs[0].type
  if (inputs.some((input) => input.type !== firstType)) {
    throw new Error('За одну операцию можно сформировать документы только одного типа.')
  }

  const assignedWeldJointIds = new Set<number>()
  for (const input of inputs) {
    for (const weldJointId of input.weldJointIds) {
      if (assignedWeldJointIds.has(weldJointId)) {
        throw new Error(`Стык с ID ${weldJointId} одновременно попал в несколько документов.`)
      }
      assignedWeldJointIds.add(weldJointId)
    }
  }

  return inputs
}

function toRemoteGeneratedDocument(
  record: typeof generatedDocuments.$inferSelect & Partial<Pick<RemoteGeneratedDocument, 'projects' | 'subtitleCodes' | 'lines'>>,
): RemoteGeneratedDocument {
  return {
    id: record.id,
    type: record.type as GeneratedDocumentType,
    title: record.title,
    fileName: record.fileName,
    mimeType: record.mimeType,
    periodFrom: record.periodFrom ?? undefined,
    periodTo: record.periodTo ?? undefined,
    rowCount: record.rowCount,
    wdiTotal: record.wdiTotal ?? undefined,
    documentNumber: record.documentNumber ?? undefined,
    projects: record.projects ?? [],
    subtitleCodes: record.subtitleCodes ?? [],
    lines: record.lines ?? [],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

type GeneratedDocumentNumberSequence = {
  take: () => number
  persist: () => Promise<void>
}

async function lockGeneratedDocumentNumberSequence(
  tx: GeneratedDocumentsTransaction,
  type: GeneratedDocumentType,
): Promise<GeneratedDocumentNumberSequence> {
  await lockGeneratedDocumentNumberCounter(tx, type)
  let nextNumber = await readGeneratedDocumentNextNumber(tx, type)
  let changed = false

  return {
    take: () => {
      const value = nextNumber
      nextNumber += 1
      changed = true
      return value
    },
    persist: async () => {
      if (changed) await writeGeneratedDocumentNextNumber(tx, type, nextNumber)
    },
  }
}

async function lockGeneratedDocumentNumberCounter(
  tx: GeneratedDocumentsTransaction,
  type: GeneratedDocumentType,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${generatedDocumentCounterKey(type)}))`)
}

async function readGeneratedDocumentNextNumber(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
  type: GeneratedDocumentType,
) {
  const key = generatedDocumentCounterKey(type)
  const [setting] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1)
  const storedValue = parsePositiveIntegerSetting(setting?.value)
  if (storedValue) return storedValue

  const [record] = await db
    .select({ value: max(generatedDocuments.documentNumber) })
    .from(generatedDocuments)
    .where(eq(generatedDocuments.type, type))
  return Math.max(1, Number(record?.value ?? 0) + 1)
}

async function writeGeneratedDocumentNextNumber(
  tx: GeneratedDocumentsTransaction,
  type: GeneratedDocumentType,
  nextNumber: number,
) {
  const value = JSON.stringify(Math.max(1, Math.floor(nextNumber)))
  await tx
    .insert(appSettings)
    .values({
      key: generatedDocumentCounterKey(type),
      value,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value,
        updatedAt: sql`now()`,
      },
    })
}

function generatedDocumentCounterKey(type: GeneratedDocumentType) {
  return `generated-document-next-number:${type}`
}

function parsePositiveIntegerSetting(value: string | undefined) {
  if (!value) return null
  try {
    const parsed = Number(JSON.parse(value))
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

async function loadGeneratedDocumentOtherSettings(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
) {
  const [setting] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.other))
    .limit(1)
  if (!setting?.value) return DEFAULT_OTHER_SETTINGS
  try {
    return normalizeOtherSettings(JSON.parse(setting.value))
  } catch {
    return DEFAULT_OTHER_SETTINGS
  }
}

async function calculateGeneratedDocumentWdiTotals(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
  documentIds: number[],
  settings?: OtherSettings,
) {
  const totals = new Map(documentIds.map((documentId) => [documentId, 0]))
  if (documentIds.length === 0) return totals
  const otherSettings = settings ?? await loadGeneratedDocumentOtherSettings(db)
  const rows = await db
    .select({
      documentId: generatedDocumentWeldJoints.documentId,
      connectionType: weldJoints.connectionType,
      d1: weldJoints.d1,
      d2: weldJoints.d2,
      t1: weldJoints.t1,
      t2: weldJoints.t2,
      wdi: weldJoints.wdi,
    })
    .from(generatedDocumentWeldJoints)
    .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
    .where(inArray(generatedDocumentWeldJoints.documentId, documentIds))

  for (const row of rows) {
    totals.set(row.documentId, (totals.get(row.documentId) ?? 0) + (calculateWdi(row as WeldInput, otherSettings) ?? 0))
  }
  return totals
}

async function calculateWeldJointWdiTotal(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
  weldJointIds: number[],
  settings: OtherSettings,
) {
  const rows = await db
    .select({
      connectionType: weldJoints.connectionType,
      d1: weldJoints.d1,
      d2: weldJoints.d2,
      t1: weldJoints.t1,
      t2: weldJoints.t2,
      wdi: weldJoints.wdi,
    })
    .from(weldJoints)
    .where(inArray(weldJoints.id, weldJointIds))
  return rows.reduce((sum, row) => sum + (calculateWdi(row as WeldInput, settings) ?? 0), 0)
}

async function touchWeldingProfile(
  db: Pick<ReturnType<typeof requireDb>, 'update'>,
  weldJointIds: number[],
  now = new Date(),
) {
  const uniqueIds = [...new Set(weldJointIds)]
  if (uniqueIds.length === 0) return
  await db
    .update(weldJoints)
    .set({ weldingUpdatedAt: now, updatedAt: now })
    .where(inArray(weldJoints.id, uniqueIds))
}

function requireGeneratedDocumentType(value: unknown): GeneratedDocumentType {
  if (isGeneratedDocumentType(value)) return value
  throw new Error('Неизвестный тип документа.')
}

function normalizeDate(value: unknown) {
  const date = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

function requirePositiveId(value: unknown, label: string) {
  const id = Math.floor(Number(value) || 0)
  if (id <= 0) throw new Error(`Не передан ID ${label}.`)
  return id
}
