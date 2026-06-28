import { collectRequestNames, sortPstoRequestNamesNewestFirst } from '@/lib/report-naming'
import { hasText } from '@/lib/report-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'

type RowWithId = WeldRow

export function getPstoResultRequestName(currentRequestName: string, selectedRows: RowWithId[]) {
  const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
  if (currentRequestName && requestOptions.includes(currentRequestName)) return currentRequestName
  return requestOptions.length === 1 ? requestOptions[0] : ''
}

export function buildManagedPstoDiagramDrafts(rows: RowWithId[]) {
  return Object.fromEntries(
    rows
      .filter((row) => hasText(row.pstoResult) || hasText(row.heatTreatmentDiagram) || hasText(row.pstoDate))
      .map((row) => [row.id, String(row.heatTreatmentDiagram ?? '').trim()]),
  )
}
