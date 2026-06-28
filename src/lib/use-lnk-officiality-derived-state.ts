import { useMemo } from 'react'
import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getFilteredLnkOfficialityRows,
  getLnkOfficialitySaveBlockReason,
  getSelectedLnkOfficialityRows,
} from '@/lib/lnk-officiality-derived-utils'

type LnkOfficialityDerivedStateParams = {
  lnkRows: WeldRow[]
  lnkOfficialityDraft: LnkOfficialityDraftState
  isLnkOfficialitySaving: boolean
}

export function useLnkOfficialityDerivedState({
  lnkRows,
  lnkOfficialityDraft,
  isLnkOfficialitySaving,
}: LnkOfficialityDerivedStateParams) {
  const filteredLnkOfficialityRows = useMemo(
    () => getFilteredLnkOfficialityRows(lnkRows, lnkOfficialityDraft),
    [lnkOfficialityDraft.rowIds, lnkOfficialityDraft.search, lnkRows],
  )

  const selectedLnkOfficialityRows = useMemo(
    () => getSelectedLnkOfficialityRows(lnkRows, lnkOfficialityDraft),
    [lnkOfficialityDraft.rowIds, lnkRows],
  )

  const lnkOfficialitySaveBlockReason = useMemo(
    () =>
      getLnkOfficialitySaveBlockReason({
        isLnkOfficialitySaving,
        lnkOfficialityDraft,
        selectedLnkOfficialityRows,
      }),
    [isLnkOfficialitySaving, lnkOfficialityDraft, selectedLnkOfficialityRows],
  )

  const isLnkOfficialitySaveDisabled = Boolean(lnkOfficialitySaveBlockReason)

  return {
    filteredLnkOfficialityRows,
    selectedLnkOfficialityRows,
    lnkOfficialitySaveBlockReason,
    isLnkOfficialitySaveDisabled,
  }
}
