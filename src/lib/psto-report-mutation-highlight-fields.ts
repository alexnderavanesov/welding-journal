import type { WeldFieldKey } from '@/lib/weld-fields'

export const PSTO_REQUEST_HIGHLIGHT_FIELDS = ['pstoRequest', 'pstoCreatedAt'] as const satisfies readonly WeldFieldKey[]

export const PSTO_RESULT_HIGHLIGHT_FIELDS = [
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoCreatedAt',
] as const satisfies readonly WeldFieldKey[]

export const PSTO_GENERATED_HIGHLIGHT_FIELDS = [
  'pstoRequest',
  ...PSTO_RESULT_HIGHLIGHT_FIELDS,
] as const satisfies readonly WeldFieldKey[]

export function getPstoFieldHighlightFields(fieldKey: WeldFieldKey): WeldFieldKey[] {
  return [fieldKey]
}
