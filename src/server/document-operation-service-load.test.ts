import { beforeEach, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { getTableColumns, type SQL } from 'drizzle-orm'
import { generatedDocuments, pstoRepeatCycles, preHeatTreatmentControls, weldJoints } from '@/db/schema'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentSummaries, type SystemDocumentSummary } from '@/lib/system-document-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import { REBUILD_DOCUMENT_LIMIT, REBUILD_FACT_BYTES_LIMIT } from '@/lib/system-document-rebuild-batch'
import { assertDocumentOperationLockCoverage, checkOperationNameConflicts, getOperationComposition, loadDocumentOperationSelection, loadDocumentOperationSnapshot, normalizeOperationRequest, planOperationBatches, previewOperation } from './document-operation-service'

const mocks = vi.hoisted(() => ({ load: vi.fn(), settings: vi.fn(), numbers: vi.fn(), transaction: vi.fn(), budget: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: mocks.transaction }) }))
vi.mock('./security-functions', () => ({ assertSecurityScope: vi.fn(async () => {}) }))
vi.mock('./system-document-rebuild-batch', async original => ({
  ...await original<typeof import('./system-document-rebuild-batch')>(),
  assertRebuildFactBudget: mocks.budget, loadRebuildOccupiedNumbers: vi.fn(async () => new Map()),
}))
vi.mock('./system-document-index', async original => ({
  ...await original<typeof import('./system-document-index')>(),
  initializeSystemDocumentIndexesInTransaction: vi.fn(async () => {}), loadIndexedSystemDocumentSummaries: mocks.load,
}))
vi.mock('./system-document-sequences', async original => ({
  ...await original<typeof import('./system-document-sequences')>(),
  readRequestConclusionSettings: mocks.settings, readSystemDocumentNextNumbers: mocks.numbers,
}))

const columns = getTableColumns(weldJoints)
type Fact = { id: number; [key: string]: unknown }
let documents: SystemDocumentSummary[], rows: Fact[], cycles: Fact[], controls: Fact[]
let metadata: Map<number, object>
let catalogOverride: Array<{ documentId: number; title: string; positionCount: number; metadataBytes: number }> | undefined
let factBytes: Map<number, number>
const dialect = new PgDialect()
const compile = (query: SQL) => dialect.sqlToQuery(query)
const catalog = () => catalogOverride ?? documents.map(doc => ({ documentId: doc.documentId, title: doc.title,
  positionCount: doc.positionCount ?? doc.rowIds.length, metadataBytes: Buffer.byteLength(JSON.stringify(metadata.get(doc.documentId) ?? {})) }))

function connection() {
  const reads: Array<{ table: unknown; ids: number[] }> = []
  const execute = vi.fn(async (query: SQL) => {
    const compiled = compile(query)
    if (/select distinct d\.id, d\.type/.test(compiled.sql)) return { rows: [] }
    return { rows: / as bytes\b/.test(compiled.sql)
      ? (compiled.params.at(-1) as number[]).map(id => ({ id, bytes: factBytes.get(id) ?? 100 }))
      : catalog() }
  })
  const select = vi.fn(() => ({ from: (table: unknown) => ({ where: (query: SQL) => {
    const ids = compile(query).params[0] as number[]
    reads.push({ table, ids })
    let result: unknown[]
    if (table === generatedDocuments) result = ids.map(id => ({ id, value: metadata.get(id) ?? {}, sourceMetadata: metadata.get(id) ?? {} }))
    else {
      if (table === weldJoints || table === pstoRepeatCycles) expect(ids.length).toBeLessThanOrEqual(5000)
      const selected = new Set(ids)
      const records = (table === weldJoints ? rows : table === pstoRepeatCycles ? cycles : controls).filter(row => selected.has(row.id))
      result = table === weldJoints ? records.map(row => ({ facts: Object.fromEntries(Object.entries(row)
        .filter(([key, value]) => key in columns && value !== null)
        .map(([key, value]) => [columns[key as keyof typeof columns].name, value])) })) : records
    }
    const promise = Promise.resolve(result)
    return Object.assign(promise, { orderBy: () => promise })
  } }) }))
  const tx = { execute, select }
  mocks.transaction.mockImplementation(async callback => callback(tx))
  return { tx: tx as never, execute, select, reads }
}
function cycleFixture(count: number) {
  rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, joint: `S${i + 1}`, pstoNote: 'Primary fact' }))
  cycles = rows.map(row => ({ id: row.id + count, weldJointId: row.id, sequence: 2, pstoRequest: 'P', pstoRequestDate: '2026-09-01' }))
  metadata.set(1, { sourceKind: 'pstoCycle', sourcePositions: cycles.map(cycle => ({
    kind: 'pstoCycle', weldJointId: cycle.weldJointId, relationId: cycle.id, sequence: 2,
  })) })
  documents = [{ documentId: 1, type: 'pstoRequest', sourceKind: 'pstoCycle', title: 'P', date: '2026-09-01',
    rowIds: rows.map(row => row.id), rowCount: count, positionCount: count }] as SystemDocumentSummary[]
}
beforeEach(() => {
  vi.clearAllMocks(); documents = []; rows = []; cycles = []; controls = []; metadata = new Map(); factBytes = new Map(); catalogOverride = undefined
  mocks.load.mockImplementation(async (_tx, type) => documents.filter(doc => doc.type === type))
  mocks.settings.mockResolvedValue(REQUEST_CONCLUSION_DEFAULT_SETTINGS); mocks.numbers.mockResolvedValue({})
})

