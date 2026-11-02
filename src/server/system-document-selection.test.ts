import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { generatedDocuments, generatedDocumentWeldJoints } from '@/db/schema'
import { SYSTEM_DOCUMENT_TYPES, type SystemDocumentSourcePosition, type SystemDocumentSummary, type SystemDocumentType } from '@/lib/system-document-types'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '@/lib/system-document-template-types'
import { assertDocumentOperationLockCoverage, loadDocumentOperationSelection } from './document-operation-service'
import { loadIndexedSystemDocumentSelection, loadIndexedSystemDocumentSummaries, parseSystemDocumentMetadata } from './system-document-index'
import { buildNumberArrayMatch } from './weld-request-utils'

vi.mock('@/db', () => ({ requireDb: () => { throw new Error('Unexpected real DB access') } }))

const compile = (query: SQL) => new PgDialect().sqlToQuery(query)
const updatedAt = new Date('2026-10-20T12:34:56.789Z')
const specialists = { first: { id: 41, name: 'Сохранённое имя', certificate: 'Сохранённое удостоверение' }, second: null }
const supportedTypes = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map(profile => `system:${profile.id}`)
const before: SystemDocumentSourcePosition = { kind: 'beforeHeatTreatment', weldJointId: 11, relationId: 81, methodCode: 'ВИК' }
const primary: SystemDocumentSourcePosition = { kind: 'pstoCycle', weldJointId: 11, relationId: 11, sequence: 1 }
const repeat: SystemDocumentSourcePosition = { kind: 'pstoCycle', weldJointId: 12, relationId: 90, sequence: 2 }
const legacyRepeat: SystemDocumentSourcePosition = { kind: 'pstoRepeat', weldJointId: 12, relationId: 91, sequence: 3 }

function document(id: number, type: string, sourceMetadata: string | null = null) {
  return { id, type, title: `D${id}`, fileName: `D${id}.xlsx`, periodFrom: '2026-10-20', sourceMetadata,
    updatedAt, documentVersion: `100${id}`, specialists, specialistsRevision: 7 }
}
function fixture() {
  // Reversed source/assignment order and legacy metadata exercise preservation,
  // independently of the shared summary mapper's implementation.
  const documents = [
    document(7, 'system:lnkConclusionVik', '{invalid legacy json'),
    document(6, 'system:tvmtConclusion', JSON.stringify({ methodCode: 'ТВМТ', positionCount: 2 })),
    document(5, 'system:tvmtRequest', JSON.stringify({ methodCode: 'ТВМТ', positionCount: 1 })),
    document(4, 'system:pstoConclusion', JSON.stringify({ sourceKind: 'pstoRepeat', sourcePositions: [legacyRepeat], positionCount: 1 })),
    document(3, 'system:pstoRequest', JSON.stringify({ sourceKind: 'pstoCycle', sourcePositions: [repeat, primary], positionCount: 2 })),
    document(2, 'system:lnkConclusionOther'),
    document(1, 'system:lnkRequest', JSON.stringify({ label: 'До ТО', methodCode: 'ВИК', methodCodes: ['РК', 'ВИК'],
      sourceKind: 'beforeHeatTreatment', sourcePositions: [before], cycleSequences: [3, 1], positionCount: 2,
      projects: ['Проект'], subtitleCodes: ['Шифр'], lines: ['Линия'], periodFrom: '2026-10-01', periodTo: '2026-10-20' })),
    document(8, 'checklist'), document(99, 'system:pstoRequest'),
  ]
  const assignments = [[1, 12], [1, 11], [2, 11], [3, 12], [3, 11], [4, 12], [5, 13], [7, 14], [8, 8], [99, 99]]
    .map(([documentId, weldJointId]) => ({ documentId, weldJointId }))
  return { documents, assignments }
}

function connection(data = fixture()) {
  const reads: Array<{ table: unknown; ids: number[]; types: string[] }> = []
  const select = vi.fn((_fields?: unknown) => ({ from: (table: unknown) => ({ where: async (query: SQL) => {
    const { params } = compile(query)
    const ids = params.find(Array.isArray) as number[] | undefined
    const types = params.filter((value): value is string => typeof value === 'string' && value.startsWith('system:'))
    reads.push({ table, ids: ids ?? [], types })
    if (table === generatedDocuments) return data.documents
      .filter(doc => (!ids || ids.includes(doc.id)) && (!types.length || types.includes(doc.type)))
      .map(doc => ({ ...doc, value: doc.sourceMetadata }))
    if (table === generatedDocumentWeldJoints) return data.assignments.filter(item => ids?.includes(item.documentId))
    throw new Error('Unexpected table')
  } }) }))
  const execute = vi.fn(async (query: SQL) => {
    const { params } = compile(query), ids = params[0] as number[]
    expect(params[1]).toEqual(supportedTypes)
    return { rows: data.documents.filter(doc => ids.includes(doc.id) && supportedTypes.includes(doc.type)).map(doc => ({
      documentId: doc.id, title: doc.title, positionCount: 2, metadataBytes: doc.sourceMetadata?.length ?? 0,
    })) }
  })
  return { tx: { select, execute } as never, select, execute, reads, data }
}

