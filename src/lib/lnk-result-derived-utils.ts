import type { WeldRow } from '@/lib/dispatcher-types'
import { getDateInputValidationReason } from '@/lib/date-format'
import { normalizeDateLikeForStorage } from '@/lib/date-format'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { findFirstLnkChronologySaveBlockReason, getLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
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
import { getRequestNameFromNaming } from '@/lib/report-naming'
import {
  collectRequestDocumentIdentities,
  createRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { getLnkChronologyRootCauseActions } from '@/lib/workflow-root-cause-actions'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import type { LnkChronologyIssueKind } from '@/lib/lnk-chronology-checks'

const PRIMARY_LNK_STAGE_DEBT_ISSUE_KINDS = new Set<LnkChronologyIssueKind>(['post-before-psto-cycle'])

export function getLnkResultMethodRequestOptions(
  lnkRows: WeldRow[],
  requestOptions: RequestDocumentIdentity[],
  methodKey: LnkResultDraftState['methodKey'],
) {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) return requestOptions

  return collectRequestDocumentIdentities(
    lnkRows.flatMap((row) => {
      if (isFinalLnkResultValue(row[method.resultKey])) return []
      const identity = createRequestDocumentIdentity(row[method.requestKey], row[method.requestDateKey])
      return identity ? [identity] : []
    }),
  )
}

export function getLnkResultSearchRows({
  lnkRows,
  selectedRequestRows,
  requestName,
  requestDate,
  methodKey,
}: {
  lnkRows: WeldRow[]
  selectedRequestRows: WeldRow[]
  requestName: string
  requestDate: string
  methodKey: LnkResultDraftState['methodKey']
}) {
  const baseRows = requestName ? selectedRequestRows : lnkRows
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) return baseRows

  return baseRows.filter(
    (row) =>
      isLnkResultRowApplicable(row, requestName, methodKey, requestDate) &&
      !isFinalLnkResultValue(row[method.resultKey]),
  )
}

export function getLnkResultMethodRows({
  lnkRows,
  selectedRequestRows,
  selectedRows,
  requestName,
}: {
  lnkRows: WeldRow[]
  selectedRequestRows: WeldRow[]
  selectedRows: WeldRow[]
  requestName: string
}) {
  if (selectedRows.length > 0) return selectedRows
  if (requestName) return selectedRequestRows
  return lnkRows
}

export function getSelectedLnkResultMethods(rows: WeldRow[]) {
  return getLnkInputMethodsForRows(rows, '')
}

export function getFilteredLnkResultRows(
  rows: WeldRow[],
  search: string,
  methodKey: LnkResultDraftState['methodKey'],
) {
  return filterLnkResultRows(rows, search, methodKey)
}

