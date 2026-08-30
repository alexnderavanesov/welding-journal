import type { SystemDocumentSourcePosition } from '@/lib/system-document-types'

export type SourcedSystemDocumentMetadataRow = {
  id: number
  projectTitle?: unknown
  subtitleCode?: unknown
  line?: unknown
  weldDate?: unknown
}

export function buildSourcedSystemDocumentMetadataSummary({
  sourcePositions,
  rows,
}: {
  sourcePositions: readonly SystemDocumentSourcePosition[]
  rows: readonly SourcedSystemDocumentMetadataRow[]
}) {
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const retainedPositions = sourcePositions.filter((position) => rowsById.has(position.weldJointId))
  const retainedRows = [...new Set(retainedPositions.map((position) => position.weldJointId))]
    .map((rowId) => rowsById.get(rowId)!)
  const weldDates = uniqueTexts(retainedRows.map((row) => row.weldDate))
  const cycleSequences = uniqueNumbers(retainedPositions.map((position) => position.sequence))

  return {
    sourcePositions: retainedPositions,
    rowIds: retainedRows.map((row) => row.id).sort((left, right) => left - right),
    positionCount: retainedPositions.length,
    ...(cycleSequences.length > 0 ? { cycleSequences } : {}),
    methodCodes: uniqueTexts(retainedPositions.map((position) => position.methodCode)),
    projects: uniqueTexts(retainedRows.map((row) => row.projectTitle)),
    subtitleCodes: uniqueTexts(retainedRows.map((row) => row.subtitleCode)),
    lines: uniqueTexts(retainedRows.map((row) => row.line)),
    periodFrom: weldDates[0] ?? '',
    periodTo: weldDates.at(-1) ?? '',
  }
}

function uniqueNumbers(values: readonly unknown[]) {
  return [...new Set(values
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right)
}

function uniqueTexts(values: readonly unknown[]) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
}
