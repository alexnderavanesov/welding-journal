export type GeneratedDocumentAssignment = {
  documentId: number
  weldJointId: number
}

export type GeneratedDocumentAssignmentPlan = {
  targetDocumentId: number | null
  affectedDocumentIds: number[]
}

export function buildGeneratedDocumentAssignmentPlan({
  selectedWeldJointIds,
  existingAssignments,
  documentAssignmentCounts,
}: {
  selectedWeldJointIds: readonly number[]
  existingAssignments: readonly GeneratedDocumentAssignment[]
  documentAssignmentCounts: ReadonlyMap<number, number>
}): GeneratedDocumentAssignmentPlan {
  const selectedIds = new Set(selectedWeldJointIds)
  const affectedDocumentIds = [
    ...new Set(
      existingAssignments
        .filter((assignment) => selectedIds.has(assignment.weldJointId))
        .map((assignment) => assignment.documentId),
    ),
  ]

  let targetDocumentId: number | null = null
  if (affectedDocumentIds.length === 1) {
    const candidateId = affectedDocumentIds[0]
    const selectedAssignments = existingAssignments.filter(
      (assignment) => assignment.documentId === candidateId && selectedIds.has(assignment.weldJointId),
    )
    if (
      selectedAssignments.length === selectedIds.size
      && documentAssignmentCounts.get(candidateId) === selectedIds.size
    ) {
      targetDocumentId = candidateId
    }
  }

  return { targetDocumentId, affectedDocumentIds }
}
