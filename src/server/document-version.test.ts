import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { generatedDocuments } from '@/db/schema'
import { touchDocumentMembershipParents, touchEditableDocumentParentsForWeldDeletion, touchSystemDocumentParentsForWeldDeletion } from './document-version'
import { loadIndexedSystemDocumentSummaries, queryIndexedSystemDocumentHistory } from './system-document-index'
import { loadRemoteGeneratedDocument, loadRemoteGeneratedDocumentHistory, normalizeGeneratedDocumentHistoryRequest } from './generated-documents'
import { persistLayeredControlDocumentWrites } from './layered-control-documents'

const storage = vi.hoisted(() => ({ requireDb: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: storage.requireDb }))
const compile = (query: SQL) => new PgDialect().sqlToQuery(query)
beforeEach(() => {
  vi.clearAllMocks()
  storage.requireDb.mockImplementation(() => { throw new Error('Unexpected real DB access') })
})

describe('document version transport without membership reads', () => {
  it.each(['', 'beforeHeatTreatment', 'pstoCycle'])('keeps xmin in paged system history (%s) using one existing query', async sourceKind => {
    const execute = vi.fn(async (_query: SQL) => ({ rows: [{ documents: [{
      documentId: 11, title: 'C', date: '2026-10-12', rowCount: 200000, documentVersion: '101',
      metadata: JSON.stringify({ sourceKind, methodCode: 'ВИК' }),
    }], total: 1, filterOptions: {} }] }))
    const result = await queryIndexedSystemDocumentHistory({ execute } as never, { type: 'lnkConclusion', limit: 50, columnFilters: {} })
    expect(result.documents[0]).toMatchObject({ documentVersion: '101', rowIds: [], rowCount: 200000 })
    expect(execute).toHaveBeenCalledOnce()
    expect(compile(execute.mock.calls[0][0]).sql).toContain('"generated_documents".xmin::text')
    expect(compile(execute.mock.calls[0][0]).sql).not.toContain('generated_document_weld_joints')
  })

  it('retains the token in the alternate system-summary loader without another query', async () => {
    const document = { id: 11, title: 'C', type: 'system:lnkConclusionVik', periodFrom: '2026-10-12', fileName: 'C.xlsx', updatedAt: new Date(), documentVersion: '102' }
    const select = vi.fn((_fields?: unknown) => ({ from: (table: unknown) => ({ where: async () => table === generatedDocuments
      ? [document] : [{ documentId: 11, weldJointId: 21 }] }) }))
    const result = await loadIndexedSystemDocumentSummaries({ select } as never, 'lnkConclusion', [11])
    expect(result[0]).toMatchObject({ documentVersion: '102', rowIds: [21] })
    expect(select).toHaveBeenCalledTimes(2)
    expect(select.mock.calls[0][0]).toHaveProperty('documentVersion')
  })

  it.each(['history', 'single'] as const)('keeps xmin in layered %s, including its aggregate/normalizer', async entry => {
    const execute = vi.fn(async (_query: SQL) => ({ rows: [{ documents: [{ id: 12, type: 'layeredVikEdges', title: 'L', documentVersion: '103' }], total: 1, filterOptions: {} }] }))
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }))
    storage.requireDb.mockReturnValue({ execute, select })
    const result = entry === 'single' ? await loadRemoteGeneratedDocument(12)
      : (await loadRemoteGeneratedDocumentHistory(normalizeGeneratedDocumentHistoryRequest({ types: ['layeredVikEdges'], limit: 50 }))).documents[0]
    expect(result).toMatchObject({ id: 12, documentVersion: '103' })
    expect(execute).toHaveBeenCalledOnce()
    expect(select).toHaveBeenCalledOnce() // existing other-settings read only
    expect(compile(execute.mock.calls[0][0]).sql).toContain('min("generated_documents".xmin::text) as "documentVersion"')
  })
})

describe('link-only membership writes invalidate parent editor versions', () => {
  it.each([1, 10000])('locks/touches %i parent IDs with one scoped statement, not one call per row', async count => {
    const execute = vi.fn(async (_query: SQL) => ({ rows: [] }))
    const ids = Array.from({ length: count }, (_, index) => index + 1)
    await touchDocumentMembershipParents({ execute } as never, ids)
    expect(execute).toHaveBeenCalledOnce()
    const query = compile(execute.mock.calls[0][0])
    expect(query.params).toEqual([ids])
    expect(query.sql).toContain('order by "generated_documents"."id" for update')
    expect(query.sql).toContain('where d.id = locked.id')
    expect(query.sql).not.toMatch(/returning|source_metadata|specialists\s*=/i)
    expect(query.sql.length).toBeLessThan(1000)
  })

  it('captures manual and layered parents before weld FK cascades using one array-bound statement', async () => {
    const execute = vi.fn(async (_query: SQL) => ({ rows: [] }))
    await touchEditableDocumentParentsForWeldDeletion({ execute } as never, [21, 22])
    expect(execute).toHaveBeenCalledOnce()
    const query = compile(execute.mock.calls[0][0])
    expect(query.params).toEqual([['weldingJournal', 'checklist', 'zni', 'layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers'], [21, 22]])
    expect(query.sql).toContain('a.document_id = "generated_documents"."id"')
    expect(query.sql).toContain('a.weld_joint_id = any(')
    expect(query.sql).toContain('for update')
  })

  it('touches legacy shared parents before pruning duplicate links, not only deleted empty documents', async () => {
    const execute = vi.fn(async (_query: SQL) => ({ rows: [] }))
    const tx = { execute, delete: vi.fn(() => ({ where: async () => [] })),
      select: () => ({ from: () => ({ where: () => ({}) }) }) }
    await persistLayeredControlDocumentWrites(tx as never, [], [{ documentId: 11, weldJointId: 21 }, { documentId: 11, weldJointId: 22 }])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(compile(execute.mock.calls[0][0]).params).toEqual([[11]])
    expect(compile(execute.mock.calls[0][0]).sql).toContain('for update')
    expect(compile(execute.mock.calls[1][0]).sql).toContain('delete from "generated_document_weld_joints"')
    expect(tx.delete).toHaveBeenCalledOnce()
  })

  it('invalidates system conclusion parents by actual links even if legacy metadata omitted a position', async () => {
    const execute = vi.fn(async (_query: SQL) => ({ rows: [] }))
    await touchSystemDocumentParentsForWeldDeletion({ execute } as never, [21, 22])
    expect(execute).toHaveBeenCalledOnce()
    const query = compile(execute.mock.calls[0][0])
    expect(query.params).toEqual([['system:lnkConclusionVik', 'system:lnkConclusionRk', 'system:lnkConclusionPvk', 'system:lnkConclusionUzk', 'system:pstoConclusion', 'system:tvmtConclusion'], [21, 22]])
    expect(query.sql).toContain('a.document_id = "generated_documents"."id"')
    expect(query.sql).not.toContain('source_metadata')
  })

  it('does no work for empty selections', async () => {
    const execute = vi.fn()
    await touchDocumentMembershipParents({ execute } as never, [])
    await touchEditableDocumentParentsForWeldDeletion({ execute } as never, [])
    await touchSystemDocumentParentsForWeldDeletion({ execute } as never, [])
    expect(execute).not.toHaveBeenCalled()
  })
})
