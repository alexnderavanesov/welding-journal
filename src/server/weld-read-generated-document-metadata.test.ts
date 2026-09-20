import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'

const mocks = vi.hoisted(() => ({
  attachHeatTreatmentControlRelations: vi.fn(),
  loadGeneratedDocumentAssignments: vi.fn(),
}))

vi.mock('@/db', () => ({
  requireDb: () => ({
    execute: async () => ({ rows: [] }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
        }),
      }),
    }),
  }),
}))

vi.mock('@/server/generated-document-row-fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/generated-document-row-fields')>()
  return {
    ...actual,
    loadGeneratedDocumentAssignments: mocks.loadGeneratedDocumentAssignments,
  }
})

vi.mock('@/server/heat-treatment-control-relations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/heat-treatment-control-relations')>()
  return {
    ...actual,
    attachHeatTreatmentControlRelations: mocks.attachHeatTreatmentControlRelations,
  }
})

import { attachReportPageMetadata } from '@/server/weld-read'

describe('report generated-document metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches pre-TO and repeated-cycle documents after loading their relations', async () => {
    const sourceRow = {
      id: 6451,
      joint: 'F2',
      pstoRequest: 'ПСТО основной',
      pstoRequestDate: '2026-09-18',
    } as WeldRow
    mocks.attachHeatTreatmentControlRelations.mockResolvedValue([{
      ...sourceRow,
      preRkRequest: '330-TKM5-6913-До ТО',
      preRkRequestDate: '2026-09-19',
      preHeatTreatmentControls: [{
        id: 91,
        weldJointId: 6451,
        method: 'РК',
        requestName: '330-TKM5-6913-До ТО',
        requestDate: '2026-09-19',
      }],
      pstoRepeatCycles: [{
        id: 92,
        weldJointId: 6451,
        sequence: 2,
        pstoRequest: 'ПСТО повтор 2',
        pstoRequestDate: '2026-09-20',
        tvmtConclusion: 'ТВМТ повтор 2',
        tvmtConclusionDate: '2026-09-21',
      }],
    }])
    mocks.loadGeneratedDocumentAssignments.mockResolvedValue([
      {
        weldJointId: 6451,
        documentId: 701,
        type: 'system:lnkRequest',
        title: '330-TKM5-6913-До ТО',
        periodFrom: '2026-09-19',
        sourceMetadata: JSON.stringify({ sourceKind: 'beforeHeatTreatment' }),
      },
      {
        weldJointId: 6451,
        documentId: 702,
        type: 'system:pstoRequest',
        title: 'ПСТО повтор 2',
        periodFrom: '2026-09-20',
        sourceMetadata: JSON.stringify({ sourceKind: 'pstoCycle', cycleSequences: [2] }),
      },
      {
        weldJointId: 6451,
        documentId: 703,
        type: 'system:tvmtConclusion',
        title: 'ТВМТ повтор 2',
        periodFrom: '2026-09-21',
        sourceMetadata: JSON.stringify({ sourceKind: 'pstoCycle', cycleSequences: [2] }),
      },
    ])

    const [result] = await attachReportPageMetadata([sourceRow], {
      includeJointWorkflowMetadata: false,
    })

    expect(mocks.attachHeatTreatmentControlRelations).toHaveBeenCalledTimes(1)
    expect(mocks.loadGeneratedDocumentAssignments).toHaveBeenCalledTimes(1)
    expect(result.systemDocumentIds).toMatchObject({
      preRkRequest: 701,
      pstoRequest: 702,
      tvmtConclusion: 703,
    })
  })
})