export function getSelectableVisibleLnkResultRows(
  rows: WeldRow[],
  requestName: string,
  methodKey: LnkResultDraftState['methodKey'],
  requestDate: string,
) {
  return rows.filter((row) =>
    canSelectLnkResultRow(row, requestName, methodKey, requestDate),
  )
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

export function getSelectedLnkResultRows(
  lnkRows: WeldRow[],
  draft: LnkResultDraftState,
  controlProcessSettings?: ControlProcessSettings,
) {
  return lnkRows.filter(
    (row) =>
      draft.rowIds.has(row.id) &&
      canSelectLnkResultRow(
        row,
        draft.requestName,
        draft.methodKey,
        draft.requestDate,
        controlProcessSettings,
      ),
  )
}

export function getLnkResultSaveBlockReason({
  draft,
  isSaving,
  nextConclusionName,
  saveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  selectedRows,
  systemDocumentCreationPlan,
  controlProcessSettings,
}: {
  draft: LnkResultDraftState
  isSaving: boolean
  nextConclusionName: string
  saveCheckSettings?: SaveCheckSettings
  selectedRows: WeldRow[]
  systemDocumentCreationPlan?: SystemDocumentCreationPlan | null
  controlProcessSettings?: ControlProcessSettings
}) {
  if (isSaving) return 'Результат сохраняется, дождитесь завершения.'
  if (!draft.methodKey) return 'Выберите метод контроля.'
  if (selectedRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
  const hasNonEmptyRows = hasNonEmptyLnkResultDraftRows(selectedRows, draft, saveCheckSettings)
  if (!areLnkResultDraftRowsReady(selectedRows, draft, saveCheckSettings)) return 'Укажите результат для каждого выбранного стыка.'
  if (saveCheckSettings.lnkResultControlDateRequired && hasNonEmptyRows && !draft.controlDate) {
    return formatSaveCheckBlockReason('lnkResultControlDateRequired', 'Укажите дату контроля.')
  }
  if (hasNonEmptyRows) {
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
    !systemDocumentCreationPlan &&
    !getRequestNameFromNaming(draft.conclusionNaming, nextConclusionName)
  ) {
    return formatSaveCheckBlockReason('lnkResultConclusionRequired', 'Укажите наименование заключения.')
  }
  if (hasNonEmptyRows && systemDocumentCreationPlan?.error) {
    return saveCheckSettings.lnkResultConclusionRequired
      ? formatSaveCheckBlockReason('lnkResultConclusionRequired', systemDocumentCreationPlan.error)
      : systemDocumentCreationPlan.error
  }

  const vikBeforeOtherIssue = findFirstLnkResultVikBeforeOtherDraftIssue(selectedRows, draft, saveCheckSettings)
  if (vikBeforeOtherIssue) return vikBeforeOtherIssue

  const chronologyIssue = hasNonEmptyRows
    ? findFirstLnkChronologySaveBlockReason(
        buildProposedLnkResultRowsForChecks(selectedRows, draft, nextConclusionName, systemDocumentCreationPlan),
        saveCheckSettings,
        isPrimaryLnkStageDebtAllowed(controlProcessSettings)
          ? { ignoredKinds: PRIMARY_LNK_STAGE_DEBT_ISSUE_KINDS }
          : undefined,
      )
    : ''
  if (chronologyIssue) return chronologyIssue

  return ''
}

export function getLnkResultRootCauseActions({
  draft,
  nextConclusionName,
  saveBlockReason,
  saveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  selectedRows,
  systemDocumentCreationPlan,
  controlProcessSettings,
}: {
  draft: LnkResultDraftState
  nextConclusionName: string
  saveBlockReason: string | null
  saveCheckSettings?: SaveCheckSettings
  selectedRows: WeldRow[]
  systemDocumentCreationPlan?: SystemDocumentCreationPlan | null
  controlProcessSettings?: ControlProcessSettings
}) {
  if (!saveBlockReason || !draft.methodKey || selectedRows.length === 0) return []
  const issues = getLnkChronologyIssues(
    buildProposedLnkResultRowsForChecks(selectedRows, draft, nextConclusionName, systemDocumentCreationPlan),
    saveCheckSettings,
  ).filter((issue) =>
    !isPrimaryLnkStageDebtAllowed(controlProcessSettings) || issue.kind !== 'post-before-psto-cycle',
  )
  if (issues.length === 0) return []
  const firstIssue = issues[0]!
  if (!saveBlockReason.includes(firstIssue.message) && !saveBlockReason.includes('ВИК')) return []
  return getLnkChronologyRootCauseActions(issues)
}

function isPrimaryLnkStageDebtAllowed(settings?: ControlProcessSettings) {
  return Boolean(
    settings?.preHeatTreatmentLnkEnabled &&
    settings.allowPrimaryLnkBeforePreviousStagesComplete,
  )
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
  systemDocumentCreationPlan?: SystemDocumentCreationPlan | null,
) {
  const method = getLnkMethodByRequestKey(draft.methodKey)
  if (!method) return selectedRows
  const normalizedControlDate = normalizeDateLikeForStorage(draft.controlDate)
  return selectedRows.map((row) => {
    const result = draft.rowResults[row.id] ?? draft.result
    if (!isFinalLnkResultValue(result)) return row
    const conclusionName = systemDocumentCreationPlan?.groups.find((group) => group.rowIds.includes(row.id))?.name
      ?? getRequestNameFromNaming(draft.conclusionNaming, nextConclusionName)
    return {
      ...row,
      [method.resultKey]: result,
      [method.conclusionDateKey]: normalizedControlDate,
      [method.conclusionKey]: conclusionName,
    }
  })
}
