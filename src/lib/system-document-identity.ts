export type StoredSystemDocumentIdentity = {
  id: number
  type: string
  title: string
  periodFrom: string | null
}

export type SystemDocumentIdentityTarget = {
  type: string
  title: string
  date: string
  rowIds: number[]
}

export function matchSystemDocumentIdentityIds({
  documents,
  targets,
  assignedRowsByDocument,
}: {
  documents: StoredSystemDocumentIdentity[]
  targets: SystemDocumentIdentityTarget[]
  assignedRowsByDocument: ReadonlyMap<number, ReadonlySet<number>>
}) {
  const availableIds = new Set(documents.map((document) => document.id))
  const matchedIds = new Map<number, number>()

  // Reserve unchanged documents first. Otherwise, when one document is split,
  // its renamed part could take the permanent ID from the unchanged part.
  targets.forEach((target, index) => {
    const exactCandidates = documents.filter(
      (document) =>
        availableIds.has(document.id) &&
        document.type === target.type &&
        document.title === target.title &&
        (document.periodFrom ?? '') === target.date,
    )
    const match = chooseByRowOverlap(exactCandidates, assignedRowsByDocument, target.rowIds)
      ?? exactCandidates[0]
    if (!match) return
    matchedIds.set(index, match.id)
    availableIds.delete(match.id)
  })

  targets.forEach((target, index) => {
    if (matchedIds.has(index)) return
    const candidates = documents.filter(
      (document) => availableIds.has(document.id) && document.type === target.type,
    )
    const match = chooseByRowOverlap(candidates, assignedRowsByDocument, target.rowIds)
    if (!match) return
    matchedIds.set(index, match.id)
    availableIds.delete(match.id)
  })

  return matchedIds
}

function chooseByRowOverlap(
  candidates: StoredSystemDocumentIdentity[],
  assignedRowsByDocument: ReadonlyMap<number, ReadonlySet<number>>,
  rowIds: number[],
) {
  const targetRows = new Set(rowIds)
  let bestDocument: StoredSystemDocumentIdentity | undefined
  let bestOverlap = 0
  for (const candidate of candidates) {
    let overlap = 0
    for (const rowId of assignedRowsByDocument.get(candidate.id) ?? []) {
      if (targetRows.has(rowId)) overlap += 1
    }
    if (overlap <= bestOverlap) continue
    bestDocument = candidate
    bestOverlap = overlap
  }
  return bestDocument
}
