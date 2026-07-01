import type { Dispatch, SetStateAction } from 'react'
import type { ManagedLnkPendingResultRow } from '@/lib/managed-lnk-result-utils'
import type { ManagedLnkResultChangeHintState } from '@/lib/use-lnk-result-modal-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type RowWithId = WeldRow

export type MutationLike<TVariables> = {
  mutate: (variables: TVariables) => void
}

export type UseManagedLnkResultActionsOptions = {
  lnkRows: WeldRow[]
  selectedLnkResultRowIds: Set<number>
  managedLnkConclusionDrafts: Record<string, string>
  managedLnkPendingResultChanges: Record<string, string>
  managedLnkPendingResultRows: ManagedLnkPendingResultRow[]
  lnkResultCorrectionMutation: MutationLike<{ record: RowWithId; methodKey: WeldFieldKey; result: string | null }>
  lnkResultReplacementMutation: MutationLike<{
    updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string }>
  }>
  lnkConclusionCorrectionMutation: MutationLike<{
    records: RowWithId[]
    methodKey: WeldFieldKey
    conclusionName: string
  }>
  setMessage: (value: string | null) => void
  setIsLnkResultManagerOpen: (value: boolean) => void
  setManagedLnkResultRequestName: (value: string) => void
  setManagedLnkResultMethodKey: Dispatch<SetStateAction<WeldFieldKey | ''>>
  setManagedLnkResultRequestSearch: (value: string) => void
  setManagedLnkConclusionDrafts: Dispatch<SetStateAction<Record<string, string>>>
  setManagedLnkResultOrderIds: Dispatch<SetStateAction<number[] | null>>
  setManagedLnkResultChangeHint: Dispatch<SetStateAction<ManagedLnkResultChangeHintState>>
  setManagedLnkPendingResultChanges: Dispatch<SetStateAction<Record<string, string>>>
}
