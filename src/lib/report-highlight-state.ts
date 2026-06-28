import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'

export function expandHighlightFieldKeys(fieldKeys: WeldFieldKey[]) {
  const expanded = new Set<WeldFieldKey>(fieldKeys)
  if (expanded.has('weldDate')) {
    expanded.add('hasVik')
  }
  if (
    expanded.has('pstoRequired') ||
    expanded.has('pstoRequest') ||
    expanded.has('pstoDate') ||
    expanded.has('pstoResult') ||
    expanded.has('heatTreatmentDiagram')
  ) {
    expanded.add('pstoCreatedAt')
  }
  if (
    LNK_METHODS.some(
      (method) =>
        expanded.has(method.enabledKey) ||
        expanded.has(method.requestKey) ||
        expanded.has(method.resultKey) ||
        expanded.has(method.conclusionDateKey) ||
        expanded.has(method.conclusionKey),
    )
  ) {
    expanded.add('lnkCreatedAt')
    expanded.add('finalStatus')
  }
  return [...expanded]
}

export function getCellKey(rowId: number, fieldKey: WeldFieldKey) {
  return `${rowId}:${fieldKey}`
}

export function buildHighlightSets(rows: Array<{ id?: number }> | undefined, cellFieldKeys: WeldFieldKey[] = []) {
  const rowIds = new Set(
    (rows ?? [])
      .map((row) => row.id)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
  )
  if (rowIds.size === 0) return null

  const cellKeys = new Set<string>()
  const expandedFieldKeys = expandHighlightFieldKeys(cellFieldKeys)
  for (const id of rowIds) {
    for (const fieldKey of expandedFieldKeys) {
      cellKeys.add(getCellKey(id, fieldKey))
    }
  }

  return { rowIds, cellKeys }
}
