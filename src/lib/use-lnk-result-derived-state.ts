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
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import {
  filterRequestDocumentIdentitiesBySearch,
  type RequestDocumentIdentity,
  withCurrentRequestDocumentIdentity,
} from '@/lib/request-document-identity'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { getEffectiveLnkResultDraftValueForRow } from '@/lib/lnk-result-draft'
import { LNK_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'

type LnkResultDerivedStateParams = {
  lnkRows: WeldRow[]
  lnkResultSelectedRows: WeldRow[]
  lnkResultRequestOptions: RequestDocumentIdentity[]
  lnkResultRequestSearch: string
  selectedLnkResultRequestRows: WeldRow[]
  lnkResultDraft: LnkResultDraftState
  nextLnkConclusionName: string
  nextLnkConclusionNumber?: number
  requestConclusionSettings: RequestConclusionSettings
  saveCheckSettings: SaveCheckSettings
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
  nextLnkConclusionNumber,
  requestConclusionSettings,
  saveCheckSettings,
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
      withCurrentRequestDocumentIdentity(
        filterRequestDocumentIdentitiesBySearch(
          lnkResultAvailableRequestOptions,
          lnkResultRequestSearch,
        ),
        {
          name: lnkResultDraft.requestName,
          date: lnkResultDraft.requestDate,
        },
      ),
    [
      lnkResultAvailableRequestOptions,
      lnkResultDraft.requestDate,
      lnkResultDraft.requestName,
      lnkResultRequestSearch,
    ],
  )

  const lnkResultSearchRows = useMemo(
    () =>
      getLnkResultSearchRows({
        lnkRows,
        selectedRequestRows: selectedLnkResultRequestRows,
        requestName: lnkResultDraft.requestName,
        requestDate: lnkResultDraft.requestDate,
        methodKey: lnkResultDraft.methodKey,
      }),
    [
      lnkResultDraft.methodKey,
      lnkResultDraft.requestDate,
      lnkResultDraft.requestName,
      lnkRows,
      selectedLnkResultRequestRows,
    ],
  )

  const lnkResultMethodRows = useMemo(
    () =>
      getLnkResultMethodRows({
        lnkRows,
        selectedRequestRows: selectedLnkResultRequestRows,
        selectedRows: lnkResultSelectedRows,
        requestName: lnkResultDraft.requestName,
      }),
    [lnkResultDraft.requestName, lnkResultSelectedRows, lnkRows, selectedLnkResultRequestRows],
  )

  const selectedLnkResultMethods = useMemo(
    () => getSelectedLnkResultMethods(lnkResultMethodRows),
    [lnkResultMethodRows],
  )

  const filteredLnkResultRows = useMemo(
    () => getFilteredLnkResultRows(lnkResultSearchRows, lnkResultDraft.search, lnkResultDraft.methodKey),
    [lnkResultDraft.methodKey, lnkResultDraft.search, lnkResultSearchRows],
  )

  const lnkResultContextReady = Boolean(lnkResultDraft.methodKey)

  const visibleLnkResultRows = useMemo(
    () => getVisibleLnkResultRows(filteredLnkResultRows, lnkResultDraft.rowIds, shouldPinPreviewedLnkResultRows),
    [filteredLnkResultRows, lnkResultDraft.rowIds, shouldPinPreviewedLnkResultRows],
  )

  const selectableVisibleLnkResultRows = useMemo(
    () => getSelectableVisibleLnkResultRows(
      visibleLnkResultRows,
      lnkResultDraft.requestName,
      lnkResultDraft.methodKey,
      lnkResultDraft.requestDate,
    ),
    [
      lnkResultDraft.methodKey,
      lnkResultDraft.requestDate,
      lnkResultDraft.requestName,
      visibleLnkResultRows,
    ],
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

  const systemDocumentCreationPlan = useMemo(() => {
    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
    if (!method) return null
    const documentRows = selectedLnkResultRows.filter(
      (row) => getEffectiveLnkResultDraftValueForRow(row, lnkResultDraft, saveCheckSettings) !== LNK_EMPTY_RESULT_VALUE,
    )
    return buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: method.code,
      date: lnkResultDraft.controlDate,
      rows: documentRows,
      naming: lnkResultDraft.conclusionNaming,
      settings: requestConclusionSettings,
      nextNumber: nextLnkConclusionNumber,
      allowAllNamesEmpty: !saveCheckSettings.lnkResultConclusionRequired,
    })
  }, [lnkResultDraft, nextLnkConclusionNumber, requestConclusionSettings, saveCheckSettings, selectedLnkResultRows])

  const lnkResultSaveBlockReason = useMemo(
    () =>
      getLnkResultSaveBlockReason({
        draft: lnkResultDraft,
        isSaving: isLnkResultSaving,
        nextConclusionName: nextLnkConclusionName,
        saveCheckSettings,
        selectedRows: selectedLnkResultRows,
        systemDocumentCreationPlan,
      }),
    [isLnkResultSaving, lnkResultDraft, nextLnkConclusionName, saveCheckSettings, selectedLnkResultRows, systemDocumentCreationPlan],
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
    systemDocumentCreationPlan,
    lnkResultSaveBlockReason,
    isLnkResultSaveDisabled,
  }
}
