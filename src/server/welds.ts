import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints, type NewWeldJoint } from '@/db/schema'
import {
  clearCancelledRejectedLnkGeneratedData,
  clearDisabledLnkRequests,
  clearLnkGeneratedData,
  hasLnkGeneratedDataChanged,
  restoreActiveLnkCancelledResults,
  withLnkFinalStatus,
} from '@/lib/lnk-field-updates'
import {
  clearCancelledPstoRequestWithoutResult,
  restoreActivePstoCancelledResult,
  withPendingPstoResultStatus,
} from '@/lib/psto-field-updates'
import { LNK_GENERATED_FIELD_KEYS } from '@/lib/report-config'
import { LEGACY_CONTROL_REPLACEMENT_VALUE } from '@/lib/control-availability-values'
import { hasAnyLnkGeneratedData, hasLnkReportEntry, withPendingLnkResults } from '@/lib/report-control-state'
import { isYesText, normalizeControlAvailabilityValue } from '@/lib/report-value-utils'
import { WELD_FIELDS, type WeldInput } from '@/lib/weld-fields'
import { normalizeWeldInput } from '@/lib/weld-import-export'
import type { WeldDraft } from '@/lib/dispatcher-types'

export type WeldFilters = {
  search?: string
  projectTitle?: string
  line?: string
  groupName?: string
  category?: string
  pstoRequired?: string
  weldingMethod?: string
  materialGroup?: string
  status?: string
  finalStatus?: string
  controlMethod?: string
}

export type WeldPayload = WeldDraft

const filterKeys = [
  'projectTitle',
  'line',
  'groupName',
  'category',
  'pstoRequired',
  'weldingMethod',
  'materialGroup',
  'status',
  'finalStatus',
] as const

const controlColumns = {
  ВИК: weldJoints.hasVik,
  РК: weldJoints.hasRk,
  ПВК: weldJoints.hasPvk,
  УЗК: weldJoints.hasUzk,
  ТВМТ: weldJoints.hasTvmt,
  РФА: weldJoints.hasRfa,
  СТЛС: weldJoints.hasStls,
  МКК: weldJoints.hasMkk,
} as const
const SYSTEM_FIELD_KEYS = new Set(['createdAt', 'updatedAt'])

export const listWeldJoints = createServerFn({ method: 'GET' })
  .validator((data: WeldFilters | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const db = requireDb()

    const where = buildWhere(data)
    return db
      .select()
      .from(weldJoints)
      .where(where)
      .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
      .limit(5000)
  })

export const createWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    const db = requireDb()
    const [created] = await db.insert(weldJoints).values(toDbInsert(data)).returning()
    return created
  })

export const updateWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    if (!data.id) throw new Error('Не передан id записи')
    const insertData = toDbInsert(data)
    const db = requireDb()

    const [updated] = await db
      .update(weldJoints)
      .set({ ...insertData, updatedAt: new Date() })
      .where(eq(weldJoints.id, data.id))
      .returning()
    return updated
  })

export const deleteWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const db = requireDb()

    await db.delete(weldJoints).where(eq(weldJoints.id, data.id))
    return { ok: true }
  })

export const importWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldInput[] }) => data)
  .handler(async ({ data }) => {
    if (data.records.length === 0) return { inserted: 0, rows: [] }
    const values = data.records.map(toDbInsert)
    const db = requireDb()

    const rows = await db.insert(weldJoints).values(values).returning()
    return { inserted: rows.length, rows }
  })

export const clearLnkGeneratedWeldData = createServerFn({ method: 'POST' }).handler(async () => {
  const db = requireDb()
  const rows = await db.select().from(weldJoints).limit(5000)
  const updatedRows = []

  for (const row of rows) {
    const weldRow = row as unknown as WeldInput & { id: number }
    const cleanedRow = clearLnkGeneratedData(weldRow)
    if (!hasLnkGeneratedDataChanged(weldRow, cleanedRow)) continue
    const updateData = [...LNK_GENERATED_FIELD_KEYS].reduce<Record<string, null>>((data, fieldKey) => {
      data[fieldKey] = null
      return data
    }, {})
    const { finalStatus } = withLnkFinalStatus(cleanedRow)
    const [updated] = await db
      .update(weldJoints)
      .set({ ...updateData, finalStatus, updatedAt: new Date() })
      .where(eq(weldJoints.id, row.id))
      .returning()
    if (updated) updatedRows.push(updated)
  }

  return updatedRows
})

function toDbInsert(input: WeldInput): NewWeldJoint {
  const normalized = prepareServerWeldInput(normalizeWeldInput(input))
  const data: Record<string, unknown> = {}

  for (const field of WELD_FIELDS) {
    if (SYSTEM_FIELD_KEYS.has(field.key)) continue
    if (field.key === 'pstoCreatedAt' || field.key === 'lnkCreatedAt') {
      data[field.key] = normalized[field.key] ? new Date(String(normalized[field.key])) : null
      continue
    }
    if (field.kind === 'boolean') {
      data[field.key] = normalizeControlAvailabilityValue(normalized[field.key])
      continue
    }
    data[field.key] = normalized[field.key] ?? null
  }
  if (isYesText(normalized.pstoRequired) && !normalized.pstoCreatedAt) {
    data.pstoCreatedAt = new Date()
  }
  if ((hasLnkReportEntry(normalized) || hasAnyLnkGeneratedData(normalized)) && !normalized.lnkCreatedAt) {
    data.lnkCreatedAt = new Date()
  }

  return data as NewWeldJoint
}

function prepareServerWeldInput<T extends WeldInput>(record: T): T {
  return withLnkFinalStatus(
    withPendingPstoResultStatus(
      withPendingLnkResults(
        clearDisabledLnkRequests(
          restoreActiveLnkCancelledResults(
            restoreActivePstoCancelledResult(clearCancelledRejectedLnkGeneratedData(clearCancelledPstoRequestWithoutResult(record))),
          ),
        ),
      ),
    ),
  )
}

function buildWhere(filters: WeldFilters) {
  const clauses = []

  if (filters.search?.trim()) {
    const search = `%${filters.search.trim()}%`
    clauses.push(
      or(
        ilike(weldJoints.joint, search),
        ilike(weldJoints.line, search),
        ilike(weldJoints.isometry, search),
        ilike(weldJoints.spool, search),
        ilike(weldJoints.element1, search),
        ilike(weldJoints.element2, search),
        ilike(weldJoints.material1, search),
        ilike(weldJoints.material2, search),
        ilike(weldJoints.materialUniqueNumber1, search),
        ilike(weldJoints.materialUniqueNumber2, search),
        ilike(weldJoints.materialFullName1, search),
        ilike(weldJoints.materialFullName2, search),
        ilike(weldJoints.materialNormativeDocument1, search),
        ilike(weldJoints.materialNormativeDocument2, search),
        ilike(weldJoints.materialCertificateNumber1, search),
        ilike(weldJoints.materialCertificateNumber2, search),
        ilike(weldJoints.responsible, search),
      ),
    )
  }

  for (const key of filterKeys) {
    const value = filters[key]
    if (value) clauses.push(eq(weldJoints[key], value))
  }

  if (filters.controlMethod && filters.controlMethod in controlColumns) {
    const column = controlColumns[filters.controlMethod as keyof typeof controlColumns]
    clauses.push(or(eq(column, 'да'), eq(column, 'дополнительный'), eq(column, LEGACY_CONTROL_REPLACEMENT_VALUE)))
  }

  return clauses.length ? and(...clauses) : sql`true`
}
