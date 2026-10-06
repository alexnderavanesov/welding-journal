import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { generatedDocuments } from '@/db/schema'
import { loadSystemDocumentDateContext } from './system-document-index'

const state = vi.hoisted(() => ({ db: undefined as unknown }))
vi.mock('@/db', () => ({ requireDb: () => state.db }))
vi.mock('@/server/heat-treatment-control-relations', () => ({
  attachHeatTreatmentControlRelations: async (rows: unknown) => rows,
  attachPreHeatTreatmentControlRelations: async (rows: unknown) => rows,
}))
vi.mock('@/server/duplicate-control-relations', () => ({
  attachDuplicateControlRelations: async (rows: unknown) => rows,
}))

describe('system document row source load', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([24, 200_000])('reads shared metadata once, not once per %i welds', async count => {
    const fixture = mockDatabase(count)
    const result = await loadSystemDocumentDateContext({ type: 'lnkRequest', documentId: 7, title: 'R', date: '' })
    expect(result.rows).toHaveLength(count)
    expect(result.rows.at(-1)?.id).toBe(count)
    expect(result.sourcePositions).toHaveLength(count)
    expect(fixture.metadataReads()).toBe(1)
    expect(fixture.select).toHaveBeenCalledTimes(2)
    expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read', accessMode: 'read only',
    })
    expect(fixture.filters.some(filter => filter.params.includes('system:lnkRequest'))).toBe(true)
  })

  it('does not return assignments when the requested document is absent or has another type', async () => {
    const fixture = mockDatabase(0, false)
    const result = await loadSystemDocumentDateContext({ type: 'lnkRequest', documentId: 7, title: 'R', date: '' })
    expect(result).toEqual({ rows: [], sourcePositions: [] })
    expect(fixture.select).toHaveBeenCalledTimes(1)
    expect(fixture.filters[0]?.params).toEqual([7, 'system:lnkRequest', 1])
  })
})

function mockDatabase(count: number, exists = true) {
  let metadataReads = 0
  const filters: { sql: string; params: unknown[] }[] = []
  const sourcePositions = Array.from({ length: count }, (_, index) => ({
    kind: 'beforeHeatTreatment', weldJointId: index + 1, relationId: index + 1, methodCode: 'РК',
  }))
  const metadata = JSON.stringify({ sourceKind: 'beforeHeatTreatment', sourcePositions })
  const select = vi.fn((fields: Record<string, unknown>) => {
    let table: unknown
    let condition: unknown
    let limit: number | undefined
    const query = {
      from(value: unknown) { table = value; return query },
      innerJoin() { return query },
      where(value: unknown) { condition = value; return query },
      orderBy() { return query },
      limit(value: number) { limit = value; return query },
      then(resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) {
        if (condition) {
          const compiled = new PgDialect().sqlToQuery(condition as never)
          filters.push({ ...compiled, params: [...compiled.params, ...(limit ? [limit] : [])] })
        }
        const records = table === generatedDocuments
          ? (exists ? [{ sourceMetadata: metadata }] : [])
          : Array.from({ length: count }, (_, index) => ({ id: index + 1,
              ...('sourceMetadata' in fields ? { sourceMetadata: metadata } : {}),
            }))
        metadataReads += records.filter(row => 'sourceMetadata' in row).length
        return Promise.resolve(records).then(resolve, reject)
      },
    }
    return query
  })
  const db = { select, transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)) }
  state.db = db
  return { ...db, filters, metadataReads: () => metadataReads }
}