it('rejects a document grown to 200000 positions before materializing metadata or facts', async () => {
  catalogOverride = [{ documentId: 1, title: 'P', positionCount: 200_000, metadataBytes: 100 }]
  const { tx, select, execute } = connection()
  await expect(loadDocumentOperationSnapshot(tx, [1])).rejects.toThrow('безопасный объём пакета')
  expect(select).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled()
  const sql = compile(execute.mock.calls[0][0])
  expect(sql.params).toContainEqual([1])
  expect(sql.params).toContainEqual(expect.arrayContaining(['system:pstoRequest', 'system:tvmtConclusion']))
  expect(sql.sql).toContain("->>'positionCount'")
  expect(sql.sql).not.toContain('select "weld_joints".*')
})

it.each(['rowIds', 'cycleIds', 'controlIds'] as const)('rejects changed %s after locks without acquiring late reverse-order locks', key => {
  const initial = { rowIds: [1], cycleIds: [2], controlIds: [3] }
  expect(() => assertDocumentOperationLockCoverage(initial, { ...initial, [key]: [99] })).toThrow('Проверить изменения')
  expect(() => assertDocumentOperationLockCoverage(initial, structuredClone(initial))).not.toThrow()
})

it.each([24, 60_000])('discovers %i cycle lock targets without loading facts or calculating names', async count => {
  cycleFixture(count)
  const { tx, select, reads } = connection()
  const result = await loadDocumentOperationSelection(tx, [1])
  expect(result.rowIds).toEqual(rows.map(row => row.id)); expect(result.cycleIds).toEqual(cycles.map(cycle => cycle.id))
  expect(result.controlIds).toEqual([]); expect(select).toHaveBeenCalledOnce(); expect(reads[0].table).toBe(generatedDocuments)
  expect(mocks.load).toHaveBeenCalledTimes(4); expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled()
})

it('includes before-TO controls in the real lock and freshness snapshot', async () => {
  rows = [{ id: 1, joint: 'S1' }]; controls = [{ id: 42, weldJointId: 1, method: 'ВИК', requestName: 'Q' }]
  documents = [{ documentId: 1, type: 'lnkRequest', sourceKind: 'beforeHeatTreatment', title: 'Q', rowIds: [1] }] as SystemDocumentSummary[]
  metadata.set(1, { sourceKind: 'beforeHeatTreatment', sourcePositions: [{ kind: 'beforeHeatTreatment', weldJointId: 1, relationId: 42, methodCode: 'ВИК' }] })
  const { tx, reads } = connection(), first = await loadDocumentOperationSnapshot(tx, [1])
  expect(first.controlIds).toEqual([42]); expect(first.sources[0].controls?.[0].control).toEqual(controls[0])
  expect(reads.filter(read => read.table === preHeatTreatmentControls)).toHaveLength(1)
  expect(mocks.budget).toHaveBeenCalledWith(tx, [1], [], [42])
  controls[0].requestName = 'Changed'
  expect((await loadDocumentOperationSnapshot(tx, [1])).fingerprint).not.toBe(first.fingerprint)
})

it.each([24, REBUILD_DOCUMENT_LIMIT])('loads %i selected documents without one query per document', async count => {
  rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, joint: `S${i + 1}` }))
  documents = rows.map(row => ({ documentId: row.id, type: 'pstoRequest', title: `P${row.id}`, date: '2026-09-01', rowIds: [row.id] })) as SystemDocumentSummary[]
  const { tx, select } = connection(), result = await loadDocumentOperationSnapshot(tx, documents.map(doc => doc.documentId))
  expect(result.sources).toHaveLength(count); expect(result.sources.at(-1)?.rows[0].id).toBe(count)
  expect(mocks.load).toHaveBeenCalledTimes(4); expect(mocks.settings).toHaveBeenCalledOnce(); expect(mocks.numbers).toHaveBeenCalledOnce()
  expect(select).toHaveBeenCalledTimes(1 + Math.ceil(count / 5000))
})

