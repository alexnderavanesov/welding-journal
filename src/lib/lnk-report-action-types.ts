import type { Dispatch, SetStateAction } from 'react'
import type { LnkOfficialityDraftState, LnkRequestDraftState, LnkResultDraftState } from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkRequestMutation = {
  isPending: boolean
  mutate: (value: {
    records: WeldRow[]
    methodKeys: WeldFieldKey[]
    requestName: string
  }) => void
}

export type UseLnkRequestActionsOptions = {
  draft: LnkRequestDraftState
  filteredRows: WeldRow[]
  lnkRows: WeldRow[]
  naming: RequestNamingState
  nextRequestName: string
  selectedMethodKeys: WeldFieldKey[]
  selectedRows: WeldRow[]
  selectedTargetCount: number
  mutation: LnkRequestMutation
  setDraft: Dispatch<SetStateAction<LnkRequestDraftState>>
  setIsOpen: (value: boolean) => void
  setMessage: (value: string | null) => void
  setNaming: Dispatch<SetStateAction<RequestNamingState>>
  setPreservedOrderIds: Dispatch<SetStateAction<number[] | null>>
  setSearch: (value: string) => void
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>
}

export type LnkResultMutation = {
  isPending: boolean
}

export type UseLnkResultActionsOptions = {
  filteredRows: WeldRow[]
  lnkRows: WeldRow[]
  draft: LnkResultDraftState
  mutation: LnkResultMutation
  setDraft: Dispatch<SetStateAction<LnkResultDraftState>>
  setIsModalOpen: (value: boolean) => void
  setIsPreviewOpen: (value: boolean) => void
  setMessage: (value: string | null) => void
  setPreservedOrderIds: Dispatch<SetStateAction<number[] | null>>
  setRequestSearch: (value: string) => void
  setShouldPinPreviewedRows: (value: boolean) => void
}

export type LnkOfficialityMutation = {
  isPending: boolean
  mutate: (value: {
    records: WeldRow[]
    status: 'official' | 'unofficial'
  }) => void
}

export type UseLnkOfficialityActionsOptions = {
  draft: LnkOfficialityDraftState
  filteredRows: WeldRow[]
  selectedRows: WeldRow[]
  isSaveDisabled: boolean
  mutation: LnkOfficialityMutation
  setDraft: Dispatch<SetStateAction<LnkOfficialityDraftState>>
  setIsOpen: (value: boolean) => void
}
