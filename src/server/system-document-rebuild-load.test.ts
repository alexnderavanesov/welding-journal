import { beforeEach, expect, it, vi } from 'vitest'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SystemDocumentSummary } from '@/lib/system-document-types'
import { loadRebuildSnapshot, loadRebuildLockTargets, assertRebuildLocksCoverSnapshot } from './system-document-rebuild'
import { generatedDocuments, pstoRepeatCycles } from '@/db/schema'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { REBUILD_DOCUMENT_LIMIT, REBUILD_POSITION_LIMIT, type RebuildBatch } from '@/lib/system-document-rebuild-batch'

const batch: RebuildBatch = { cursor: { afterId: 0, throughId: 200_000 }, nextCursor: null, documentIds: [1], blocked: [],
  documentLimit: REBUILD_DOCUMENT_LIMIT, positionLimit: REBUILD_POSITION_LIMIT }
vi.mock('@/server/system-document-rebuild-batch', () => ({
  assertRebuildFactBudget: vi.fn(async () => {}), loadRebuildOccupiedNumbers: vi.fn(async () => new Map()),
}))

// Independent bound: the driver must never materialize a journal-sized result
// before Drizzle maps it. Every fact, including the last batch, is still read.
function selectedRows<T extends { id: number }>(rows: T[]) {
  const byId = new Map(rows.map(row => [row.id, row]))
  return async (where: SQL) => {
    const ids = new PgDialect().sqlToQuery(where).params[0] as number[]
    expect(ids.length).toBeLessThanOrEqual(5000)
    return ids.map(id => byId.get(id)).filter((row): row is T => Boolean(row))
  }
}

const state = vi.hoisted(() => ({ load: vi.fn(), settings: vi.fn(), numbers: vi.fn(), build: vi.fn() }))
vi.mock('@/server/system-document-index', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/system-document-index')>(), loadIndexedSystemDocumentSummaries: state.load,
}))
vi.mock('@/server/system-document-sequences', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/system-document-sequences')>(),
  readRequestConclusionSettings: state.settings, readSystemDocumentNextNumbers: state.numbers,
}))
vi.mock('@/lib/system-document-rebuild', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/system-document-rebuild')>(),
  buildSystemDocumentRebuildDocuments: state.build,
}))
beforeEach(() => {
  vi.clearAllMocks()
  state.settings.mockResolvedValue(REQUEST_CONCLUSION_DEFAULT_SETTINGS)
  state.numbers.mockResolvedValue({})
  state.build.mockReturnValue({ documents: [] })
})

it('rejects a document which grew to 200000 positions before loading any full facts', async () => {
  state.load.mockImplementation(async (_tx, type) => type === 'pstoRequest' ? [{
    documentId: 1, type, rowIds: [1], positionCount: 200_000,
  }] : [])
  const select = vi.fn()
  await expect(loadRebuildSnapshot({ select } as never, batch)).rejects.toThrow('сверх лимита пакета')
  expect(select).not.toHaveBeenCalled()
  expect(state.build).not.toHaveBeenCalled()
})

it('rejects new memberships after row locks instead of saving unlocked rows or locking in reverse order', () => {
  const sources = [{ document: { type: 'pstoRequest', rowIds: [1, 2] }, rows: [],
    cyclePositions: [{ position: { kind: 'pstoCycle', relationId: 9, weldJointId: 2, sequence: 2 } }] }]
  expect(() => assertRebuildLocksCoverSnapshot(sources as never, ['pstoRequest'], [1], [9])).toThrow('Состав стыков или циклов')
  expect(() => assertRebuildLocksCoverSnapshot(sources as never, ['pstoRequest'], [1, 2], [])).toThrow('Состав стыков или циклов')
  expect(() => assertRebuildLocksCoverSnapshot(sources as never, ['pstoRequest'], [1, 2], [9])).not.toThrow()
  expect(() => assertRebuildLocksCoverSnapshot(sources as never, ['pstoConclusion'], [], [])).not.toThrow()
})

