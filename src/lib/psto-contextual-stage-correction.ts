import type { ControlProcessSettings } from './control-process-settings'
import { getDateInputValidationReason } from './date-format'
import type { WeldRow } from './dispatcher-types'
import { getLayeredControlSaveError } from './layered-control-rules'
import { getLnkChronologyIssues } from './lnk-chronology-checks'
import {
  isPreHeatTreatmentLnkAvailable,
  type LnkControlStage,
  type PreHeatTreatmentControlRecord,
} from './lnk-control-stage'
import { LNK_METHODS } from './lnk-report-config'
import { getLnkResultRuleIssues } from './lnk-result-policy'
import { attachPreHeatTreatmentReportValues } from './pre-heat-treatment-report-fields'
import { hasPstoDocumentHistory } from './psto-cycle'
import { normalizeControlResultText } from './report-value-utils'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import type { SystemIndexSettings } from './system-index-settings'
import {
  assertUnofficialLastRejectionRetained,
  assertUnofficialLnkGoodResultAllowed,
} from './unofficial-lnk-result-guard'
import { calculateFinalStatus, normalizeResultStatus } from './weld-status'

type Method = (typeof LNK_METHODS)[number]
const PACKAGE_FIELDS = [
  ['requestName', 'requestKey'],
  ['requestDate', 'requestDateKey'],
  ['result', 'resultKey'],
  ['conclusionDate', 'conclusionDateKey'],
  ['conclusionName', 'conclusionKey'],
  ['defectDescription', 'defectDescriptionKey'],
] as const

/** The caller authorizes the contextual action, applies the target line metadata,
 * and loads relations first. This function neither persists nor resolves documents.
 * Negative control IDs are local placeholders; persistence must replace them.
 */
export function buildPstoContextualStageCorrection(
  row: WeldRow,
  targetStage: LnkControlStage,
  processSettings: ControlProcessSettings,
  systemIndexSettings: SystemIndexSettings,
): WeldRow {
  if (targetStage !== 'primary' && targetStage !== 'beforeHeatTreatment') {
    throw new Error('Неизвестный целевой этап НК.')
  }
  if (!processSettings.preHeatTreatmentLnkEnabled) {
    throw new Error('Исправление этапа недоступно: НК до ТО выключен в настройках.')
  }
  // Assignment, waiting labels and accounting fields alone are not a started cycle.
  if (hasPstoDocumentHistory(row) || (row.pstoRepeatCycles?.length ?? 0) > 0 ||
    [row.pstoResult, row.tvmtResult].some(value =>
      hasResultTrace(value) && normalizeControlResultText(value) !== 'отменен')) {
    throw new Error('Исправление этапа невозможно: сохранены заявка или история ПСТО/ТВМТ. Сохраните исходные этапы НК.')
  }

  const previous: WeldRow = { ...row, preHeatTreatmentLnkEnabled: true }
  let next: WeldRow = { ...previous }
  const controls = row.preHeatTreatmentControls ?? []
  const primaryPackages = LNK_METHODS.map(method => readPrimaryPackage(row, method))

  if (targetStage === 'beforeHeatTreatment') {
    if (!isPreHeatTreatmentLnkAvailable(previous)) {
      throw new Error('Для целевой линии этап НК до ТО не предусмотрен.')
    }
    // Even an unrelated method or an empty persisted relation occupies the target.
    if (controls.length > 0) throw new Error('Целевой этап НК до ТО уже заполнен. Сохраните исходные этапы.')
    const packages = primaryPackages.filter(hasPackageTrace)
    if (packages.length === 0) throw new Error('Нет основного комплекта НК для исправления этапа.')
    packages.forEach(assertPackageComplete)
    for (const control of packages) {
      assertUnofficialLnkGoodResultAllowed(previous, control.result, null, `${control.method} до ТО`, { allowBackfill: false })
      const method = LNK_METHODS.find(method => method.code === control.method)!
      for (const [, key] of PACKAGE_FIELDS) next[method[key]] = null
      if (method.code === 'РК') next.rkExposureConfirmedDiameter = null
    }
    next.preHeatTreatmentControls = packages
  } else {
    if (primaryPackages.some(hasPackageTrace)) {
      throw new Error('Целевой основной этап НК уже заполнен. Сохраните исходные этапы.')
    }
    if (!controls.some(hasPackageTrace)) throw new Error('Нет комплекта НК до ТО для исправления этапа.')
    const methods = new Set<string>()
    for (const control of controls) {
      const method = LNK_METHODS.find(method => method.code === control.method)
      if (!method || control.weldJointId !== row.id || methods.has(control.method)) {
        throw new Error('Состав НК до ТО некорректен: проверьте методы, повторы и принадлежность стыку.')
      }
      methods.add(control.method)
      if (hasPackageTrace(control)) assertPackageComplete(control)
      assertUnofficialLnkGoodResultAllowed(previous, control.result, null, control.method, { allowBackfill: false })
      for (const [field, key] of PACKAGE_FIELDS) next[method[key]] = control[field] ?? null
      if (method.code === 'РК') next.rkExposureConfirmedDiameter = control.rkExposureConfirmedDiameter ?? null
    }
    next.preHeatTreatmentControls = []
  }

  // Rebuild virtual fields so validation cannot see a stale pre-TO rejection after
  // its relation has moved. Stored names, dates, results and defects stay verbatim.
  next = attachPreHeatTreatmentReportValues(next, next.preHeatTreatmentControls ?? []) as WeldRow
  assertUnofficialLastRejectionRetained(next, previous)
  const protectedDataReason = getLayeredControlSaveError(next, previous, processSettings.pvkGoodOnly)
    || getLnkResultRuleIssues(next, systemIndexSettings)[0]?.message
    || getDateInputValidationReason(next.weldDate, 'Дата сварки')
  if (protectedDataReason) throw new Error(protectedDataReason)

  // Validate the complete transformed package, never a delta against old errors.
  // Early-main permission cannot relax chronology for a stage correction.
  const issue = getLnkChronologyIssues([next], DEFAULT_SAVE_CHECK_SETTINGS, {
    includeSystemRules: true,
    includeConclusionBeforeWeldIssue: true,
    includeInvalidDateIssues: true,
    includeRequestIntegrityIssues: true,
  })[0]
  if (issue) throw new Error(`Исправление этапа нарушает данные: ${issue.message}`)
  return { ...next, finalStatus: calculateFinalStatus(next) }
}

