import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { generatedDocuments } from '@/db/schema'
import { loadSystemDocumentDateContext } from './system-document-index'
import { accessContext } from './access-store'
import type { AccessIdentity } from '@/lib/access-permissions'

const state = vi.hoisted(() => ({ db: undefined as unknown }))
const reference = { type: 'lnkRequest' as const, documentId: 7, title: 'R', date: '', sourceKind: 'beforeHeatTreatment' as const, methodCode: 'РК' }
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
    const result = await loadSystemDocumentDateContext(reference)
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
    const result = await loadSystemDocumentDateContext(reference)
    expect(result).toEqual({ rows: [], sourcePositions: [] })
    expect(fixture.select).toHaveBeenCalledTimes(1)
    expect(fixture.filters[0]?.params).toEqual(['system:lnkRequest', 7])
  })

  it.each([
    { type: 'system:tvmtRequest' },
    { title: 'Another document' },
    { periodFrom: '2026-11-01' },
    { sourceMetadata: JSON.stringify({ sourceKind: 'pstoRepeat', methodCode: 'РК' }) },
    { sourceMetadata: JSON.stringify({ sourceKind: 'beforeHeatTreatment', methodCode: 'ВИК' }) },
    { sourceMetadata: JSON.stringify({ sourceKind: 'beforeHeatTreatment', methodCode: 'РК', cycleSequences: [2] }) },
  ])('rejects a forged or stale reference before reading any members: %o', async stored => {
    const fixture = mockDatabase(1, true, stored)
    expect(await loadSystemDocumentDateContext(reference)).toEqual({ rows: [], sourcePositions: [] })
    expect(fixture.select).toHaveBeenCalledTimes(1)
  })

  it('resolves a source reference without an ID by its real stored identity', async () => {
    const fixture = mockDatabase(2)
    expect((await loadSystemDocumentDateContext({ ...reference, documentId: undefined })).rows).toHaveLength(2)
    expect(fixture.select).toHaveBeenCalledTimes(2)
    expect(fixture.filters[0].params).toEqual(['system:lnkRequest', 'R', ''])
  })

  it('preserves a primary no-ID count before materialization without searching another specialty', async () => {
    const fixture = mockDatabase(2, false)
    expect((await loadSystemDocumentDateContext({ type: 'lnkRequest', title: 'R', date: '' })).rows).toHaveLength(2)
    expect(fixture.select).toHaveBeenCalledTimes(2)
    expect(fixture.filters[1].sql).toContain('"vik_request"')
    expect(fixture.filters[1].sql).not.toContain('"tvmt_request"')
    expect(fixture.filters[1].params.every(value => value === 'R' || value === '')).toBe(true)
  })

  it('uses the same canonical TVMT method for permission and legacy row lookup', async () => {
    const fixture = mockDatabase(2, false)
    await loadSystemDocumentDateContext({ type: 'lnkRequest', title: 'R', date: '', methodCode: 'твмт' })
    expect(fixture.filters[0].params).toContain('system:tvmtRequest')
    expect(fixture.filters[1].sql).toContain('"tvmt_request"')
    expect(fixture.filters[1].sql).not.toContain('"vik_request"')
  })

  it('denies a foreign specialty before any document query', async () => {
    const fixture = mockDatabase(1)
    const identity: AccessIdentity = { id: 'psto-only', name: '', email: '', title: '', role: 'user', permissions: ['psto.view'], revision: 1 }
    await expect(accessContext.run({ identity, area: 'psto', permissions: ['psto.view'], operation: 'getSystemDocumentDateContext', operationId: 'test' },
      () => loadSystemDocumentDateContext(reference))).rejects.toThrow('Недостаточно прав')
    expect(fixture.select).not.toHaveBeenCalled()
  })

  it('does not read a partial-method primary request as a whole document', async () => {
    const fixture = mockDatabase(1)
    await expect(loadSystemDocumentDateContext({ type: 'lnkRequest', title: 'Shared', date: '', methodCode: 'ВИК' }))
      .rejects.toThrow('для всех видов контроля')
    expect(fixture.select).not.toHaveBeenCalled()
  })
})

function mockDatabase(count: number, exists = true, stored: Record<string, unknown> = {}) {
  let metadataReads = 0
  const filters: { sql: string; params: unknown[] }[] = []
  const sourcePositions = Array.from({ length: count }, (_, index) => ({
    kind: 'beforeHeatTreatment', weldJointId: index + 1, relationId: index + 1, methodCode: 'РК',
  }))
  const metadata = JSON.stringify({ sourceKind: 'beforeHeatTreatment', methodCode: 'РК', sourcePositions })
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
          ? (exists ? [{ id: 7, type: 'system:lnkRequest', title: 'R', periodFrom: null, sourceMetadata: metadata, ...stored }] : [])
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
