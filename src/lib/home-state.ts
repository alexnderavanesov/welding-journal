import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import type { PageScrollPosition } from '@/lib/page-scroll-position'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export type EditingState = {
  record: WeldDraft
  focusField?: WeldFieldKey
  returnPageScrollPosition?: PageScrollPosition
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

export type ActiveReport =
  | 'weldingJournal'
  | 'heatTreatment'
  | 'lnk'
  | 'welderStamps'
  | 'percentageLines'
  | 'statistics'
  | 'documents'
  | 'settings'
  | 'userGuide'
