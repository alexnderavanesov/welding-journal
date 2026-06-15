import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints, type NewWeldJoint } from '@/db/schema'
import { WELD_FIELDS, type WeldInput } from '@/lib/weld-fields'
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

function toDbInsert(input: WeldInput): NewWeldJoint {
  const normalized = normalizeWeldInput(input)
  const data: Record<string, unknown> = {}

  for (const field of WELD_FIELDS) {
    if (SYSTEM_FIELD_KEYS.has(field.key)) continue
    if (field.key === 'pstoCreatedAt') {
      data[field.key] = normalized.pstoCreatedAt ? new Date(String(normalized.pstoCreatedAt)) : null
      continue
    }
    data[field.key] = normalized[field.key] ?? null
  }
  if (isYesText(normalized.pstoRequired) && !normalized.pstoCreatedAt) {
    data.pstoCreatedAt = new Date()
  }

  return data as NewWeldJoint
}

function isYesText(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'да'
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
