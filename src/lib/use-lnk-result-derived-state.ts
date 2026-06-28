import { useMemo } from 'react'
import {
  canBulkToggleLnkResultRows as getCanBulkToggleLnkResultRows,
  getFilteredLnkResultRows,
  getLnkResultMethodRequestOptions,
  getLnkResultMethodRows,
  getLnkResultSaveBlockReason,
  getLnkResultSearchRows,
  getSelectableVisibleLnkResultRows,
  getSelectedLnkResultMethods,
  getSelectedLnkResultRows,
  getVisibleLnkResultRows,
} from '@/lib/lnk-result-derived-utils'
import { filterRequestNamesBySearch, withCurrentOption } from '@/lib/report-naming'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'

type LnkResultDerivedStateParams = {
  lnkRows: WeldRow[]
  lnkResultSelectedRows: WeldRow[]
  lnkResultRequestOptions: string[]
  lnkResultRequestSearch: string
  selectedLnkResultRequestRows: WeldRow[]
  lnkResultDraft: LnkResultDraftState
  nextLnkConclusionName: string
  shouldPinPreviewedLnkResultRows: boolean
  isLnkResultSaving: boolean
}

export function useLnkResultDerivedState({
  lnkRows,
  lnkResultSelectedRows,
  lnkResultRequestOptions,
  lnkResultRequestSearch,
  selectedLnkResultRequestRows,
  lnkResultDraft,
  nextLnkConclusionName,
  shouldPinPreviewedLnkResultRows,
  isLnkResultSaving,
}: LnkResultDerivedStateParams) {
  const lnkResultMethodRequestOptions = useMemo(
    () => getLnkResultMethodRequestOptions(lnkRows, lnkResultRequestOptions, lnkResultDraft.methodKey),
    [lnkResultDraft.methodKey, lnkResultRequestOptions, lnkRows],
  )

  const lnkResultAvailableRequestOptions = useMemo(() => {
    return lnkResultMethodRequestOptions
  }, [lnkResultMethodRequestOptions])

  const filteredLnkResultRequestOptions = useMemo(
    () =>
      withCurrentOption(
        filterRequestNamesBySearch(lnkResultAvailableRequestOptions, lnkResultRequestSearch),
        lnkResultDraft.requestName,
      ),
    [lnkResultAvailableRequestOptions, lnkResultDraft.requestName, lnkResultRequestSearch],
  )

  const lnkResultSearchRows = useMemo(
    () =>
      getLnkResultSearchRows({
        lnkRows,
        selectedRequestRows: selectedLnkResultRequestRows,
        draft: lnkResultDraft,
      }),
    [lnkResultDraft, lnkRows, selectedLnkResultRequestRows],
  )

  const lnkResultMethodRows = getLnkResultMethodRows({
    lnkRows,
    selectedRequestRows: selectedLnkResultRequestRows,
    selectedRows: lnkResultSelectedRows,
    draft: lnkResultDraft,
  })

  const selectedLnkResultMethods = useMemo(
    () => getSelectedLnkResultMethods(lnkResultMethodRows),
    [lnkResultMethodRows],
  )

  const filteredLnkResultRows = useMemo(
    () => getFilteredLnkResultRows(lnkResultSearchRows, lnkResultDraft),
    [lnkResultDraft, lnkResultSearchRows],
  )

  const lnkResultContextReady = Boolean(lnkResultDraft.methodKey)

  const visibleLnkResultRows = useMemo(
    () => getVisibleLnkResultRows(filteredLnkResultRows, lnkResultDraft.rowIds, shouldPinPreviewedLnkResultRows),
    [filteredLnkResultRows, lnkResultDraft.rowIds, shouldPinPreviewedLnkResultRows],
  )

  const selectableVisibleLnkResultRows = useMemo(
    () => getSelectableVisibleLnkResultRows(visibleLnkResultRows, lnkResultDraft),
    [lnkResultDraft, visibleLnkResultRows],
  )

  const canBulkToggleLnkResultRows = getCanBulkToggleLnkResultRows({
    draft: lnkResultDraft,
    selectableRows: selectableVisibleLnkResultRows,
    visibleRows: visibleLnkResultRows,
  })

  const selectedLnkResultRows = useMemo(
    () => getSelectedLnkResultRows(lnkRows, lnkResultDraft),
    [lnkResultDraft, lnkRows],
  )

  const lnkResultSaveBlockReason = useMemo(
    () =>
      getLnkResultSaveBlockReason({
        draft: lnkResultDraft,
        isSaving: isLnkResultSaving,
        nextConclusionName: nextLnkConclusionName,
        selectedRows: selectedLnkResultRows,
      }),
    [isLnkResultSaving, lnkResultDraft, nextLnkConclusionName, selectedLnkResultRows],
  )

  const isLnkResultSaveDisabled = Boolean(lnkResultSaveBlockReason)

  return {
    lnkResultAvailableRequestOptions,
    filteredLnkResultRequestOptions,
    selectedLnkResultMethods,
    filteredLnkResultRows,
    lnkResultContextReady,
    visibleLnkResultRows,
    selectableVisibleLnkResultRows,
    canBulkToggleLnkResultRows,
    selectedLnkResultRows,
    lnkResultSaveBlockReason,
    isLnkResultSaveDisabled,
  }
}
