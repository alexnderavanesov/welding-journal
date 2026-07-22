import type { WeldRow } from '@/lib/dispatcher-types'
import { getDateInputValidationReason, normalizeDateLikeForStorage } from '@/lib/date-format'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import { findFirstPstoChronologySaveBlockReason } from '@/lib/psto-chronology-checks'
import { findFirstDateBeforeWeldDateIssue } from '@/lib/report-date-rules'
import {
  collectRequestNames,
  filterRequestNamesBySearch,
  getRequestNameFromNaming,
  sortPstoRequestNamesNewestFirst,
} from '@/lib/report-naming'
import { canSelectPstoResultRow } from '@/lib/report-modal-rows'
import { filterPstoResultRows } from '@/lib/report-row-utils'
import { hasText } from '@/lib/report-value-utils'
import { DEFAULT_SAVE_CHECK_SETTINGS, formatSaveCheckBlockReason, type SaveCheckSettings } from '@/lib/save-check-settings'

export function getPstoResultAvailableRequestOptions(selectedRows: WeldRow[], requestOptions: string[]) {
  const selectedRequestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
  return selectedRequestOptions.length > 0 ? selectedRequestOptions : requestOptions
}

export function getFilteredPstoResultRequestOptions(requestOptions: string[], search: string) {
  return filterRequestNamesBySearch(requestOptions, search)
}

export function getPstoResultSearchRows({
  heatTreatmentRows,
  selectedRequestRows,
  draft,
}: {
  heatTreatmentRows: WeldRow[]
  selectedRequestRows: WeldRow[]
  draft: PstoResultDraftState
}) {
  return draft.requestName ? selectedRequestRows : heatTreatmentRows
}

export function getFilteredPstoResultRows(rows: WeldRow[], draft: PstoResultDraftState) {
  return filterPstoResultRows(rows, draft.search)
}

export function getSelectedPstoResultRows(rows: WeldRow[], draft: PstoResultDraftState) {
  return rows.filter((row) => draft.rowIds.has(row.id) && canSelectPstoResultRow(row, draft.requestName))
}

export function getPstoResultSaveBlockReason({
  draft,
  isSaving,
  nextDiagramName,
  saveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  selectedRows,
}: {
  draft: PstoResultDraftState
  isSaving: boolean
  nextDiagramName: string
  saveCheckSettings?: SaveCheckSettings
  selectedRows: WeldRow[]
}) {
  if (isSaving) return 'Результат сохраняется, дождитесь завершения.'
  if (!draft.requestName) return 'Выберите заявку ПСТО.'
  if (selectedRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
  if (!draft.result) return 'Выберите результат ПСТО.'
  if (draft.result !== 'проведено') return 'Выберите результат ПСТО.'
  if (saveCheckSettings.pstoResultDateRequired && !draft.pstoDate) return formatSaveCheckBlockReason('pstoResultDateRequired', 'Укажите дату ПСТО.')

  if (saveCheckSettings.pstoResultDateFormat) {
    const dateReason = getDateInputValidationReason(draft.pstoDate, 'Дата ПСТО')
    if (dateReason) return formatSaveCheckBlockReason('pstoResultDateFormat', dateReason)
  }

  const dateIssue = saveCheckSettings.pstoResultDateAfterWeldDate
    ? findFirstDateBeforeWeldDateIssue(selectedRows, draft.pstoDate, 'Дата ПСТО')
    : null
  if (dateIssue) return formatSaveCheckBlockReason('pstoResultDateAfterWeldDate', dateIssue)

  if (
    saveCheckSettings.pstoResultDiagramRequired &&
    !getRequestNameFromNaming(draft.diagramNaming, nextDiagramName, draft.pstoDate)
  ) {
    return formatSaveCheckBlockReason('pstoResultDiagramRequired', 'Укажите наименование диаграммы термообработки.')
  }

  const chronologyIssue = findFirstPstoChronologySaveBlockReason(
    buildProposedPstoResultRowsForChecks(selectedRows, draft, nextDiagramName),
    saveCheckSettings,
  )
  if (chronologyIssue) return chronologyIssue

  return ''
}

function buildProposedPstoResultRowsForChecks(
  selectedRows: WeldRow[],
  draft: PstoResultDraftState,
  nextDiagramName: string,
) {
  const pstoDate = normalizeDateLikeForStorage(draft.pstoDate) ?? draft.pstoDate
  const diagramName = getRequestNameFromNaming(draft.diagramNaming, nextDiagramName, draft.pstoDate)
  return selectedRows.map((row) => ({
    ...row,
    pstoDate,
    pstoResult: draft.result,
    heatTreatmentDiagram: diagramName,
  }))
}

export function getManagedPstoResultRows(rows: WeldRow[], selectedRowIds: Set<number>) {
  return rows.filter(
    (row) => selectedRowIds.has(row.id) && (hasText(row.pstoResult) || hasText(row.heatTreatmentDiagram) || hasText(row.pstoDate)),
  )
}
