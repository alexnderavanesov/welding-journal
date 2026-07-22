import type { WeldRow } from '@/lib/dispatcher-types'
import { getDateInputValidationReason } from '@/lib/date-format'
import { normalizeDateLikeForStorage } from '@/lib/date-format'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { findFirstLnkChronologySaveBlockReason } from '@/lib/lnk-chronology-checks'
import {
  areLnkResultDraftRowsReady,
  findFirstLnkResultDateBeforeWeldDateIssue,
  getEffectiveLnkResultDraftValueForRow,
  hasNonEmptyLnkResultDraftRows,
} from '@/lib/lnk-result-draft'
import { DEFAULT_SAVE_CHECK_SETTINGS, formatSaveCheckBlockReason, type SaveCheckSettings } from '@/lib/save-check-settings'
import { getLnkMethodByRequestKey, isFinalLnkResultValue } from '@/lib/lnk-status'
import {
  canSelectLnkResultRow,
  filterLnkResultRows,
  getLnkInputMethodsForRows,
  isLnkResultRowApplicable,
} from '@/lib/report-modal-rows'
import { getRequestNameFromNaming, sortLnkRequestNamesNewestFirst } from '@/lib/report-naming'

export function getLnkResultMethodRequestOptions(
  lnkRows: WeldRow[],
  requestOptions: string[],
  methodKey: LnkResultDraftState['methodKey'],
) {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) return requestOptions

  return sortLnkRequestNamesNewestFirst([
    ...new Set(
      lnkRows.flatMap((row) => {
        const requestName = String(row[method.requestKey] ?? '').trim()
        if (!requestName || isFinalLnkResultValue(row[method.resultKey])) return []
        return [requestName]
      }),
    ),
  ])
}

export function getLnkResultSearchRows({
  lnkRows,
  selectedRequestRows,
  draft,
}: {
  lnkRows: WeldRow[]
  selectedRequestRows: WeldRow[]
  draft: LnkResultDraftState
}) {
  const baseRows = draft.requestName ? selectedRequestRows : lnkRows
  const method = getLnkMethodByRequestKey(draft.methodKey)
  if (!method) return baseRows

  return baseRows.filter(
    (row) =>
      isLnkResultRowApplicable(row, draft.requestName, draft.methodKey) &&
      !isFinalLnkResultValue(row[method.resultKey]),
  )
}

export function getLnkResultMethodRows({
  lnkRows,
  selectedRequestRows,
  selectedRows,
  draft,
}: {
  lnkRows: WeldRow[]
  selectedRequestRows: WeldRow[]
  selectedRows: WeldRow[]
  draft: LnkResultDraftState
}) {
  if (draft.rowIds.size > 0) return selectedRows
  if (draft.requestName) return selectedRequestRows
  return lnkRows
}

export function getSelectedLnkResultMethods(rows: WeldRow[]) {
  return getLnkInputMethodsForRows(rows, '')
}

export function getFilteredLnkResultRows(rows: WeldRow[], draft: LnkResultDraftState) {
  return filterLnkResultRows(rows, draft.search, draft.methodKey)
}

export function getVisibleLnkResultRows(
  rows: WeldRow[],
  selectedRowIds: Set<number>,
  shouldPinPreviewedRows: boolean,
) {
  if (!shouldPinPreviewedRows || selectedRowIds.size === 0) return rows

  return [...rows].sort((left, right) => {
    const leftSelected = selectedRowIds.has(left.id)
    const rightSelected = selectedRowIds.has(right.id)
    if (leftSelected === rightSelected) return 0
    return leftSelected ? -1 : 1
  })
}

export function getSelectableVisibleLnkResultRows(rows: WeldRow[], draft: LnkResultDraftState) {
  return rows.filter((row) => canSelectLnkResultRow(row, draft.requestName, draft.methodKey))
}

export function canBulkToggleLnkResultRows({
  draft,
  selectableRows,
  visibleRows,
}: {
  draft: LnkResultDraftState
  selectableRows: WeldRow[]
  visibleRows: WeldRow[]
}) {
  return Boolean(
    draft.methodKey &&
      selectableRows.length > 0 &&
      (draft.requestName || draft.search.trim() || visibleRows.length <= 20),
  )
}

export function getSelectedLnkResultRows(lnkRows: WeldRow[], draft: LnkResultDraftState) {
  return lnkRows.filter((row) => draft.rowIds.has(row.id) && canSelectLnkResultRow(row, '', draft.methodKey))
}

