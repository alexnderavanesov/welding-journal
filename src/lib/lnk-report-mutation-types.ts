import type { Dispatch, SetStateAction } from 'react'
import type { HeatTreatmentFieldEditingState } from '@/lib/home-state'
import type {
  LnkOfficialityDraftState,
  LnkRequestDraftState,
  LnkResultDraftState,
} from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

export type RowWithId = WeldRow

export type ManagedLnkResultChangeHintState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  from: string
  to: string
} | null

export type UseLnkReportMutationsOptions = {
  lnkRows: RowWithId[]
  lnkRequestOptions: string[]
  setMessage: (value: string) => void
  setLnkNotice: (value: string) => void
  highlightChangedRows: (rows: WeldRow[], fieldKeys?: WeldFieldKey[]) => void
  setSelectedLnkIds: (value: Set<number>) => void
  setLnkRequestDraft: Dispatch<SetStateAction<LnkRequestDraftState>>
  setLnkRequestNaming: (value: RequestNamingState) => void
  setIsLnkRequestModalOpen: (value: boolean) => void
  setManagedLnkRequestName: (value: string) => void
  setManagedLnkRequestNameDraft: (value: string) => void
  setIsLnkRequestManagerOpen: (value: boolean) => void
  setIsLnkResultModalOpen: (value: boolean) => void
  setLnkResultDraft: Dispatch<SetStateAction<LnkResultDraftState>>
  setLnkOfficialityDraft: Dispatch<SetStateAction<LnkOfficialityDraftState>>
  setIsLnkOfficialityModalOpen: (value: boolean) => void
  resetDismissedRepeatedJointTasks: () => void
  setManagedLnkPendingResultChanges: Dispatch<SetStateAction<Record<string, string>>>
  setManagedLnkResultChangeHint: (value: ManagedLnkResultChangeHintState) => void
  setHeatTreatmentFieldEditing: (value: HeatTreatmentFieldEditingState | null) => void
  defaultLnkRequestNaming: RequestNamingState
  defaultLnkConclusionNaming: RequestNamingState
}
