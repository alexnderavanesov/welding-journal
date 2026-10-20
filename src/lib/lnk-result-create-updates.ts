import { LNK_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import { assertDocumentRequisites } from '@/lib/document-requisites'
import { normalizeDateLikeForStorage } from '@/lib/date-format'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { withLnkFinalStatus } from '@/lib/lnk-field-updates'
import { assertNoNewLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { isValidLnkResultDraftValue } from '@/lib/lnk-result-draft'
import { assertLnkResultAllowed } from '@/lib/lnk-result-policy'
import { formatDateBeforeWeldDateSaveReason, isDateBeforeWeldDate } from '@/lib/report-date-rules'
import { loadSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import { loadOtherSettings } from '@/lib/other-settings'
import { applyRkExposureResultTransition } from '@/lib/rk-exposure'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'
import type { RkExposureTableSettings } from '@/lib/other-settings'
import { loadControlProcessSettings, type ControlProcessSettings } from '@/lib/control-process-settings'
import { getPrimaryLnkStageAccess } from '@/lib/lnk-control-stage'
import { transitionLnkDefectDescription } from '@/lib/lnk-defect-description'
import type { LnkChronologyIssueKind } from '@/lib/lnk-chronology-checks'
import { assertUnofficialLnkGoodResultAllowed } from './unofficial-lnk-result-guard'

const PRIMARY_LNK_STAGE_DEBT_ISSUE_KINDS = new Set<LnkChronologyIssueKind>([
  'post-before-psto-cycle',
])

export function buildLnkResultRows({
  records,
  methodKey,
  controlDate,
  resultById,
  conclusionName,
  rkExposureTable: suppliedRkExposureTable,
  saveCheckSettings = loadSaveCheckSettings(),
  controlProcessSettings,
}: {
  records: RowWithId[]
  methodKey: WeldFieldKey
  controlDate: string
  resultById: Record<number, string>
  conclusionName: string
  rkExposureTable?: RkExposureTableSettings | null
  saveCheckSettings?: SaveCheckSettings
  controlProcessSettings?: Pick<ControlProcessSettings, 'preHeatTreatmentLnkEnabled' | 'allowPrimaryLnkBeforePreviousStagesComplete'> & Partial<Pick<ControlProcessSettings, 'pvkGoodOnly'>>
}) {
  const rkExposureTable = suppliedRkExposureTable === undefined
    ? loadOtherSettings().rkExposureTable
    : suppliedRkExposureTable
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) throw new Error('Выберите метод контроля')
  const results = records.map((record) => resultById[record.id] ?? '')
  const hasNonEmptyResult = results.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
  if (results.some((result) => !isValidLnkResultDraftValue(result))) throw new Error('Укажите результат для каждого выбранного стыка')
  if (hasNonEmptyResult) assertDocumentRequisites({ name: conclusionName, date: controlDate })
  if (saveCheckSettings.lnkResultDateAfterWeldDate && hasNonEmptyResult) {
    const dateIssueRecord = records.find((record) => isDateBeforeWeldDate(controlDate, record.weldDate))
    if (dateIssueRecord) throw new Error(formatDateBeforeWeldDateSaveReason(dateIssueRecord, controlDate, `Дата контроля ${method.code}`))
  }
  if (hasNonEmptyResult) {
    const blockedAccess = records
      .map((record) => getPrimaryLnkStageAccess(record, method.code, controlProcessSettings))
      .find((access) => access.status === 'blocked')
    if (blockedAccess) throw new Error(blockedAccess.reason)
  }
  const pvkGoodOnly = controlProcessSettings?.pvkGoodOnly ?? loadControlProcessSettings().pvkGoodOnly
  records.forEach((record) => assertLnkResultAllowed(record, method.code, resultById[record.id] ?? '', { pvkGoodOnly }))
  const normalizedControlDate = normalizeDateLikeForStorage(controlDate) ?? (controlDate.trim() || null)

  const lnkUpdatedAt = new Date().toISOString()
  const proposedRecords = records.map((record) => {
    const result = resultById[record.id] ?? ''
    assertUnofficialLnkGoodResultAllowed(record, result, record[method.resultKey], method.code)
    const shouldClearResult = result === LNK_EMPTY_RESULT_VALUE
    if (!shouldClearResult) {
      assertDocumentRequisites({ name: record[method.requestKey], date: record[method.requestDateKey],
        nameLabel: `наименование заявки ${method.code}`, dateLabel: `Дата заявки ${method.code}` })
    }
    let proposedRecord = {
      ...record,
      [method.resultKey]: shouldClearResult ? null : result,
      [method.conclusionDateKey]: shouldClearResult ? null : normalizedControlDate,
      [method.conclusionKey]: shouldClearResult ? null : conclusionName.trim(),
      lnkCreatedAt: record.lnkCreatedAt ?? lnkUpdatedAt,
      lnkUpdatedAt,
    } as RowWithId
    if (method.code === 'РК') {
      const exposureRecord = applyRkExposureResultTransition(
        record,
        shouldClearResult ? null : result,
        rkExposureTable,
      )
      proposedRecord = {
        ...proposedRecord,
        lnkDefectDescription: exposureRecord.lnkDefectDescription,
        rkExposureConfirmedDiameter: exposureRecord.rkExposureConfirmedDiameter,
      }
    } else {
      proposedRecord = {
        ...proposedRecord,
        [method.defectDescriptionKey]: transitionLnkDefectDescription({
          currentResult: record[method.resultKey],
          nextResult: shouldClearResult ? null : result,
          currentDescription: record[method.defectDescriptionKey],
        }),
      }
    }
    return withLnkFinalStatus(proposedRecord)
  })
  assertNoNewLnkChronologyIssues(
    proposedRecords,
    records,
    saveCheckSettings,
    controlProcessSettings?.preHeatTreatmentLnkEnabled &&
      controlProcessSettings.allowPrimaryLnkBeforePreviousStagesComplete
      ? { ignoredKinds: PRIMARY_LNK_STAGE_DEBT_ISSUE_KINDS }
      : undefined,
  )
  return proposedRecords
}