it.each([24, 60_000])('reads all %i exact cycles in bounded batches and fingerprints their actual facts', async count => {
  cycleFixture(count)
  const { tx, select } = connection(), result = await loadDocumentOperationSnapshot(tx, [1])
  expect(select).toHaveBeenCalledTimes(2 + 2 * Math.ceil(count / 5000))
  expect(result.sources[0].cyclePositions).toHaveLength(count)
  expect(result.sources[0].cyclePositions?.at(-1)?.cycle).toEqual(cycles.at(-1))
  if (count === 24) {
    cycles[0].pstoRequestDate = '2026-09-02'
    expect((await loadDocumentOperationSnapshot(tx, [1])).fingerprint).not.toBe(result.fingerprint)
  }
}, 15_000)

it('hashes wide row/cycle facts one record at a time rather than concatenating all facts', async () => {
  cycleFixture(32)
  rows.forEach(row => { row.pstoNote = 'x'.repeat(4096) }); cycles.forEach(cycle => { cycle.pstoNote = 'y'.repeat(4096) })
  const { tx } = connection(), stringify = JSON.stringify
  let largest = 0
  const spy = vi.spyOn(JSON, 'stringify').mockImplementation((...args: Parameters<typeof JSON.stringify>) => {
    const value = stringify(...args); largest = Math.max(largest, value?.length ?? 0); return value
  })
  try {
    const revision = async () => (await loadDocumentOperationSnapshot(tx, [1])).fingerprint
    const original = await revision(); expect(await revision()).toBe(original)
    rows.at(-1)!.pstoNote = 'Changed row'; const changed = await revision(); expect(changed).not.toBe(original)
    cycles.at(-1)!.pstoNote = 'Changed cycle'; expect(await revision()).not.toBe(changed)
    expect(largest).toBeLessThan(16_384)
  } finally { spy.mockRestore() }
})

it('reads and fingerprints later batches even if the first batch disappeared', async () => {
  rows = [{ id: 5001, pstoNote: 'Original' }]
  documents = [{ documentId: 1, type: 'pstoRequest', title: 'P', rowIds: Array.from({ length: 5001 }, (_, i) => i + 1) }] as SystemDocumentSummary[]
  const { tx, reads } = connection(), original = await loadDocumentOperationSnapshot(tx, [1])
  rows[0].pstoNote = 'Changed'
  expect((await loadDocumentOperationSnapshot(tx, [1])).fingerprint).not.toBe(original.fingerprint)
  expect(reads.filter(read => read.table === weldJoints)).toHaveLength(4)
})

it('retains populated facts and detects null-to-empty changes without mutating input records', async () => {
  rows = [{ id: 1, joint: 'S1', pstoNote: null, wdi: 0, officiality: '' }]
  documents = [{ documentId: 1, type: 'pstoRequest', title: 'P', rowIds: [1] }] as SystemDocumentSummary[]
  const { tx } = connection(), original = await loadDocumentOperationSnapshot(tx, [1])
  expect(original.sources[0].rows[0]).toEqual({ id: 1, joint: 'S1', wdi: 0, officiality: '' }); expect(rows[0].pstoNote).toBeNull()
  rows[0].pstoNote = ''
  const changed = await loadDocumentOperationSnapshot(tx, [1])
  expect(changed.fingerprint).not.toBe(original.fingerprint); expect(changed.sources[0].rows[0].pstoNote).toBe('')
})

it('splits by full fact bytes before returning wide facts to Node', async () => {
  catalogOverride = [1, 2].map(documentId => ({ documentId, title: `D${documentId}`, positionCount: 10, metadataBytes: 100 }))
  factBytes = new Map([[1, 40 * 1024 * 1024], [2, 40 * 1024 * 1024]])
  const { select, execute } = connection()
  expect((await planOperationBatches({ documentIds: [1, 2], merge: false })).batches).toEqual([[1], [2]])
  expect(execute).toHaveBeenCalledTimes(2); expect(select).not.toHaveBeenCalled()
})

