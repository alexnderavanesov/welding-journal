import { useMemo } from 'react'
import {
  getLnkInputMethodsForRows,
  canSelectLnkResultRow,
  filterLnkResultRows,
  isLnkResultRowApplicable,
} from '@/lib/report-modal-rows'
import { getLnkMethodByRequestKey, isFinalLnkResultValue } from '@/lib/lnk-status'
import {
  filterRequestNamesBySearch,
  getRequestNameFromNaming,
  sortLnkRequestNamesNewestFirst,
  withCurrentOption,
} from '@/lib/report-naming'
import {
  areLnkResultDraftRowsReady,
  findFirstLnkResultDateBeforeWeldDateIssue,
  hasNonEmptyLnkResultDraftRows,
} from '@/lib/lnk-result-draft'
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
  const lnkResultMethodRequestOptions = useMemo(() => {
    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
    if (!method) return lnkResultRequestOptions
    return sortLnkRequestNamesNewestFirst([
      ...new Set(
        lnkRows.flatMap((row) => {
          const requestName = String(row[method.requestKey] ?? '').trim()
          if (!requestName || isFinalLnkResultValue(row[method.resultKey])) return []
          return [requestName]
        }),
      ),
    ])
  }, [lnkResultDraft.methodKey, lnkResultRequestOptions, lnkRows])

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

  const lnkResultSearchRows = useMemo(() => {
    const baseRows = lnkResultDraft.requestName ? selectedLnkResultRequestRows : lnkRows
    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
    if (!method) return baseRows
    return baseRows.filter(
      (row) =>
        isLnkResultRowApplicable(row, lnkResultDraft.requestName, lnkResultDraft.methodKey) &&
        !isFinalLnkResultValue(row[method.resultKey]),
    )
  }, [lnkResultDraft.methodKey, lnkResultDraft.requestName, lnkRows, selectedLnkResultRequestRows])

  const lnkResultMethodRows =
    lnkResultDraft.rowIds.size > 0
      ? lnkResultSelectedRows
      : lnkResultDraft.requestName
        ? selectedLnkResultRequestRows
        : lnkRows

  const selectedLnkResultMethods = useMemo(
    () => getLnkInputMethodsForRows(lnkResultMethodRows, ''),
    [lnkResultMethodRows],
  )

  const filteredLnkResultRows = useMemo(
    () => filterLnkResultRows(lnkResultSearchRows, lnkResultDraft.search, lnkResultDraft.methodKey),
    [lnkResultDraft.methodKey, lnkResultDraft.search, lnkResultSearchRows],
  )

  const lnkResultContextReady = Boolean(lnkResultDraft.methodKey)

  const visibleLnkResultRows = useMemo(() => {
    if (!shouldPinPreviewedLnkResultRows || lnkResultDraft.rowIds.size === 0) return filteredLnkResultRows

    return [...filteredLnkResultRows].sort((left, right) => {
      const leftSelected = lnkResultDraft.rowIds.has(left.id)
      const rightSelected = lnkResultDraft.rowIds.has(right.id)
      if (leftSelected === rightSelected) return 0
      return leftSelected ? -1 : 1
    })
  }, [filteredLnkResultRows, lnkResultDraft.rowIds, shouldPinPreviewedLnkResultRows])

  const selectableVisibleLnkResultRows = useMemo(
    () => visibleLnkResultRows.filter((row) => canSelectLnkResultRow(row, lnkResultDraft.requestName, lnkResultDraft.methodKey)),
    [lnkResultDraft.methodKey, lnkResultDraft.requestName, visibleLnkResultRows],
  )

  const canBulkToggleLnkResultRows = Boolean(
    lnkResultDraft.methodKey &&
      selectableVisibleLnkResultRows.length > 0 &&
      (lnkResultDraft.requestName || lnkResultDraft.search.trim() || visibleLnkResultRows.length <= 20),
  )

  const selectedLnkResultRows = useMemo(
    () =>
      lnkRows.filter(
        (row) => lnkResultDraft.rowIds.has(row.id) && canSelectLnkResultRow(row, '', lnkResultDraft.methodKey),
      ),
    [lnkResultDraft.methodKey, lnkResultDraft.rowIds, lnkRows],
  )

  const lnkResultSaveBlockReason = useMemo(() => {
    if (isLnkResultSaving) return 'Результат сохраняется, дождитесь завершения.'
    if (!lnkResultDraft.methodKey) return 'Выберите метод контроля.'
    if (selectedLnkResultRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
    if (!areLnkResultDraftRowsReady(selectedLnkResultRows, lnkResultDraft)) return 'Укажите результат для каждого выбранного стыка.'
    if (hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft) && !lnkResultDraft.controlDate) {
      return 'Укажите дату контроля.'
    }
    const dateIssue = hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft)
      ? findFirstLnkResultDateBeforeWeldDateIssue(selectedLnkResultRows, lnkResultDraft)
      : null
    if (dateIssue) return dateIssue
    if (
      hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft) &&
      !getRequestNameFromNaming(lnkResultDraft.conclusionNaming, nextLnkConclusionName)
    ) {
      return 'Укажите наименование заключения.'
    }
    return ''
  }, [isLnkResultSaving, lnkResultDraft, nextLnkConclusionName, selectedLnkResultRows])

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
