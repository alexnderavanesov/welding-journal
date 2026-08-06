import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'

export type RowWithId = WeldRow

export type MutationLike<TVariables> = {
  mutate: (variables: TVariables) => void
}

export type UseManagedLnkRequestActionsOptions = {
  lnkRequestManagerOptions: RequestDocumentIdentity[]
  managedLnkRequestName: string
  managedLnkRequestDate: string
  managedLnkRequestNameDraft: string
  lnkRequestCorrectionMutation: MutationLike<{ record: RowWithId; methodKey: WeldFieldKey; requestName: string | null }>
  lnkRequestManagerMutation: MutationLike<
    | { action: 'rename'; requestName: string; requestDate: string; nextRequestName: string }
    | { action: 'delete'; requestName: string; requestDate: string }
  >
  setIsLnkRequestManagerOpen: (value: boolean) => void
  setManagedLnkRequestName: (value: string) => void
  setManagedLnkRequestDate: (value: string) => void
  setManagedLnkRequestNameDraft: (value: string) => void
}
