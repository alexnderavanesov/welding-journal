import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export type RowWithId = WeldInput & { id: number }

export type MutationLike<TVariables> = {
  mutate: (variables: TVariables) => void
}

export type UseManagedLnkRequestActionsOptions = {
  lnkRequestManagerOptions: string[]
  managedLnkRequestName: string
  managedLnkRequestNameDraft: string
  lnkRequestCorrectionMutation: MutationLike<{ record: RowWithId; methodKey: WeldFieldKey; requestName: string | null }>
  lnkRequestManagerMutation: MutationLike<
    | { action: 'rename'; requestName: string; nextRequestName: string }
    | { action: 'delete'; requestName: string }
  >
  setIsLnkRequestManagerOpen: (value: boolean) => void
  setManagedLnkRequestName: (value: string) => void
  setManagedLnkRequestNameDraft: (value: string) => void
}