it('probes later candidates before admitting them after an oversized document', async () => {
  catalogOverride = [1, 2].map(documentId => ({ documentId, title: `D${documentId}`, positionCount: 40_000, metadataBytes: 100 }))
  factBytes = new Map([[1, REBUILD_FACT_BYTES_LIMIT + 1], [2, 100]])
  const { select, execute } = connection(), result = await planOperationBatches({ documentIds: [1, 2], merge: false })
  expect(result.batches).toEqual([[2]]); expect(result.blocked.map(item => item.documentId)).toEqual([1])
  expect(execute).toHaveBeenCalledTimes(3); expect(select).not.toHaveBeenCalled()
  expect(execute.mock.calls.slice(1).map(([query]) => compile(query).params.at(-1))).toEqual([[1], [2]])
})

it('blocks collision with an unselected legacy first-cycle document through the current name check', async () => {
  const group = { name: 'Occupied', reference: { type: 'pstoRequest', date: '2026-09-01', sourceKind: 'pstoCycle' }, error: '' }
  const execute = vi.fn(async () => ({ rows: [{ id: 9, type: 'system:pstoRequest', title: 'Occupied', date: '2026-09-01', method: null, source: null }] }))
  await checkOperationNameConflicts({ execute } as never, [group] as never, [1])
  expect(group.error).toContain('вне выбора'); expect(execute).toHaveBeenCalledOnce()
})

it.each([10, 60_000])('transports summaries for %i positions and serves first/middle/last composition pages without truncation', async count => {
  cycleFixture(count)
  const { execute, select } = connection()
  const request = { documentIds: [1], action: 'rename' as const, mode: 'none' as const, merge: false }
  const preview = await previewOperation(request)
  expect(preview).toMatchObject({ selectedCount: 1, rowCount: count, positionCount: count })
  expect(preview.groups).toHaveLength(1)
  expect(preview.groups[0]).toMatchObject({ sourceIds: [1], rowCount: count, positionCount: count, unchanged: true })
  for (const field of ['rows', 'rowIds', 'positions', 'cyclePositions']) expect(preview.groups[0]).not.toHaveProperty(field)
  const serialized = JSON.stringify(preview)
  expect(Buffer.byteLength(serialized)).toBeLessThan(4096)
  // Custom names have no number; JSON omits that optional undefined property.
  expect(JSON.parse(serialized)).toEqual({ ...preview, groups: preview.groups.map(({ systemNumber: _number, ...group }) => group) })
  const queryCounts = [execute.mock.calls.length, select.mock.calls.length]
  for (const page of new Set([0, Math.floor(count / 100), Math.ceil(count / 50) - 1])) {
    const composition = await getOperationComposition({ ...request, fingerprint: preview.fingerprint, groupKey: preview.groups[0].key, query: '', page })
    expect(composition).toMatchObject({ page, total: count, totalPositions: count })
    const start = page * 50, length = Math.min(50, count - start)
    expect(composition.items.map(item => [item.joint, item.cycle, item.source])).toEqual(
      Array.from({ length }, (_, i) => [`S${start + i + 1}`, 2, 'P']),
    )
  }
  expect([execute.mock.calls.length, select.mock.calls.length]).toEqual(queryCounts)
}, 15_000)

it('counts shared joints once but keeps each method position and unchanged selected document in the preview', async () => {
  rows = [{ id: 1, joint: 'S1', vikConclusion: 'V', vikConclusionDate: '2026-09-01', rkConclusion: 'R', rkConclusionDate: '2026-09-01' }]
  documents = buildSystemDocumentSummaries(rows as WeldRow[], 'lnkConclusion').map((document, i) => ({ ...document, documentId: i + 1 }))
  connection()
  const result = await previewOperation({ documentIds: [2, 1], action: 'rename', mode: 'none', merge: false })
  expect(result).toMatchObject({ selectedCount: 2, rowCount: 1, positionCount: 2 })
  expect(result.sources.map(source => source.id)).toEqual([1, 2])
  expect(result.groups).toHaveLength(2)
  expect(result.groups.every(group => group.unchanged && group.rowCount === 1 && group.positionCount === 1)).toBe(true)
  expect(new Set(result.groups.map(group => group.name))).toEqual(new Set(['V', 'R']))
})

it.each([
  { ids: [] }, { ids: [0] }, { ids: [-1] }, { ids: [0.5] }, { ids: [1, 1] },
  { ids: [Number.MAX_SAFE_INTEGER + 1] }, { ids: Array.from({ length: REBUILD_DOCUMENT_LIMIT + 1 }, (_, i) => i + 1) },
])('rejects invalid explicit selections instead of accepting the obsolete cursor protocol: $ids', ({ ids }) => {
  expect(() => normalizeOperationRequest({ documentIds: ids, action: 'rename', mode: 'none', merge: false })).toThrow('различных документов')
  expect(mocks.transaction).not.toHaveBeenCalled()
})
