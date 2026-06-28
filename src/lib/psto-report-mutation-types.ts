import type { HeatTreatmentFieldEditingState } from '@/lib/home-state'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

export type RowWithId = WeldRow

export type UsePstoReportMutationsOptions = {
  rows: RowWithId[]
  heatTreatmentRows: RowWithId[]
  pstoRequestOptions: string[]
  setMessage: (value: string) => void
  highlightChangedRows: (rows: WeldRow[], fieldKeys?: WeldFieldKey[]) => void
  setSelectedHeatTreatmentIds: (value: Set<number>) => void
  setPstoRequestNaming: (value: RequestNamingState) => void
  setPstoRequestSearch: (value: string) => void
  setIsPstoRequestModalOpen: (value: boolean) => void
  setIsPstoResultModalOpen: (value: boolean) => void
  setPstoResultDraft: (value: PstoResultDraftState) => void
  setManagedPstoRequestName: (value: string) => void
  setManagedPstoRequestNameDraft: (value: string) => void
  setIsPstoRequestManagerOpen: (value: boolean) => void
  setHeatTreatmentFieldEditing: (value: HeatTreatmentFieldEditingState | null) => void
}