it.each([24, 60_000])('discovers %i bounded lock targets without loading weld or cycle facts or calculating a preview', async count => {
  const ids = Array.from({ length: count }, (_, i) => i + 1)
  const metadata = JSON.stringify({ sourceKind: 'pstoCycle', sourcePositions: ids.map(id => ({
    kind: 'pstoCycle', weldJointId: id, relationId: id + count, sequence: 2,
  })) })
  state.load.mockImplementation(async (_tx, type) => type === 'pstoRequest' ? [
    { documentId: 1, type, sourceKind: 'pstoCycle', rowIds: ids },
    { documentId: 2, type, sourceKind: 'beforeHeatTreatment', rowIds: [count + 1] },
  ] : type === 'pstoConclusion' ? [{ documentId: 3, type, rowIds: [count + 2] }] : [])
  const select = vi.fn(() => ({ from: (table: unknown) => {
    expect(table).toBe(generatedDocuments)
    return { where: async () => [{ sourceMetadata: metadata }] }
  } }))
  const result = await loadRebuildLockTargets({ select } as never, ['pstoRequest'], [1, 2, 3])
  expect(result.rowIds).toEqual(ids)
  expect(result.cycleIds).toEqual(ids.map(id => id + count))
  expect(select).toHaveBeenCalledTimes(1)
  expect(state.load).toHaveBeenCalledTimes(4)
  expect(state.build).not.toHaveBeenCalled()
  expect(state.settings).not.toHaveBeenCalled()
  expect(state.numbers).not.toHaveBeenCalled()
})

it.each([24, REBUILD_DOCUMENT_LIMIT])('loads a complete bounded packet of %i documents without per-document SQL', async count => {
  const rows: WeldRow[] = Array.from({ length: count }, (_, i) => ({ id: i + 1, joint: `S${i + 1}` }))
  const documents = rows.map(row => ({ documentId: row.id, type: 'pstoRequest', title: `P${row.id}`,
    date: '2026-09-01', rowIds: [row.id], rowCount: 1, updatedAt: '' })) as SystemDocumentSummary[]
  state.load.mockImplementation(async (_tx, type) => type === 'pstoRequest' ? documents : [])
  const selectRows = selectedRows(rows)
  const select = vi.fn(() => ({ from: () => ({ where: selectRows }) }))
  const result = await loadRebuildSnapshot({ select } as never, batch)
  expect(result.sources).toHaveLength(count)
  expect(result.sources.at(-1)?.rows[0].id).toBe(count)
  expect(state.load).toHaveBeenCalledTimes(4)
  expect(state.settings).toHaveBeenCalledTimes(1)
  expect(state.numbers).toHaveBeenCalledTimes(1)
  expect(select).toHaveBeenCalledTimes(Math.ceil(count / 5000))
  expect(state.build.mock.calls[0][0].sources).toHaveLength(count)
}, 15_000)

it.each([24, 60_000])('loads %i permitted cycle positions with batched reads, not per-cycle queries', async count => {
  const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, joint: `S${i + 1}` }))
  const cycles = rows.map(row => ({ id: row.id + count, weldJointId: row.id, sequence: 2, pstoRequest: 'P', pstoRequestDate: '2026-09-01' }))
  const metadata = JSON.stringify({ sourceKind: 'pstoCycle', cycleSequences: [2], sourcePositions: cycles.map(cycle => ({
    kind: 'pstoCycle', weldJointId: cycle.weldJointId, relationId: cycle.id, sequence: 2,
  })) })
  const document = { documentId: 1, type: 'pstoRequest', sourceKind: 'pstoCycle', title: 'P', date: '2026-09-01',
    rowIds: rows.map(row => row.id), rowCount: count, updatedAt: '' }
  state.load.mockImplementation(async (_tx, type) => type === 'pstoRequest' ? [document] : [])
  const selectRows = selectedRows(rows), selectCycles = selectedRows(cycles)
  const select = vi.fn(() => ({ from: (table: unknown) => ({ where:
    table === generatedDocuments ? async () => [{ id: 1, sourceMetadata: metadata }] : table === pstoRepeatCycles ? selectCycles : selectRows }) }))
  const result = await loadRebuildSnapshot({ select } as never, batch)
  expect(select).toHaveBeenCalledTimes(1 + 2 * Math.ceil(count / 5000))
  expect(result.sources[0].cyclePositions).toHaveLength(count)
  expect(result.sources[0].cyclePositions?.at(-1)?.cycle).toEqual(cycles.at(-1))
  if (count === 24) {
    cycles[0].pstoRequestDate = '2026-09-02'
    const stale = await loadRebuildSnapshot({ select } as never, batch)
    expect(stale.preview.scopeRevisions.pstoRequest).not.toBe(result.preview.scopeRevisions.pstoRequest)
  }
}, 15_000)

