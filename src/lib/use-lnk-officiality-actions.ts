import type { Dispatch, SetStateAction } from 'react'
import {
  createDefaultLnkOfficialityDraft,
  type LnkOfficialityDraftState,
} from '@/lib/report-draft-state'
import {
  setNumberSetValues,
  toggleNumberSetValue,
} from '@/lib/report-ui-state'
import type { WeldRow } from '@/lib/dispatcher-types'

type LnkOfficialityMutation = {
  isPending: boolean
  mutate: (value: {
    records: WeldRow[]
    status: 'official' | 'unofficial'
  }) => void
}

type UseLnkOfficialityActionsOptions = {
  draft: LnkOfficialityDraftState
  filteredRows: WeldRow[]
  selectedRows: WeldRow[]
  isSaveDisabled: boolean
  mutation: LnkOfficialityMutation
  setDraft: Dispatch<SetStateAction<LnkOfficialityDraftState>>
  setIsOpen: (value: boolean) => void
}

export function useLnkOfficialityActions({
  draft,
  filteredRows,
  selectedRows,
  isSaveDisabled,
  mutation,
  setDraft,
  setIsOpen,
}: UseLnkOfficialityActionsOptions) {
  function openLnkOfficialityModal() {
    setDraft(createDefaultLnkOfficialityDraft())
    setIsOpen(true)
  }

  function closeLnkOfficialityModal() {
    if (mutation.isPending) return
    setIsOpen(false)
  }

  function toggleLnkOfficialityRow(rowId: number) {
    setDraft((current) => {
      return { ...current, rowIds: toggleNumberSetValue(current.rowIds, rowId) }
    })
  }

  function setVisibleLnkOfficialityRowsSelected(selected: boolean) {
    setDraft((current) => {
      return { ...current, rowIds: setNumberSetValues(current.rowIds, filteredRows.map((row) => row.id), selected) }
    })
  }

  function saveLnkOfficiality() {
    if (isSaveDisabled) return
    mutation.mutate({
      records: selectedRows,
      status: draft.status as 'official' | 'unofficial',
    })
  }

  return {
    openLnkOfficialityModal,
    closeLnkOfficialityModal,
    toggleLnkOfficialityRow,
    setVisibleLnkOfficialityRowsSelected,
    saveLnkOfficiality,
  }
}
