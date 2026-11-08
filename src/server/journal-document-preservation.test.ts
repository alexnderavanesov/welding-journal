import { describe, expect, it, vi } from 'vitest'
import { generatedDocuments, generatedDocumentWeldJoints, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { JOURNAL_INLINE_FIELDS } from '@/lib/journal-inline-edit'
import { buildSystemDocumentSummaries, SYSTEM_DOCUMENT_TYPES } from '@/lib/system-document-types'
import { buildSourcedSystemDocumentMetadataSummary } from '@/lib/system-document-source-metadata'
import { syncSystemDocumentsForWeldChangesInTransaction } from './system-document-index'
import { syncLayeredControlDocumentsForWeldChangesInTransaction } from './layered-control-documents'
import { syncProgramChainStates } from './line-program-chain-state'

vi.mock('./layered-control-documents', () => ({
  lockLayeredControlDocumentsForWeldChange: vi.fn(), syncLayeredControlDocumentsForWeldChangesInTransaction: vi.fn(),
}))
vi.mock('./line-program-chain-state', () => ({ syncProgramChainStates: vi.fn() }))

describe('journal annotations preserve control-document history', () => {
  it.each(['missing', 'stale'] as const)('does not delete a linked document with %s historical source positions', async kind => {
    vi.clearAllMocks()
    const before: WeldRow & { updatedAt: Date } = { id: 1, joint: 'F1', weldingJournalNote: 'Before', updatedAt: new Date('2026-11-01') }
    const after = { ...before, weldingJournalNote: 'After', updatedAt: new Date('2026-11-08') }
    const sourceMetadata = JSON.stringify({ sourceKind: 'pstoCycle', positionCount: 2,
      ...(kind === 'stale' ? { sourcePositions: [{ kind: 'pstoCycle', weldJointId: 999, relationId: 999, sequence: 1 }] } : {}) })
    const deleteDocument = vi.fn(async () => {})
    const tx = {
      select: vi.fn(() => ({ from: (table: unknown) => ({ where: async () => {
        if (table === generatedDocumentWeldJoints) return [{ documentId: 40 }]
        if (table === generatedDocuments) return [{ id: 40, type: 'system:pstoConclusion', sourceMetadata }]
        if (table === weldJoints) return [] // Old position ID no longer exists.
        throw new Error('Unexpected document source')
      } }) })),
      delete: vi.fn(() => ({ where: deleteDocument })),
    } as unknown as Parameters<typeof syncSystemDocumentsForWeldChangesInTransaction>[0]
    await syncSystemDocumentsForWeldChangesInTransaction(tx, [after], new Map([[before.id, before]]), { journalFieldsOnly: true })
    expect(deleteDocument).not.toHaveBeenCalled()
    expect(tx.select).not.toHaveBeenCalled()
    expect(syncProgramChainStates).not.toHaveBeenCalled()
    expect(syncLayeredControlDocumentsForWeldChangesInTransaction).toHaveBeenCalledWith(tx, [after], new Map([[before.id, before]]), { refreshTitlesOnly: true })
  })

  it.each([...JOURNAL_INLINE_FIELDS])('%s does not change regular document identities, grouping or sourced metadata', field => {
    const before: WeldRow = { id: 1, projectTitle: 'Project', subtitleCode: 'P', line: 'L', joint: 'F1', weldDate: '2026-10-01',
      vikRequest: 'VIK request', vikRequestDate: '2026-10-02', vikConclusion: 'VIK conclusion', vikConclusionDate: '2026-10-03',
      rkRequest: 'RK request', rkRequestDate: '2026-10-02', rkConclusion: 'RK conclusion', rkConclusionDate: '2026-10-03',
      uzkRequest: 'UZK request', uzkRequestDate: '2026-10-02', uzkConclusion: 'UZK conclusion', uzkConclusionDate: '2026-10-03',
      pvkRequest: 'PVK request', pvkRequestDate: '2026-10-02', pvkConclusion: 'PVK conclusion', pvkConclusionDate: '2026-10-03',
      pstoRequest: 'PSTO request', pstoRequestDate: '2026-10-04', heatTreatmentDiagram: 'PSTO conclusion', pstoDate: '2026-10-05',
      tvmtRequest: 'TVMT request', tvmtRequestDate: '2026-10-05', tvmtConclusion: 'TVMT conclusion', tvmtConclusionDate: '2026-10-06' }
    const after = { ...before, [field]: field === 'sheet' || field === 'revisionNumber' ? 7 : 'Changed' }
    for (const type of SYSTEM_DOCUMENT_TYPES) expect(buildSystemDocumentSummaries([after], type)).toEqual(buildSystemDocumentSummaries([before], type))
    const sourcePositions = [{ kind: 'pstoCycle' as const, weldJointId: 1, relationId: 20, sequence: 2 },
      { kind: 'beforeHeatTreatment' as const, weldJointId: 1, relationId: 30, methodCode: 'РК' }]
    expect(buildSourcedSystemDocumentMetadataSummary({ sourcePositions, rows: [after] }))
      .toEqual(buildSourcedSystemDocumentMetadataSummary({ sourcePositions, rows: [before] }))
  })
})
