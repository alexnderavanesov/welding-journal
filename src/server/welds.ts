import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints, type NewWeldJoint } from '@/db/schema'
import { WELD_FIELDS, type WeldInput, calculateFinalStatus } from '@/lib/weld-fields'
import { normalizeWeldInput } from '@/lib/weld-import-export'

export type WeldFilters = {
  search?: string
  projectTitle?: string
  line?: string
  groupName?: string
  category?: string
  pstoRequired?: string
  weldingMethod?: string
  status?: string
  finalStatus?: string
  controlMethod?: string
}

export type WeldPayload = WeldInput & { id?: number }

const filterKeys = [
  'projectTitle',
  'line',
  'groupName',
  'category',
  'pstoRequired',
  'weldingMethod',
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
const lnkControlRequestPairs = [
  { enabledKey: 'hasVik', requestKey: 'vikRequest', resultKey: 'vikResult', conclusionKey: 'vikConclusion' },
  { enabledKey: 'hasRk', requestKey: 'rkRequest', resultKey: 'rkResult', conclusionKey: 'rkConclusion' },
  { enabledKey: 'hasPvk', requestKey: 'pvkRequest', resultKey: 'pvkResult', conclusionKey: 'pvkConclusion' },
  { enabledKey: 'hasUzk', requestKey: 'uzkRequest', resultKey: 'uzkResult', conclusionKey: 'uzkConclusion' },
  { enabledKey: 'hasTvmt', requestKey: 'tvmtRequest', resultKey: 'tvmtResult', conclusionKey: 'tvmtConclusion' },
  { enabledKey: 'hasRfa', requestKey: 'rfaRequest', resultKey: 'rfaResult', conclusionKey: 'rfaConclusion' },
  { enabledKey: 'hasStls', requestKey: 'stlsRequest', resultKey: 'stlsResult', conclusionKey: 'stlsConclusion' },
  { enabledKey: 'hasMkk', requestKey: 'mkkRequest', resultKey: 'mkkResult', conclusionKey: 'mkkConclusion' },
] as const satisfies ReadonlyArray<{
  enabledKey: keyof WeldInput
  requestKey: keyof WeldInput
  resultKey: keyof WeldInput
  conclusionKey: keyof WeldInput
}>
const lnkGeneratedFieldKeys = [
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'vikConclusionDate',
  'rkConclusionDate',
  'pvkConclusionDate',
  'uzkConclusionDate',
  'tvmtConclusionDate',
  'rfaConclusionDate',
  'stlsConclusionDate',
  'mkkConclusionDate',
  'vikConclusion',
  'rkConclusion',
  'pvkConclusion',
  'uzkConclusion',
  'tvmtConclusion',
  'rfaConclusion',
  'stlsConclusion',
  'mkkConclusion',
  'lnkDefectDescription',
  'lnkNote',
  'lnkCreatedAt',
] as const satisfies ReadonlyArray<keyof WeldInput>

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
    const db = requireDb()
    if (!data.id) throw new Error('Не передан id записи')
    const [updated] = await db
      .update(weldJoints)
      .set({ ...toDbInsert(data), updatedAt: new Date() })
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
    const db = requireDb()
    if (data.records.length === 0) return { inserted: 0, rows: [] }
    const values = data.records.map(toDbInsert)
    const rows = await db.insert(weldJoints).values(values).returning()
    return { inserted: rows.length, rows }
  })

