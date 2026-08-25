import type { Dispatch, SetStateAction } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ConfirmAction } from '@/lib/confirm-action-context'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import type { SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'

export type RowWithId = WeldRow

export type MutationLike<TVariables> = {
  isPending: boolean
  mutate: (variables: TVariables) => void
}

export type PstoRequestVariables = {
  records: RowWithId[]
  requestName: string
  requestDate: string
  mode?: 'create' | 'edit'
  useSystemName?: boolean
  documentGroups?: SystemDocumentCreationGroup[]
}

export type PstoRequestManagerVariables = {
  requestName: string
  requestDate: string
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
  useSystemName?: boolean
  documentGroups?: SystemDocumentCreationGroup[]
}

export type PstoResultCorrectionVariables = {
  record: RowWithId
  action: 'renameDiagram' | 'deleteResult'
  diagramName?: string
}

export type UsePstoReportActionsOptions = {
  confirmAction: ConfirmAction
  rows: RowWithId[]
  heatTreatmentRows: RowWithId[]
  filteredAvailablePstoRequestRows: RowWithId[]
  filteredPstoResultRows: RowWithId[]
  managedPstoRequestName: string
  managedPstoRequestDate: string
  managedPstoRequestNameDraft: string
  nextPstoDiagramName: string
  nextPstoRequestName: string
  nextPstoRequestNumber?: number
  nextPstoConclusionNumber?: number
  requestConclusionSettings: RequestConclusionSettings
  pstoRequestManagerOptions: RequestDocumentIdentity[]
  pstoRequestDate: string
  pstoRequestNaming: RequestNamingState
  pstoResultDraft: PstoResultDraftState
  pstoResultSaveBlockReason: string | null
  selectedHeatTreatmentRows: RowWithId[]
  selectedPstoResultRows: RowWithId[]
  saveCheckSettings: SaveCheckSettings
  pstoRequestCorrectionMutation: MutationLike<PstoRequestCorrectionVariables>
  pstoRequestManagerMutation: MutationLike<PstoRequestManagerVariables>
  pstoRequestMutation: MutationLike<PstoRequestVariables>
  pstoResultCorrectionMutation: MutationLike<PstoResultCorrectionVariables>
  pstoResultMutation: MutationLike<PstoResultVariables>
  defaultRequestNaming: RequestNamingState
  defaultConclusionNaming: RequestNamingState
  setIsPstoRequestManagerOpen: (value: boolean) => void
  setIsPstoRequestModalOpen: (value: boolean) => void
  setIsPstoResultManagerOpen: (value: boolean) => void
  setIsPstoResultModalOpen: (value: boolean) => void
  setManagedPstoDiagramDrafts: Dispatch<SetStateAction<Record<number, string>>>
  setManagedPstoRequestName: (value: string) => void
  setManagedPstoRequestDate: (value: string) => void
  setManagedPstoRequestNameDraft: (value: string) => void
  setMessage: (value: string) => void
  setPstoRequestDate: (value: string) => void
  setPstoRequestNaming: (value: RequestNamingState) => void
  setPstoRequestSearch: (value: string) => void
  setPstoResultDraft: Dispatch<SetStateAction<PstoResultDraftState>>
  setPstoResultRequestSearch: (value: string) => void
  setSelectedHeatTreatmentIds: Dispatch<SetStateAction<Set<number>>>
}
