import type { Dispatch, SetStateAction } from 'react'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { WeldInput } from '@/lib/weld-fields'

export type RowWithId = WeldInput & { id: number }

export type MutationLike<TVariables> = {
  isPending: boolean
  mutate: (variables: TVariables) => void
}

export type PstoRequestVariables = {
  records: RowWithId[]
  requestName: string
  mode?: 'create' | 'edit'
}

export type PstoRequestManagerVariables = {
  requestName: string
  nextRequestName?: string
  action: 'rename' | 'delete'
}

export type PstoRequestCorrectionVariables = {
  record: RowWithId
}

export type PstoResultVariables = {
  records: RowWithId[]
  pstoDate: string
  result: string
  diagramName: string
  rows: RowWithId[]
}

export type PstoResultCorrectionVariables = {
  record: RowWithId
  action: 'renameDiagram' | 'deleteResult'
  diagramName?: string
}

export type UsePstoReportActionsOptions = {
  rows: RowWithId[]
  heatTreatmentRows: RowWithId[]
  filteredAvailablePstoRequestRows: RowWithId[]
  filteredPstoResultRows: RowWithId[]
  managedPstoDiagramDrafts: Record<number, string>
  managedPstoRequestName: string
  managedPstoRequestNameDraft: string
  nextPstoDiagramName: string
  nextPstoRequestName: string
  pstoRequestManagerOptions: string[]
  pstoRequestNaming: RequestNamingState
  pstoResultDraft: PstoResultDraftState
  pstoResultSaveBlockReason: string | null
  selectedHeatTreatmentRows: RowWithId[]
  selectedPstoResultRows: RowWithId[]
  pstoRequestCorrectionMutation: MutationLike<PstoRequestCorrectionVariables>
  pstoRequestManagerMutation: MutationLike<PstoRequestManagerVariables>
  pstoRequestMutation: MutationLike<PstoRequestVariables>
  pstoResultCorrectionMutation: MutationLike<PstoResultCorrectionVariables>
  pstoResultMutation: MutationLike<PstoResultVariables>
  setIsPstoRequestManagerOpen: (value: boolean) => void
  setIsPstoRequestModalOpen: (value: boolean) => void
  setIsPstoResultManagerOpen: (value: boolean) => void
  setIsPstoResultModalOpen: (value: boolean) => void
  setManagedPstoDiagramDrafts: Dispatch<SetStateAction<Record<number, string>>>
  setManagedPstoRequestName: (value: string) => void
  setManagedPstoRequestNameDraft: (value: string) => void
  setMessage: (value: string) => void
  setPstoRequestNaming: (value: RequestNamingState) => void
  setPstoRequestSearch: (value: string) => void
  setPstoResultDraft: Dispatch<SetStateAction<PstoResultDraftState>>
  setPstoResultRequestSearch: (value: string) => void
  setSelectedHeatTreatmentIds: Dispatch<SetStateAction<Set<number>>>
}
