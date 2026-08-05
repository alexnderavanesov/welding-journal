import { describe, expect, it } from 'vitest'

import { buildGeneratedDocumentAssignmentPlan } from '@/lib/generated-document-assignment'

describe('buildGeneratedDocumentAssignmentPlan', () => {
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
