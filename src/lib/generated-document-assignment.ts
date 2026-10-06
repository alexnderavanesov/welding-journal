export type GeneratedDocumentAssignment = {
  documentId: number
  weldJointId: number
}

export function buildGeneratedDocumentBatchAssignmentPlans({
  selectedWeldJointIdGroups,
  existingAssignments,
  documentAssignmentCounts,
}: {
  selectedWeldJointIdGroups: readonly (readonly number[])[]
  existingAssignments: readonly GeneratedDocumentAssignment[]
  documentAssignmentCounts: ReadonlyMap<number, number>
}) {
  // A batch can cover the whole journal. Index membership once, so every
  // document only examines its own selected welds, including earlier moves.
  const assignmentsByWeld = new Map<number, Array<{ documentId: number; order: number }>>()
  let nextOrder = 0
  for (const assignment of existingAssignments) {
    const entries = assignmentsByWeld.get(assignment.weldJointId) ?? []
    entries.push({ documentId: assignment.documentId, order: nextOrder++ })
    assignmentsByWeld.set(assignment.weldJointId, entries)
  }
  const simulatedCounts = new Map(documentAssignmentCounts)
  let nextVirtualDocumentId = -1

  return selectedWeldJointIdGroups.map((selectedWeldJointIds) => {
    const selectedIds = new Set(selectedWeldJointIds)
    const affected = new Map<number, { count: number; firstOrder: number }>()
    for (const id of selectedIds) {
      for (const assignment of assignmentsByWeld.get(id) ?? []) {
        const entry = affected.get(assignment.documentId) ?? { count: 0, firstOrder: assignment.order }
        entry.count += 1
        entry.firstOrder = Math.min(entry.firstOrder, assignment.order)
        affected.set(assignment.documentId, entry)
      }
      assignmentsByWeld.delete(id)
    }
    const affectedDocumentIds = [...affected.keys()].sort((left, right) =>
      affected.get(left)!.firstOrder - affected.get(right)!.firstOrder,
    )
    const candidateId = affectedDocumentIds.length === 1 ? affectedDocumentIds[0] : null
    const targetDocumentId = candidateId !== null
      && affected.get(candidateId)!.count === selectedIds.size
      && simulatedCounts.get(candidateId) === selectedIds.size
      ? candidateId : null
    for (const [documentId, entry] of affected) {
      simulatedCounts.set(
        documentId,
        Math.max(0, (simulatedCounts.get(documentId) ?? 0) - entry.count),
      )
    }

    const simulatedTargetId = targetDocumentId ?? nextVirtualDocumentId--
    for (const id of selectedWeldJointIds) {
      const entries = assignmentsByWeld.get(id) ?? []
      entries.push({ documentId: simulatedTargetId, order: nextOrder++ })
      assignmentsByWeld.set(id, entries)
    }
    simulatedCounts.set(
      simulatedTargetId,
      (simulatedCounts.get(simulatedTargetId) ?? 0) + selectedWeldJointIds.length,
    )
    return { targetDocumentId, affectedDocumentIds }
  })
}