export function getPstoContextualStageCorrectionReason(
  ...args: Parameters<typeof buildPstoContextualStageCorrection>
): string | null {
  try {
    buildPstoContextualStageCorrection(...args)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function readPrimaryPackage(row: WeldRow, method: Method): PreHeatTreatmentControlRecord {
  return {
    // Stable and distinct across persisted welds as well as methods (DB IDs are int4).
    id: -(row.id * LNK_METHODS.length + LNK_METHODS.indexOf(method) + 1),
    weldJointId: row.id,
    method: method.code,
    ...Object.fromEntries(PACKAGE_FIELDS.map(([field, key]) => [field, row[method[key]] ?? null])),
    rkExposureConfirmedDiameter: method.code === 'РК'
      ? row.rkExposureConfirmedDiameter as number | null | undefined
      : null,
  }
}

function hasPackageTrace(control: PreHeatTreatmentControlRecord) {
  return [control.requestName, control.requestDate, control.conclusionName,
    control.conclusionDate, control.defectDescription, control.rkExposureConfirmedDiameter,
  ].some(value => String(value ?? '').trim().length > 0) || hasResultTrace(control.result)
}

function hasResultTrace(value: unknown) {
  const text = normalizeControlResultText(value)
  return Boolean(text) && !/^ожидает(?:\s|$)/.test(text) &&
    !['-', 'нет потребности', 'не требуется'].includes(text)
}

/** Relocation requires complete source documents. KEEP is handled separately. */
function assertPackageComplete(control: PreHeatTreatmentControlRecord) {
  const present = (value: unknown) => Boolean(String(value ?? '').trim()) && String(value).trim() !== '-'
  if (!present(control.requestName)) {
    throw new Error(`${control.method}: нет наименования заявки ЛНК. Сначала исправьте исходный комплект.`)
  }
  if (!present(control.requestDate)) {
    throw new Error(`${control.method}: нет даты заявки ЛНК. Сначала исправьте исходный комплект.`)
  }
  const final = ['годен', 'ремонт', 'вырез'].includes(normalizeResultStatus(control.result) ?? '')
  if (final) {
    if (!present(control.conclusionDate)) throw new Error(`${control.method}: для результата укажите дату заключения.`)
    if (!present(control.conclusionName)) {
      throw new Error(`${control.method}: для результата укажите наименование заключения.`)
    }
  }
}
