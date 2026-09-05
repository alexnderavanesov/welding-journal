import type { WeldRow } from '@/lib/dispatcher-types'
import { getDateInputValidationReason, normalizeDateLikeForStorage } from '@/lib/date-format'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import { findFirstPstoChronologySaveBlockReason, getPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { findFirstDateBeforeWeldDateIssue } from '@/lib/report-date-rules'
import {
  getRequestNameFromNaming,
} from '@/lib/report-naming'
import { canSelectPstoResultRow } from '@/lib/report-modal-rows'
import { filterPstoResultRows } from '@/lib/report-row-utils'
import { hasText } from '@/lib/report-value-utils'
import { hasAnyPstoCycle } from '@/lib/psto-cycle'
import { DEFAULT_SAVE_CHECK_SETTINGS, formatSaveCheckBlockReason, type SaveCheckSettings } from '@/lib/save-check-settings'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { getPstoChronologyRootCauseActions } from '@/lib/workflow-root-cause-actions'
import {
  filterRequestDocumentIdentitiesBySearch,
  getPstoRequestDocumentIdentities,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

export function getPstoResultAvailableRequestOptions(
  selectedRows: WeldRow[],
  requestOptions: RequestDocumentIdentity[],
) {
  const selectedRequestOptions = getPstoRequestDocumentIdentities(selectedRows)
  return selectedRequestOptions.length > 0 ? selectedRequestOptions : requestOptions
}

export function getFilteredPstoResultRequestOptions(
  requestOptions: RequestDocumentIdentity[],
  search: string,
) {
  return filterRequestDocumentIdentitiesBySearch(requestOptions, search)
}

export function getPstoResultSearchRows({
  heatTreatmentRows,
  selectedRequestRows,
  requestName,
}: {
  heatTreatmentRows: WeldRow[]
  selectedRequestRows: WeldRow[]
  requestName: string
}) {
  return requestName ? selectedRequestRows : heatTreatmentRows
}

export function getFilteredPstoResultRows(rows: WeldRow[], search: string) {
  return filterPstoResultRows(rows, search)
}

export function getSelectedPstoResultRows(rows: WeldRow[], draft: PstoResultDraftState) {
  return rows.filter(
    (row) =>
      draft.rowIds.has(row.id) &&
      canSelectPstoResultRow(row, draft.requestName, draft.requestDate),
  )
}

export function getPstoResultSaveBlockReason({
  draft,
  isSaving,
  nextDiagramName,
  saveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  selectedRows,
  systemDocumentCreationPlan,
}: {
  draft: PstoResultDraftState
  isSaving: boolean
  nextDiagramName: string
  saveCheckSettings?: SaveCheckSettings
  selectedRows: WeldRow[]
  systemDocumentCreationPlan?: SystemDocumentCreationPlan | null
}) {
  if (isSaving) return 'Результат сохраняется, дождитесь завершения.'
  if (!draft.requestName) return 'Выберите заявку ПСТО.'
  if (selectedRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
  if (!draft.result) return 'Выберите результат ПСТО.'
  if (draft.result !== 'проведено') return 'Выберите результат ПСТО.'
  if (saveCheckSettings.pstoResultDateRequired && !draft.pstoDate) return formatSaveCheckBlockReason('pstoResultDateRequired', 'Укажите дату ПСТО.')

  {
    const dateReason = getDateInputValidationReason(draft.pstoDate, 'Дата ПСТО')
    if (dateReason) return formatSaveCheckBlockReason('pstoResultDateFormat', dateReason)
  }

  const dateIssue = saveCheckSettings.pstoResultDateAfterWeldDate
    ? findFirstDateBeforeWeldDateIssue(selectedRows, draft.pstoDate, 'Дата ПСТО')
    : null
  if (dateIssue) return formatSaveCheckBlockReason('pstoResultDateAfterWeldDate', dateIssue)

  if (
    saveCheckSettings.pstoResultDiagramRequired &&
    !systemDocumentCreationPlan &&
    !getRequestNameFromNaming(draft.diagramNaming, nextDiagramName)
  ) {
    return formatSaveCheckBlockReason('pstoResultDiagramRequired', 'Укажите наименование диаграммы термообработки.')
  }
  if (systemDocumentCreationPlan?.error) {
    return saveCheckSettings.pstoResultDiagramRequired
      ? formatSaveCheckBlockReason('pstoResultDiagramRequired', systemDocumentCreationPlan.error)
      : systemDocumentCreationPlan.error
  }

  const chronologyIssue = findFirstPstoChronologySaveBlockReason(
    buildProposedPstoResultRowsForChecks(selectedRows, draft, nextDiagramName, systemDocumentCreationPlan),
    saveCheckSettings,
  )
  if (chronologyIssue) return chronologyIssue

  return ''
}

export function getPstoResultRootCauseActions({
  draft,
  nextDiagramName,
  saveBlockReason,
  saveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  selectedRows,
  systemDocumentCreationPlan,
}: {
  draft: PstoResultDraftState
  nextDiagramName: string
  saveBlockReason: string | null
  saveCheckSettings?: SaveCheckSettings
  selectedRows: WeldRow[]
  systemDocumentCreationPlan?: SystemDocumentCreationPlan | null
}) {
  if (!saveBlockReason || selectedRows.length === 0) return []
  const issues = getPstoChronologyIssues(
    buildProposedPstoResultRowsForChecks(selectedRows, draft, nextDiagramName, systemDocumentCreationPlan),
    saveCheckSettings,
  )
  if (issues.length === 0 || !saveBlockReason.includes(issues[0]!.message)) return []
  return getPstoChronologyRootCauseActions(issues)
}

function buildProposedPstoResultRowsForChecks(
  selectedRows: WeldRow[],
  draft: PstoResultDraftState,
  nextDiagramName: string,
  systemDocumentCreationPlan?: SystemDocumentCreationPlan | null,
) {
  const pstoDate = normalizeDateLikeForStorage(draft.pstoDate) ?? draft.pstoDate
  return selectedRows.map((row) => {
    const diagramName = systemDocumentCreationPlan?.groups.find((group) => group.rowIds.includes(row.id))?.name
      ?? getRequestNameFromNaming(draft.diagramNaming, nextDiagramName)
    return {
      ...row,
      pstoDate,
      pstoResult: draft.result,
      heatTreatmentDiagram: diagramName,
    }
  })
}

export function getManagedPstoResultRows(rows: WeldRow[], selectedRowIds: Set<number>) {
  return rows.filter(
    (row) => selectedRowIds.has(row.id) && hasAnyPstoCycle(row, row.pstoRepeatCycles ?? []),
  )
}

export function hasPstoResultData(row: WeldRow) {
  const result = String(row.pstoResult ?? '').trim().toLowerCase()
  const hasStoredResult = result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
  return hasStoredResult || hasText(row.heatTreatmentDiagram) || hasText(row.pstoDate)
}