export const clearLnkGeneratedWeldData = createServerFn({ method: 'POST' }).handler(async () => {
  const db = requireDb()
  const rows = await db.select().from(weldJoints).limit(5000)
  const updatedRows = []

  for (const row of rows) {
    const cleanedRow = clearLnkGeneratedData(row as WeldInput & { id: number })
    if (!hasLnkGeneratedDataChanged(row as WeldInput, cleanedRow)) continue
    const updateData = lnkGeneratedFieldKeys.reduce<Record<string, null>>((data, fieldKey) => {
      data[fieldKey] = null
      return data
    }, {})
    const finalStatus = calculateFinalStatus(cleanedRow)
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
  const normalized = withPendingLnkResults(clearDisabledLnkRequests(normalizeWeldInput(input)))
  const data: Record<string, unknown> = {}

  for (const field of WELD_FIELDS) {
    if (SYSTEM_FIELD_KEYS.has(field.key)) continue
    if (field.key === 'pstoCreatedAt' || field.key === 'lnkCreatedAt') {
      data[field.key] = normalized[field.key] ? new Date(String(normalized[field.key])) : null
      continue
    }
    if (field.kind === 'boolean' && isCancelledText(normalized[field.key])) {
      data[field.key] = null
      continue
    }
    data[field.key] = normalized[field.key] ?? null
  }
  if (isYesText(normalized.pstoRequired) && !normalized.pstoCreatedAt) {
    data.pstoCreatedAt = new Date()
  }
  if (hasAnyLnkGeneratedData(normalized) && !normalized.lnkCreatedAt) {
    data.lnkCreatedAt = new Date()
  }

  return data as NewWeldJoint
}

function isYesText(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'да'
}

function isEnabledControlValue(value: unknown) {
  if (value === true) return true
  return String(value ?? '').trim().toLowerCase() === 'да'
}

function isCancelledText(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'отменен'
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function clearDisabledLnkRequests<T extends WeldInput>(record: T): T {
  let nextRecord: (T & Record<string, unknown>) | null = null
  for (const pair of lnkControlRequestPairs) {
    if (isEnabledControlValue(record[pair.enabledKey]) || hasLnkMethodReportHistory(record, pair) || !hasText(record[pair.requestKey])) continue
    nextRecord = nextRecord ?? ({ ...record } as T & Record<string, unknown>)
    nextRecord[pair.requestKey] = null
  }
  return (nextRecord ?? record) as T
}

function withPendingLnkResults<T extends WeldInput>(record: T): T {
  let nextRecord: (T & Record<string, unknown>) | null = null
  for (const pair of lnkControlRequestPairs) {
    if (!hasText(record[pair.requestKey]) || hasText(record[pair.resultKey])) continue
    nextRecord = nextRecord ?? ({ ...record } as T & Record<string, unknown>)
    nextRecord[pair.resultKey] = 'ожидает НК'
  }
  return (nextRecord ?? record) as T
}

function hasLnkMethodReportHistory(record: WeldInput, pair: (typeof lnkControlRequestPairs)[number]) {
  return hasText(record[pair.resultKey]) && hasText(record[pair.conclusionKey])
}

function clearLnkGeneratedData<T extends WeldInput>(row: T): T {
  const nextRow = { ...row } as T & Record<string, unknown>
  for (const fieldKey of lnkGeneratedFieldKeys) {
    nextRow[fieldKey] = null
  }
  return nextRow as T
}

function hasLnkGeneratedDataChanged(left: WeldInput, right: WeldInput) {
  return lnkGeneratedFieldKeys.some((fieldKey) => String(left[fieldKey] ?? '') !== String(right[fieldKey] ?? ''))
}

function hasAnyLnkGeneratedData(record: WeldInput) {
  return lnkGeneratedFieldKeys.some((fieldKey) => fieldKey !== 'lnkCreatedAt' && hasText(record[fieldKey]))
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
        ilike(weldJoints.material1, search),
        ilike(weldJoints.material2, search),
        ilike(weldJoints.responsible, search),
      ),
    )
  }

  for (const key of filterKeys) {
    const value = filters[key]
    if (value) clauses.push(eq(weldJoints[key], value))
  }

  if (filters.controlMethod && filters.controlMethod in controlColumns) {
    clauses.push(eq(controlColumns[filters.controlMethod as keyof typeof controlColumns], true))
  }

  return clauses.length ? and(...clauses) : sql`true`
}
