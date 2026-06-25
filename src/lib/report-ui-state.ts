import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function makeExactColumnFilterValue(value: unknown) {
  return `=${String(value ?? '').trim().toLowerCase()}`
}

export function getJointTitle(value: WeldInput) {
  const line = String(value.line ?? '').trim()
  const joint = String(value.joint ?? '').trim()

  if (!line && !joint) return 'Линия и стык не заполнены.'
  return `${line || '-'} · ${joint || '-'}`
}

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
