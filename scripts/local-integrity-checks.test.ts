import { expect, it } from 'vitest'
import { inspectHistoricalRelations } from './local-integrity-checks'
import type { WeldRow } from '../src/lib/dispatcher-types'

const empty = { rows: [] as WeldRow[], documents: [], links: [], preControls: [], cycles: [], chainStates: [] }
const document = (id: number, type: string, title: string, rowCount: number, metadata: unknown = {}) => ({ id, type: `system:${type}`, title, periodFrom: '2026-10-29', rowCount, sourceMetadata: JSON.stringify(metadata) })
it('checks facts back to registry positions, including a request with no result', () => {
  const rows = [{ id: 1, pstoRequest: 'request', pstoRequestDate: '2026-10-29' }] as WeldRow[]
  const data = { ...empty, rows, checkUnindexedFacts: true }
  expect(inspectHistoricalRelations(data)).toEqual([{ code: 'FACT_WITHOUT_INDEXED_DOCUMENT_POSITION', category: 'derived', ids: [1, 1] }])
  expect(inspectHistoricalRelations({ ...data, documents: [document(1, 'pstoRequest', 'request', 1)], links: [{ documentId: 1, weldJointId: 1 }] })).toEqual([])
})
it('accepts one result for different requests without requiring equal original request dates', () => {
  const rows = [1, 2].map(id => ({ id, vikRequest: `request-${id}`, vikRequestDate: `2026-10-0${id}`, vikConclusion: 'shared', vikConclusionDate: '2026-10-29' })) as WeldRow[]
  expect(inspectHistoricalRelations({ ...empty, rows, documents: [document(1, 'lnkConclusionVik', 'shared', 2, { methodCode: 'ВИК' })],
    links: rows.map(row => ({ documentId: 1, weldJointId: row.id })) })).toEqual([])
})
it('checks a large document without pairwise scans and still reports duplicate links', () => {
  const rows = Array.from({ length: 200_000 }, (_, index) => ({ id: index + 1, pstoRequest: 'shared', pstoRequestDate: '2026-10-29' })) as WeldRow[]
  const links = rows.map(row => ({ documentId: 1, weldJointId: row.id }))
  links.push(links[0])
  expect(inspectHistoricalRelations({ ...empty, rows, documents: [document(1, 'pstoRequest', 'shared', rows.length)], links }))
    .toEqual([{ code: 'DUPLICATE_DOCUMENT_LINK', category: 'relation', ids: [1, 1] }])
}, 10_000)
it('keeps request-only primary/repeat cycles and detects a relation pointing at another joint', () => {
  const rows = [{ id: 1, pstoRequest: 'shared', pstoRequestDate: '2026-10-29' }, { id: 2, pstoRequest: 'old', pstoRequestDate: '2026-10-01' }] as WeldRow[]
  const cycle = { id: 7, weldJointId: 2, sequence: 2, pstoRequest: 'shared', pstoRequestDate: '2026-10-29' }
  const positions = [{ kind: 'pstoCycle', weldJointId: 1, relationId: 1, sequence: 1 }, { kind: 'pstoCycle', weldJointId: 2, relationId: 7, sequence: 2 }]
  const data = { ...empty, rows, cycles: [cycle], documents: [document(1, 'pstoRequest', 'shared', 2, { sourceKind: 'pstoCycle', sourcePositions: positions })],
    links: [{ documentId: 1, weldJointId: 1 }, { documentId: 1, weldJointId: 2 }] }
  expect(inspectHistoricalRelations(data)).toEqual([])
  expect(inspectHistoricalRelations({ ...data, cycles: [{ ...cycle, weldJointId: 1 }] })).toContainEqual({ code: 'WRONG_CYCLE_POSITION', category: 'relation', ids: [1, 7] })
})
it('distinguishes derived counts/composition from orphan links and duplicate repeat identities', () => {
  const result = inspectHistoricalRelations({ ...empty, rows: [{ id: 1 }] as WeldRow[],
    documents: [document(1, 'pstoRequest', 'missing fact', 3)], links: [{ documentId: 1, weldJointId: 1 }, { documentId: 2, weldJointId: 999 }],
    cycles: [{ id: 5, weldJointId: 1, sequence: 2 }, { id: 6, weldJointId: 1, sequence: 2 }] })
  expect(result).toEqual(expect.arrayContaining([
    { code: 'ORPHAN_DOCUMENT_LINK', category: 'relation', ids: [2, 999] },
    { code: 'INVALID_REPEAT_SEQUENCE', category: 'relation', ids: [6] },
    { code: 'SYSTEM_DOCUMENT_ROW_COUNT', category: 'derived', ids: [1] },
    { code: 'DOCUMENT_FACT_COMPOSITION_MISMATCH', category: 'derived', ids: [1] },
  ]))
})
it('retains deleted predecessor tombstones and empty historical documents, but detects actual predecessor loops', () => {
  const chainStates = [{ weldJointId: 1, kind: 'primary' as const, physicalRootId: 1, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: false },
    { weldJointId: 2, kind: 'repair' as const, physicalRootId: 1, sourceRowId: 1, coilParentId: null, coilSide: null, replacedByCoil: false }]
  const data = { ...empty, rows: [{ id: 2 }] as WeldRow[], chainStates, documents: [document(1, 'lnkRequest', 'historical', 0)] }
  expect(inspectHistoricalRelations(data)).toEqual([])
  expect(inspectHistoricalRelations({ ...data, chainStates: [{ ...chainStates[0], sourceRowId: 2 }, chainStates[1]] })).toContainEqual({ code: 'CHAIN_PREDECESSOR_CYCLE', category: 'relation', ids: [1] })
})
it('reports malformed metadata without crashing or silently normalizing the evidence', () => {
  const data = { ...empty, rows: [{ id: 1 }] as WeldRow[], links: [{ documentId: 1, weldJointId: 1 }] }
  expect(inspectHistoricalRelations({ ...data, documents: [{ ...document(1, 'pstoRequest', 'x', 1), sourceMetadata: '{broken' }] })).toEqual([{ code: 'INVALID_SYSTEM_DOCUMENT_METADATA', category: 'derived', ids: [1] }])
  expect(inspectHistoricalRelations({ ...data, documents: [document(1, 'pstoRequest', 'x', 1, { sourceKind: 'pstoCycle', sourcePositions: [null] })] })).toEqual([{ code: 'INVALID_SOURCE_POSITIONS', category: 'derived', ids: [1] }])
})
