import { describe, expect, it } from 'vitest'

import { buildSourcedSystemDocumentMetadataSummary } from '@/lib/system-document-source-metadata'

describe('sourced system document metadata', () => {
  it('keeps exact primary and repeat PSTO cycles in one document summary', () => {
    expect(buildSourcedSystemDocumentMetadataSummary({
      sourcePositions: [
        { kind: 'pstoCycle', weldJointId: 1, relationId: 1, sequence: 1 },
        { kind: 'pstoCycle', weldJointId: 2, relationId: 22, sequence: 3 },
      ],
      rows: [{ id: 1 }, { id: 2 }],
    })).toMatchObject({
      rowIds: [1, 2],
      positionCount: 2,
      cycleSequences: [1, 3],
    })
  })

  it('rebuilds filters from current weld identities and drops missing positions', () => {
    expect(buildSourcedSystemDocumentMetadataSummary({
      sourcePositions: [
        { kind: 'beforeHeatTreatment', weldJointId: 1, relationId: 11, methodCode: 'ВИК' },
        { kind: 'beforeHeatTreatment', weldJointId: 1, relationId: 12, methodCode: 'РК' },
        { kind: 'beforeHeatTreatment', weldJointId: 2, relationId: 21, methodCode: 'ВИК' },
        { kind: 'beforeHeatTreatment', weldJointId: 3, relationId: 31, methodCode: 'УЗК' },
      ],
      rows: [
        {
          id: 1,
          projectTitle: 'Проект Б',
          subtitleCode: '500',
          line: 'Линия 2',
          weldDate: '2026-08-03',
        },
        {
          id: 2,
          projectTitle: 'Проект А',
          subtitleCode: '400',
          line: 'Линия 1',
          weldDate: '2026-08-01',
        },
      ],
    })).toEqual({
      sourcePositions: [
        { kind: 'beforeHeatTreatment', weldJointId: 1, relationId: 11, methodCode: 'ВИК' },
        { kind: 'beforeHeatTreatment', weldJointId: 1, relationId: 12, methodCode: 'РК' },
        { kind: 'beforeHeatTreatment', weldJointId: 2, relationId: 21, methodCode: 'ВИК' },
      ],
      rowIds: [1, 2],
      positionCount: 3,
      methodCodes: ['ВИК', 'РК'],
      projects: ['Проект А', 'Проект Б'],
      subtitleCodes: ['400', '500'],
      lines: ['Линия 1', 'Линия 2'],
      periodFrom: '2026-08-01',
      periodTo: '2026-08-03',
    })
  })
})