export function getLnkResultSaveBlockReason({
  draft,
  isSaving,
  nextConclusionName,
  saveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  selectedRows,
}: {
  draft: LnkResultDraftState
  isSaving: boolean
  nextConclusionName: string
  saveCheckSettings?: SaveCheckSettings
  selectedRows: WeldRow[]
}) {
  if (isSaving) return 'Результат сохраняется, дождитесь завершения.'
  if (!draft.methodKey) return 'Выберите метод контроля.'
  if (selectedRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
  const hasNonEmptyRows = hasNonEmptyLnkResultDraftRows(selectedRows, draft, saveCheckSettings)
  if (!areLnkResultDraftRowsReady(selectedRows, draft, saveCheckSettings)) return 'Укажите результат для каждого выбранного стыка.'
  if (saveCheckSettings.lnkResultControlDateRequired && hasNonEmptyRows && !draft.controlDate) {
    return formatSaveCheckBlockReason('lnkResultControlDateRequired', 'Укажите дату контроля.')
  }
  if (saveCheckSettings.lnkResultControlDateFormat && hasNonEmptyRows) {
    const dateReason = getDateInputValidationReason(draft.controlDate, 'Дата контроля')
    if (dateReason) return formatSaveCheckBlockReason('lnkResultControlDateFormat', dateReason)
  }

  const dateIssue = saveCheckSettings.lnkResultDateAfterWeldDate && hasNonEmptyRows
    ? findFirstLnkResultDateBeforeWeldDateIssue(selectedRows, draft, saveCheckSettings)
    : null
  if (dateIssue) return formatSaveCheckBlockReason('lnkResultDateAfterWeldDate', dateIssue)

  if (
    saveCheckSettings.lnkResultConclusionRequired &&
    hasNonEmptyRows &&
    !getRequestNameFromNaming(draft.conclusionNaming, nextConclusionName, draft.controlDate)
  ) {
    return formatSaveCheckBlockReason('lnkResultConclusionRequired', 'Укажите наименование заключения.')
  }

  const vikBeforeOtherIssue = findFirstLnkResultVikBeforeOtherDraftIssue(selectedRows, draft, saveCheckSettings)
  if (vikBeforeOtherIssue) return vikBeforeOtherIssue

  const chronologyIssue = hasNonEmptyRows
    ? findFirstLnkChronologySaveBlockReason(
        buildProposedLnkResultRowsForChecks(selectedRows, draft, nextConclusionName),
        saveCheckSettings,
      )
    : ''
  if (chronologyIssue) return chronologyIssue

  return ''
}

function findFirstLnkResultVikBeforeOtherDraftIssue(
  selectedRows: WeldRow[],
  draft: LnkResultDraftState,
  saveCheckSettings: SaveCheckSettings,
) {
  if (!saveCheckSettings.lnkResultVikRequiredBeforeOther) return ''
  const method = getLnkMethodByRequestKey(draft.methodKey)
  if (!method || method.code === 'ВИК') return ''
  const row = selectedRows.find((candidate) => {
    const result = getEffectiveLnkResultDraftValueForRow(candidate, draft, saveCheckSettings)
    return isFinalLnkResultValue(result) && !isFinalLnkResultValue(candidate.vikResult)
  })
  if (!row) return ''
  const joint = String(row.joint ?? '').trim() || `ID ${row.id}`
  return formatSaveCheckBlockReason('lnkResultVikRequiredBeforeOther', `Стык ${joint}: нельзя сохранять результат ${method.code}, пока нет результата ВИК.`)
}

function buildProposedLnkResultRowsForChecks(
  selectedRows: WeldRow[],
  draft: LnkResultDraftState,
  nextConclusionName: string,
) {
  const method = getLnkMethodByRequestKey(draft.methodKey)
  if (!method) return selectedRows
  const normalizedControlDate = normalizeDateLikeForStorage(draft.controlDate)
  const conclusionName = getRequestNameFromNaming(draft.conclusionNaming, nextConclusionName, draft.controlDate)
  return selectedRows.map((row) => {
    const result = draft.rowResults[row.id] ?? draft.result
    if (!isFinalLnkResultValue(result)) return row
    return {
      ...row,
      [method.resultKey]: result,
      [method.conclusionDateKey]: normalizedControlDate,
      [method.conclusionKey]: conclusionName,
    }
  })
}