function expectedSummary(id: number, type: SystemDocumentType, rowIds: number[], extra: Partial<SystemDocumentSummary> = {}): SystemDocumentSummary {
  return { documentId: id, id: `system-document:${id}`, type, title: `D${id}`, date: '2026-10-20', label: `D${id}`,
    fileName: `D${id}.xlsx`, documentVersion: `100${id}`, specialists, specialistsRevision: 7, updatedAt: updatedAt.toISOString(),
    rowIds, rowCount: rowIds.length, positionCount: rowIds.length, methodCodes: [], projects: [], subtitleCodes: [], lines: [],
    periodFrom: '', periodTo: '', ...extra }
}

describe('one fresh read of a mixed document-operation selection', () => {
  it('preserves full summaries, legacy defaults, exact positions, versions and lock ordering in three queries', async () => {
    const { tx, select, execute, reads } = connection()
    const result = await loadDocumentOperationSelection(tx, [7, 3, 1, 6, 2, 5, 4])
    expect(result.documents).toEqual([
      expectedSummary(1, 'lnkRequest', [11, 12], { label: 'До ТО', methodCode: 'ВИК', methodCodes: ['РК', 'ВИК'],
        sourceKind: 'beforeHeatTreatment', cycleSequences: [1, 3], projects: ['Проект'], subtitleCodes: ['Шифр'], lines: ['Линия'],
        periodFrom: '2026-10-01', periodTo: '2026-10-20' }),
      expectedSummary(2, 'lnkConclusion', [11]),
      expectedSummary(3, 'pstoRequest', [11, 12], { label: '', sourceKind: 'pstoCycle', cycleSequences: [1, 2] }),
      expectedSummary(4, 'pstoConclusion', [12], { label: '', sourceKind: 'pstoRepeat', cycleSequences: [3] }),
      expectedSummary(5, 'lnkRequest', [13], { label: '', methodCode: 'ТВМТ' }),
      expectedSummary(6, 'lnkConclusion', [], { label: '', methodCode: 'ТВМТ', positionCount: 2 }),
      expectedSummary(7, 'lnkConclusion', [14]),
    ])
    expect(result.positions).toEqual(new Map([[1, [before]], [2, []], [3, [primary, repeat]], [4, [legacyRepeat]], [5, []], [6, []], [7, []]]))
    expect(result.rowIds).toEqual([11, 12, 13, 14]); expect(result.cycleIds).toEqual([90, 91]); expect(result.controlIds).toEqual([81])
    expect(execute).toHaveBeenCalledOnce(); expect(select).toHaveBeenCalledTimes(2)
    expect(select.mock.calls[0][0]).toHaveProperty('documentVersion')
    expect(reads.map(read => read.table)).toEqual([generatedDocuments, generatedDocumentWeldJoints])
    expect(reads[0].types).toEqual(supportedTypes)
    expect(reads[1].ids).toEqual([7, 6, 5, 4, 3, 2, 1])
  })

  it.each([{ ids: [5, 1], previousSelects: 6 }, { ids: [7, 6, 5, 4, 3, 2, 1], previousSelects: 9 }])(
    'matches the former per-type composition for $ids while replacing $previousSelects SELECTs with two', async ({ ids, previousSelects }) => {
      // Baseline: four type queries + one link query per populated type +
      // another metadata query. The operation catalog is unchanged and separate.
      const baseline = connection(), oldDocuments: SystemDocumentSummary[] = []
      for (const type of SYSTEM_DOCUMENT_TYPES) oldDocuments.push(...await loadIndexedSystemDocumentSummaries(baseline.tx, type, ids))
      const oldMetadata = await baseline.select().from(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, ids)) as Array<{ id: number; value: string | null }>
      const previous = { documents: oldDocuments.sort((a, b) => a.documentId - b.documentId),
        positions: new Map(oldMetadata.map(doc => [doc.id, parseSystemDocumentMetadata(doc.value)?.sourcePositions ?? []])) }
      expect(baseline.select).toHaveBeenCalledTimes(previousSelects)
      const current = connection(), result = await loadIndexedSystemDocumentSelection(current.tx, ids)
      result.documents.sort((a, b) => a.documentId - b.documentId)
      expect(result).toEqual(previous)
      expect(current.select).toHaveBeenCalledTimes(2)
    },
  )

  it.each([404, 8])('rejects an absent or unsupported selected ID %i before loading a partial operation', async id => {
    const { tx, select, execute } = connection()
    await expect(loadDocumentOperationSelection(tx, [1, id])).rejects.toThrow('Часть выбранных документов не найдена')
    expect(execute).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled()
  })

  it('does no assignment read for empty or missing selections and does not include unselected documents', async () => {
    const { tx, select, reads } = connection()
    expect(await loadIndexedSystemDocumentSelection(tx, [])).toEqual({ documents: [], positions: new Map() })
    expect(select).not.toHaveBeenCalled()
    expect(await loadIndexedSystemDocumentSelection(tx, [404])).toEqual({ documents: [], positions: new Map() })
    expect(select).toHaveBeenCalledOnce(); expect(reads[0].table).toBe(generatedDocuments)
  })

  it.each([
    { type: 'lnkRequest' as const, ids: [5, 1] },
    { type: 'lnkConclusion' as const, ids: [7, 6, 2] },
    { type: 'pstoRequest' as const, ids: [99, 3] },
    { type: 'pstoConclusion' as const, ids: [4] },
  ])('keeps the optional selection and storage-profile boundaries of the existing $type API', async ({ type, ids }) => {
    const { tx, reads, select } = connection()
    const result = await loadIndexedSystemDocumentSummaries(tx, type)
    expect(result.map(doc => doc.documentId)).toEqual(ids)
    expect(result.every(doc => doc.type === type)).toBe(true)
    expect(reads[0].types).toEqual(SYSTEM_DOCUMENT_TEMPLATE_PROFILES.filter(profile => profile.documentType === type).map(profile => `system:${profile.id}`))
    expect(select).toHaveBeenCalledTimes(2)
    const selected = await loadIndexedSystemDocumentSummaries(tx, type, [ids.at(-1)!])
    expect(selected).toEqual([result.at(-1)])
    expect(select).toHaveBeenCalledTimes(4)
    expect(await loadIndexedSystemDocumentSummaries(tx, type, [])).toEqual([])
    expect(select).toHaveBeenCalledTimes(4)
    expect(await loadIndexedSystemDocumentSummaries(tx, type, [8, 404])).toEqual([])
    expect(select).toHaveBeenCalledTimes(5)
  })

  it('keeps date-first descending natural title order in the existing summary API', async () => {
    const data = { documents: [
      { ...document(1, 'system:lnkRequest'), title: 'D2', periodFrom: '2026-10-21' },
      { ...document(3, 'system:lnkRequest'), title: 'D2' },
      { ...document(2, 'system:lnkRequest'), title: 'D10' },
    ], assignments: [] }
    const { tx } = connection(data)
    expect((await loadIndexedSystemDocumentSummaries(tx, 'lnkRequest')).map(doc => doc.documentId)).toEqual([1, 2, 3])
  })

  it('rereads changed membership and metadata on the next lock-discovery call without changing the first result', async () => {
    const { tx, select, execute, data } = connection()
    const initial = await loadDocumentOperationSelection(tx, [1])
    const stored = data.documents.find(doc => doc.id === 1)!
    const changed = { ...before, relationId: 82 }
    stored.sourceMetadata = JSON.stringify({ sourceKind: 'beforeHeatTreatment', sourcePositions: [changed] })
    stored.documentVersion = '2001'; stored.specialistsRevision = 8
    data.assignments = data.assignments.filter(item => item.documentId !== 1).concat({ documentId: 1, weldJointId: 15 })
    const current = await loadDocumentOperationSelection(tx, [1])
    expect(initial.documents[0]).toMatchObject({ documentVersion: '1001', specialistsRevision: 7, rowIds: [11, 12] })
    expect(initial.positions.get(1)).toEqual([before]); expect(initial.controlIds).toEqual([81])
    expect(current.documents[0]).toMatchObject({ documentVersion: '2001', specialistsRevision: 8, rowIds: [15] })
    expect(current.positions.get(1)).toEqual([changed]); expect(current.controlIds).toEqual([82])
    expect(() => assertDocumentOperationLockCoverage(initial, current)).toThrow('Проверить изменения')
    expect(select).toHaveBeenCalledTimes(4); expect(execute).toHaveBeenCalledTimes(2)
  })
})
