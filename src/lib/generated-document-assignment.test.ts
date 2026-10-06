import { describe, expect, it } from 'vitest'

import { buildGeneratedDocumentBatchAssignmentPlans } from '@/lib/generated-document-assignment'

function buildGeneratedDocumentAssignmentPlan({ selectedWeldJointIds, ...rest }: {
  selectedWeldJointIds: number[]
  existingAssignments: Array<{ documentId: number; weldJointId: number }>
  documentAssignmentCounts: Map<number, number>
}) {
  return buildGeneratedDocumentBatchAssignmentPlans({ ...rest, selectedWeldJointIdGroups: [selectedWeldJointIds] })[0]
}

describe('buildGeneratedDocumentAssignmentPlan', () => {
  it('reuses only the remaining complete document after earlier groups take some of its welds', () => {
    expect(buildGeneratedDocumentBatchAssignmentPlans({
      selectedWeldJointIdGroups: [[1, 4], [2, 3], [5]],
      existingAssignments: [
        { documentId: 8, weldJointId: 4 }, { documentId: 8, weldJointId: 5 },
        { documentId: 7, weldJointId: 1 }, { documentId: 7, weldJointId: 2 }, { documentId: 7, weldJointId: 3 },
      ],
      documentAssignmentCounts: new Map([[7, 3], [8, 2]]),
    })).toEqual([
      { targetDocumentId: null, affectedDocumentIds: [8, 7] },
      { targetDocumentId: 7, affectedDocumentIds: [7] },
      { targetDocumentId: 8, affectedDocumentIds: [8] },
    ])
  })

  it('does not overwrite a complete document when the selection adds an unassigned weld', () => {
    expect(buildGeneratedDocumentAssignmentPlan({ selectedWeldJointIds: [1, 2, 3],
      existingAssignments: [{ documentId: 7, weldJointId: 1 }, { documentId: 7, weldJointId: 2 }],
      documentAssignmentCounts: new Map([[7, 2]]),
    })).toEqual({ targetDocumentId: null, affectedDocumentIds: [7] })
  })
  it('updates the existing document when the selected set matches it exactly', () => {
    expect(
      buildGeneratedDocumentAssignmentPlan({
        selectedWeldJointIds: [10, 11],
        existingAssignments: [
          { documentId: 7, weldJointId: 10 },
          { documentId: 7, weldJointId: 11 },
        ],
        documentAssignmentCounts: new Map([[7, 2]]),
      }),
    ).toEqual({ targetDocumentId: 7, affectedDocumentIds: [7] })
  })

  it('creates a new document when only part of an existing document is selected', () => {
    expect(
      buildGeneratedDocumentAssignmentPlan({
        selectedWeldJointIds: [10],
        existingAssignments: [{ documentId: 7, weldJointId: 10 }],
        documentAssignmentCounts: new Map([[7, 2]]),
      }),
    ).toEqual({ targetDocumentId: null, affectedDocumentIds: [7] })
  })

  it('creates a new document when selected joints come from different documents', () => {
    expect(
      buildGeneratedDocumentAssignmentPlan({
        selectedWeldJointIds: [10, 20],
        existingAssignments: [
          { documentId: 7, weldJointId: 10 },
          { documentId: 8, weldJointId: 20 },
        ],
        documentAssignmentCounts: new Map([
          [7, 1],
          [8, 1],
        ]),
      }),
    ).toEqual({ targetDocumentId: null, affectedDocumentIds: [7, 8] })
  })

  it('creates a new document for previously unassigned joints', () => {
    expect(
      buildGeneratedDocumentAssignmentPlan({
        selectedWeldJointIds: [10, 11],
        existingAssignments: [],
        documentAssignmentCounts: new Map(),
      }),
    ).toEqual({ targetDocumentId: null, affectedDocumentIds: [] })
  })
})