it('bounds revision serialization by one record, while retaining every row and cycle fact in freshness checks', async () => {
  const rows = Array.from({ length: 32 }, (_, index) => ({ id: index + 1, joint: `S${index + 1}`,
    pstoNote: 'x'.repeat(4096), updatedAt: '2026-10-02T10:00:00.000Z' }))
  const cycles = rows.map(row => ({ id: row.id + 32, weldJointId: row.id, sequence: 2,
    pstoNote: 'y'.repeat(4096), pstoRequest: 'P', pstoRequestDate: '2026-09-01' }))
  const metadata = JSON.stringify({ sourceKind: 'pstoCycle', cycleSequences: [2], sourcePositions: cycles.map(cycle => ({
    kind: 'pstoCycle', weldJointId: cycle.weldJointId, relationId: cycle.id, sequence: 2,
  })) })
  const document = { documentId: 1, type: 'pstoRequest', sourceKind: 'pstoCycle', title: 'P', date: '2026-09-01',
    rowIds: rows.map(row => row.id), rowCount: rows.length, updatedAt: '' }
  state.load.mockImplementation(async (_tx, type) => type === 'pstoRequest' ? [document] : [])
  const select = vi.fn(() => ({ from: (table: unknown) => ({ where: async () =>
    table === generatedDocuments ? [{ id: 1, sourceMetadata: metadata }] : table === pstoRepeatCycles ? cycles : rows }) }))
  const stringify = JSON.stringify
  let largest = 0
  const spy = vi.spyOn(JSON, 'stringify').mockImplementation((...args: Parameters<typeof JSON.stringify>) => {
    const serialized = stringify(...args)
    largest = Math.max(largest, serialized?.length ?? 0)
    return serialized
  })
  try {
    const revision = async () => (await loadRebuildSnapshot({ select } as never, batch)).preview.scopeRevisions.pstoRequest
    const original = await revision()
    expect(await revision()).toBe(original)
    rows.at(-1)!.pstoNote = 'changed row fact'
    const rowChanged = await revision()
    expect(rowChanged).not.toBe(original)
    cycles.at(-1)!.pstoNote = 'changed cycle fact'
    expect(await revision()).not.toBe(rowChanged)
    // The production 200k fixture previously exceeded V8's single-string
    // limit. This small regression detects the same aggregation without OOM.
    expect(largest).toBeLessThan(16_384)
  } finally { spy.mockRestore() }
})

it('still hashes facts in later batches when all IDs from the first batch have disappeared', async () => {
  const row = { id: 5001, joint: 'S5001', pstoNote: 'Original fact' }
  state.load.mockImplementation(async (_tx, type) => type === 'pstoRequest' ? [{
    documentId: 1, type, title: 'P', date: '2026-09-01',
    rowIds: Array.from({ length: 5001 }, (_, index) => index + 1), rowCount: 5001, updatedAt: '',
  }] : [])
  const select = vi.fn(() => ({ from: () => ({ where: selectedRows([row]) }) }))
  const revision = async () => (await loadRebuildSnapshot({ select } as never, batch)).preview.scopeRevisions.pstoRequest
  const original = await revision()
  row.pstoNote = 'Changed fact'
  expect(await revision()).not.toBe(original)
  expect(select).toHaveBeenCalledTimes(4)
})

it('retains populated facts but not wide empty columns, hashing nulls before compaction', async () => {
  const row = { id: 1, joint: 'S1', pstoRequest: 'P', pstoNote: null as string | null,
    wdi: 0, officiality: '', ...Object.fromEntries(Array.from({ length: 140 }, (_, i) => [`empty${i}`, null])) }
  state.load.mockImplementation(async (_tx, type) => type === 'pstoRequest' ? [{
    documentId: 1, type, title: 'P', date: '2026-09-01', rowIds: [1], rowCount: 1, updatedAt: '',
  }] : [])
  const select = vi.fn(() => ({ from: () => ({ where: selectedRows([row]) }) }))
  const original = await loadRebuildSnapshot({ select } as never, batch)
  expect(original.sources[0].rows[0]).toEqual({ id: 1, joint: 'S1', pstoRequest: 'P', wdi: 0, officiality: '' })
  expect(row.pstoNote).toBeNull() // Never mutate the driver's/source record.
  row.pstoNote = ''
  const changed = await loadRebuildSnapshot({ select } as never, batch)
  expect(changed.preview.scopeRevisions.pstoRequest).not.toBe(original.preview.scopeRevisions.pstoRequest)
  expect(changed.sources[0].rows[0].pstoNote).toBe('')
})
