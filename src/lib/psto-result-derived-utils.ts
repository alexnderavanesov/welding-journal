import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
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
  selectedRows,
}: {
  draft: PstoResultDraftState
  isSaving: boolean
  nextDiagramName: string
  selectedRows: WeldRow[]
}) {
  if (isSaving) return 'Результат сохраняется, дождитесь завершения.'
  if (!draft.requestName) return 'Выберите заявку ПСТО.'
  if (selectedRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
  if (!draft.result) return 'Выберите результат ПСТО.'
  if (draft.result !== PSTO_EMPTY_RESULT_VALUE && draft.result !== 'проведено') return 'Выберите результат ПСТО.'
  if (draft.result !== PSTO_EMPTY_RESULT_VALUE && !draft.pstoDate) return 'Укажите дату ПСТО.'

  const dateIssue =
    draft.result === PSTO_EMPTY_RESULT_VALUE
      ? null
      : findFirstDateBeforeWeldDateIssue(selectedRows, draft.pstoDate, 'Дата ПСТО')
  if (dateIssue) return dateIssue

  if (draft.result !== PSTO_EMPTY_RESULT_VALUE && !getRequestNameFromNaming(draft.diagramNaming, nextDiagramName)) {
    return 'Укажите наименование диаграммы термообработки.'
  }

  return ''
}

export function getManagedPstoResultRows(rows: WeldRow[], selectedRowIds: Set<number>) {
  return rows.filter(
    (row) => selectedRowIds.has(row.id) && (hasText(row.pstoResult) || hasText(row.heatTreatmentDiagram) || hasText(row.pstoDate)),
  )
}
