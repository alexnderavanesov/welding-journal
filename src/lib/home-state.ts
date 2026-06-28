import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export type EditingState = {
  record: WeldInput & { id?: number }
  focusField?: WeldFieldKey
}

export type HeatTreatmentFieldEditingState = {
  record: WeldRow
  fieldKey: WeldFieldKey
  label: string
  kind: 'text' | 'date'
  value: string
  report?: 'heatTreatment' | 'lnk'
  mode?: 'text' | 'request' | 'result'
}

export type ActiveReport = 'weldingJournal' | 'heatTreatment' | 'lnk' | 'welderStamps'
