import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import {
  LNK_METHODS,
  REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
  REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON,
  WELD_STAMP_COMPLETION_GROUPS,
} from '@/lib/report-config'
import { hasText, isEnabledControlValue } from '@/lib/report-value-utils'
import {
  formatDisplayDate,
  getDateInputValidationReason,
  getTodayIsoDate,
  parseDateLikeToIso,
} from '@/lib/date-format'
import { parseJointChainName } from '@/lib/joint-chain'
import { validateJointNameStructure } from '@/lib/joint-name'
import { formatJointDiameterLabel, isUnofficialJoint } from '@/lib/joint-display'
import {
  isLnkRepairForbiddenByDiameter,
  isLnkRepairForbiddenWithSettings,
} from '@/lib/lnk-result-rules'
import { getDispatcherLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { getDispatcherPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { formatOfficialStampCompatibilityIssue, getOfficialStampCompatibilityIssues } from '@/lib/welder-stamp-compatibility'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import type { RepeatedJointCheckTask, WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import {
  CONTROL_HISTORY_REASON,
  JOINT_CORE_DATA_REASON,
  LNK_RESULT_COMPLETENESS_REASON,
  PSTO_RESULT_COMPLETENESS_REASON,
} from '@/lib/dispatcher-check-reasons'
import { getControlAvailabilityReportHistoryIssues } from '@/lib/weld-form-save-reasons'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, type SystemIndexSettings } from '@/lib/system-index-settings'
import type { DataListSettings } from '@/lib/data-list-settings'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import {
  getPreHeatTreatmentControls,
  getPrimaryLnkStageDebt,
  getRejectedPreHeatTreatmentControls,
  hasPrimaryLnkControlTrace,
  type PrimaryLnkStageDebt,
} from '@/lib/lnk-control-stage'
import { buildPstoCycleTimeline, type PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import { normalizeTvmtResult } from '@/lib/tvmt-cycle'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import { getDuplicateControls } from '@/lib/duplicate-control-utils'
import {
  getLnkChronologyRootCauseActions,
  getPstoChronologyRootCauseActions,
  getPrimaryLnkStageDebtRootCauseAction,
  type WorkflowRootCauseAction,
} from '@/lib/workflow-root-cause-actions'
import { getPstoTvmtWorkflowLabel } from '@/lib/tvmt-cycle'
import {
  DEFAULT_CONTROL_PROCESS_SETTINGS,
  type ControlProcessSettings,
} from '@/lib/control-process-settings'

export const PRIMARY_LNK_STAGE_DEBT_SYSTEM_WARNING_REASON = 'завершить предыдущие этапы контроля'

export function buildPrimaryLnkStageDebtSystemWarnings(
  rows: WeldRow[],
  controlProcessSettings: ControlProcessSettings = DEFAULT_CONTROL_PROCESS_SETTINGS,
): RepeatedJointCheckTask[] {
  if (!controlProcessSettings.preHeatTreatmentLnkEnabled) return []
  return rows.flatMap((row) => {
    const methodDebts = LNK_METHODS.flatMap((method) => {
      if (!isEnabledControlValue(row[method.enabledKey])) return []
      if (!hasPrimaryLnkControlTrace(row, method.code)) return []
      const debt = getPrimaryLnkStageDebt(row, method.code)
      return debt ? [{ method, debt }] : []
    })
    if (methodDebts.length === 0) return []

    const debt: PrimaryLnkStageDebt = {
      missingPreHeatTreatmentControls: [...new Map(
        methodDebts
          .flatMap((entry) => entry.debt.missingPreHeatTreatmentControls)
          .map((control) => [`${control.methodCode}:${control.nextAction}`, control]),
      ).values()],
      pstoState: methodDebts[0]!.debt.pstoState,
      reason: [...new Set(methodDebts.map((entry) => entry.debt.reason))].join(' '),
    }
    const joint = String(row.joint ?? '').trim() || `ID ${row.id}`
    const methodCodes = methodDebts.map(({ method }) => method.code)
    const missingStages = [
      ...debt.missingPreHeatTreatmentControls.map(({ methodCode, nextAction }) =>
        `${nextAction === 'request' ? 'заявка' : 'результат'} ${methodCode} до ТО`,
      ),
      ...(debt.pstoState !== 'complete' && debt.pstoState !== 'not-required'
        ? [getPstoTvmtWorkflowLabel(debt.pstoState)]
        : []),
    ]
    const sourceJoint = String(row.joint ?? '').trim() || '-'
    return [{
      kind: 'check' as const,
      key: `sp-01:${row.id}:${methodCodes.join('+')}:${debt.missingPreHeatTreatmentControls
        .map(({ methodCode, nextAction }) => `${methodCode}:${nextAction}`)
        .join('+')}:${debt.pstoState}`,
      row,
      sourceRow: row,
      sourceJoint,
      targetJoint: sourceJoint,
      baseJoint: sourceJoint,
      suffix: 'R' as const,
      reason: PRIMARY_LNK_STAGE_DEBT_SYSTEM_WARNING_REASON,
      details: `Стык ${joint}: основной НК уже оформляется по методам ${methodCodes.join(', ')}, ` +
        `но предыдущие этапы еще не завершены: ${missingStages.join(', ')}. ` +
        'Подтвердите этапы после получения фактических данных. После этого предупреждение исчезнет автоматически.',
      rootCauseActions: [getPrimaryLnkStageDebtRootCauseAction(row, debt)],
      systemWarningCode: 'СП-01' as const,
    }]
  })
}

const WELDER_STAMP_AUDIT_SAVE_CHECK_SETTINGS = {
  ...DEFAULT_SAVE_CHECK_SETTINGS,
  officialRegistry: true,
  officialArchive: true,
  officialNaksDate: true,
  officialSuspension: true,
  officialWeldingMethod: true,
  officialMaterialGroup: true,
  officialDiameter: true,
  officialThickness: true,
  officialDls: true,
}

const CORE_DATE_AUDIT_FIELDS = [
  'weldDate',
  'testDate',
  'piDate',
  'pstoCancellationDate',
] as const satisfies readonly WeldFieldKey[]

export function buildForbiddenRepairByDiameterCheckTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  const tasks: RepeatedJointCheckTask[] = []
  for (const row of rows) {
    const repairMethods = LNK_METHODS.filter(
      (method) => String(row[method.resultKey] ?? '').trim().toLowerCase() === 'ремонт',
    )
    const preHeatTreatmentRepairs = getRejectedPreHeatTreatmentControls(row)
      .filter((control) => control.result === 'ремонт')
    const duplicateRepairs = getDuplicateControls(row)
      .filter((control) => String(control.result ?? '').trim().toLowerCase() === 'ремонт')
    if (
      (repairMethods.length === 0 && preHeatTreatmentRepairs.length === 0 && duplicateRepairs.length === 0) ||
      !isLnkRepairForbiddenWithSettings(row, systemIndexSettings)
    ) continue

    const joint = String(row.joint ?? '').trim() || '-'
    const methodCodes = [
      ...repairMethods.map((method) => method.code),
      ...preHeatTreatmentRepairs.map((control) => `${control.methodCode} до ТО`),
      ...duplicateRepairs.map((control) => `${control.method} (дубль)`),
    ].join(', ')
    const repairResultKeys: string[] = [
      ...repairMethods.map((method) => method.resultKey),
      ...preHeatTreatmentRepairs.map((control) => `preHeatTreatment:${control.control.id}`),
      ...duplicateRepairs.map((control) => `duplicate:${control.id}`),
    ]
    const forbiddenByDiameter = isLnkRepairForbiddenByDiameter(row)
    const reason = forbiddenByDiameter
      ? REPAIR_FORBIDDEN_BY_DIAMETER_REASON
      : REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON
    const details = forbiddenByDiameter
      ? `Стык ${joint}: результат ${methodCodes} - ремонт указан при минимальном диаметре ${formatJointDiameterLabel(row)} мм. Ремонт на стыке с диаметром меньше 89 мм недопустим; для такого диаметра выбирается только "вырез". Проверь D1/D2 или результат контроля.`
      : `Стык ${joint}: результат ${methodCodes} - ремонт указан после двух уже выполненных официальных ремонтов. На этом шаге доступен только "вырез". Проверь имя цепочки, официальность или результат контроля.`
    tasks.push(
      createJointChainCheckTask(
        row,
        `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:repair-rule:${row.id}:${repairResultKeys.join(',')}`,
        reason,
        details,
        systemIndexSettings,
      ),
    )
  }
  return tasks
}

export function buildLnkChronologyCheckTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  return groupIssuesByRowAndReason(getDispatcherLnkChronologyIssues(rows)).map((group) => {
    const row = group.row
    return createJointChainCheckTask(
      row,
      `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:lnk-chronology:${group.issueKeys.join('|')}`,
      group.reason,
      group.messages.join(' '),
      systemIndexSettings,
      getLnkChronologyRootCauseActions(group.issues),
    )
  })
}

export function buildPstoChronologyCheckTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  return groupIssuesByRowAndReason(getDispatcherPstoChronologyIssues(rows)).map((group) => {
    const row = group.row
    return createJointChainCheckTask(
      row,
      `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:psto-chronology:${group.issueKeys.join('|')}`,
      group.reason,
      group.messages.join(' '),
      systemIndexSettings,
      getPstoChronologyRootCauseActions(group.issues),
    )
  })
}

export function buildJointCoreDataCheckTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  const today = getTodayIsoDate()
  return rows.flatMap((row) => {
    const issues: string[] = []
    const issueKeys: string[] = []
    for (const fieldKey of CORE_DATE_AUDIT_FIELDS) {
      const field = FIELD_BY_KEY.get(fieldKey)
      const dateReason = getDateInputValidationReason(row[fieldKey], field?.label ?? 'Дата')
      if (!dateReason) continue
      issues.push(dateReason)
      issueKeys.push(`invalid-date:${fieldKey}`)
    }
    const weldDate = parseDateLikeToIso(row.weldDate)
    if (weldDate && weldDate > today) {
      issues.push(`дата сварки ${formatDisplayDate(weldDate)} позже сегодняшней даты ${formatDisplayDate(today)}`)
      issueKeys.push('future-weld-date')
    }

    const hasWeldDate = hasText(row.weldDate)
    const missingMaterialGroup = hasWeldDate && !hasText(row.materialGroup)
    const missingConnectionType = hasWeldDate && !hasText(row.connectionType)
    const missingWeldingMethod = hasWeldDate && !hasText(row.weldingMethod)
    if (missingMaterialGroup) {
      issueKeys.push('missing-material-group')
    }
    if (missingConnectionType) {
      issueKeys.push('missing-connection-type')
    }
    if (missingWeldingMethod) {
      issueKeys.push('missing-welding-method')
    }
    const missingRequiredFieldsReason = formatMissingRequiredWeldFields({
      materialGroup: missingMaterialGroup,
      connectionType: missingConnectionType,
      weldingMethod: missingWeldingMethod,
    })
    if (missingRequiredFieldsReason) {
      issues.push(`при заполненной дате сварки ${missingRequiredFieldsReason}`)
    }

    const jointStructureReason = validateJointNameStructure(row.joint, systemIndexSettings)
    if (jointStructureReason) {
      issues.push(jointStructureReason)
      issueKeys.push('joint-name')
    }
    if (issues.length === 0) return []

    const joint = String(row.joint ?? '').trim() || `ID ${row.id}`
    const details = issues
      .map((issue) => issue.trim().replace(/[.!?]+$/u, ''))
      .join('; ')
    return [createJointChainCheckTask(
      row,
      `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:joint-core-data:${row.id}:${issueKeys.join('|')}`,
      JOINT_CORE_DATA_REASON,
      `Стык ${joint}: ${details}. Проверь основные данные карточки стыка.`,
      systemIndexSettings,
    )]
  })
}

function formatMissingRequiredWeldFields({
  materialGroup,
  connectionType,
  weldingMethod,
}: {
  materialGroup: boolean
  connectionType: boolean
  weldingMethod: boolean
}) {
  const mask = Number(materialGroup) | (Number(connectionType) << 1) | (Number(weldingMethod) << 2)
  switch (mask) {
    case 1: return 'не указана группа материалов'
    case 2: return 'не указан тип соединения'
    case 3: return 'не указана группа материалов и не указан тип соединения'
    case 4: return 'не указан способ сварки'
    case 5: return 'не указана группа материалов и не указан способ сварки'
    case 6: return 'не указаны тип соединения и способ сварки'
    case 7: return 'не указаны группа материалов, тип соединения и способ сварки'
    default: return null
  }
}

export function buildLnkResultCompletenessCheckTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  return rows.flatMap((row) => {
    const methodIssues: Array<{ code: string; missing: string[] }> = LNK_METHODS.flatMap((method) => {
      if (!isFinalLnkResultValue(row[method.resultKey])) return []
      const missing: string[] = []
      if (!hasText(row[method.conclusionDateKey])) missing.push('дата контроля')
      if (!hasText(row[method.conclusionKey])) missing.push('заключение')
      return missing.length > 0 ? [{ code: method.code, missing }] : []
    })
    methodIssues.push(...getPreHeatTreatmentControls(row).flatMap((control) => {
      const result = String(control.result ?? '').trim().toLowerCase()
      if (result !== 'годен' && result !== 'ремонт' && result !== 'вырез') return []
      const missing: string[] = []
      if (!hasText(control.conclusionDate)) missing.push('дата контроля')
      if (!hasText(control.conclusionName)) missing.push('заключение')
      return missing.length > 0 ? [{ code: `${control.method} до ТО`, missing }] : []
    }))
    if (methodIssues.length === 0) return []

    const joint = String(row.joint ?? '').trim() || `ID ${row.id}`
    const details = methodIssues.map((issue) => `${issue.code}: ${formatMissingRequiredFields(issue.missing)}`).join('; ')
    const key = methodIssues.map((issue) => `${issue.code}:${issue.missing.join(',')}`).join('|')
    return [createJointChainCheckTask(
      row,
      `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:lnk-result-completeness:${row.id}:${key}`,
      LNK_RESULT_COMPLETENESS_REASON,
      `Стык ${joint}: ${details}. Дозаполни сохраненный результат в отчете ЛНК.`,
      systemIndexSettings,
    )]
  })
}

export function buildPstoResultCompletenessCheckTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  return rows.flatMap((row) => {
    const cycles = buildPstoCycleTimeline(row, getPstoRepeatCycles(row))
    const issues = cycles.flatMap((cycle) => {
      const cycleLabel = cycle.sequence === 1 ? 'основной цикл' : `повторный цикл #${cycle.sequence}`
      const result: Array<{ label: string; missing: string[] }> = []
      if (hasRealPstoResult(cycle.pstoResult)) {
        const missing: string[] = []
        if (!hasText(cycle.pstoDate)) missing.push('дата ПСТО')
        if (!hasText(cycle.heatTreatmentDiagram)) missing.push('диаграмма термообработки')
        if (missing.length > 0) result.push({ label: `${cycleLabel} ПСТО`, missing })
      }
      if (normalizeTvmtResult(cycle.tvmtResult)) {
        const missing: string[] = []
        if (!hasText(cycle.tvmtConclusionDate)) missing.push('дата ТВМТ')
        if (!hasText(cycle.tvmtConclusion)) missing.push('заключение ТВМТ')
        if (missing.length > 0) result.push({ label: `${cycleLabel} ТВМТ`, missing })
      }
      return result
    })
    if (issues.length === 0) return []

    const joint = String(row.joint ?? '').trim() || `ID ${row.id}`
    const details = issues
      .map((issue) => `${issue.label}: ${formatMissingRequiredFields(issue.missing)}`)
      .join('; ')
    const key = issues
      .map((issue) => `${issue.label}:${issue.missing.join(',')}`)
      .join('|')
    return [createJointChainCheckTask(
      row,
      `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:psto-result-completeness:${row.id}:${key}`,
      PSTO_RESULT_COMPLETENESS_REASON,
      `Стык ${joint}: ${details}. Дозаполни результат в отчете ПСТО.`,
      systemIndexSettings,
    )]
  })
}

export function buildControlHistoryCheckTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  return rows.flatMap((row) => {
    const issues = getControlAvailabilityReportHistoryIssues(row)
    if (issues.length === 0) return []

    const joint = String(row.joint ?? '').trim() || `ID ${row.id}`
    return [createJointChainCheckTask(
      row,
      `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:control-history:${row.id}:${issues.map((issue) => issue.code).join('|')}`,
      CONTROL_HISTORY_REASON,
      `Стык ${joint}: назначение контроля выключено, но сохранена история: ${issues.map((issue) => issue.message).join(' ')}`,
      systemIndexSettings,
    )]
  })
}

export function buildWelderStampCompatibilityCheckTasks(
  rows: WeldRow[],
  welderStampRecords: WelderStampRecord[],
  welderStampSuspensions: WelderStampSuspensionRecord[] = [],
  dataListSettings?: DataListSettings,
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  const tasks: RepeatedJointCheckTask[] = []
  for (const row of rows) {
    const issues = getOfficialStampCompatibilityIssues(row, welderStampRecords, {
      archiveValidationMode: 'audit',
      materialGroups: dataListSettings?.materialGroups,
      saveCheckSettings: WELDER_STAMP_AUDIT_SAVE_CHECK_SETTINGS,
      suspensions: welderStampSuspensions,
      weldingTypes: dataListSettings?.weldingTypes,
    })
    if (issues.length === 0) continue

    const joint = String(row.joint ?? '').trim() || '-'
    const hasSuspensionIssue = issues.some((issue) => issue.reason === 'suspended')
    const details = [
      `Стык ${joint}: ${issues.map(formatOfficialStampCompatibilityIssue).join(' ')}`,
      hasSuspensionIssue
        ? 'Проверь дату сварки или период отстранения в истории отстранений.'
        : 'Проверь официальное клеймо, НАКС, ДЛС, способ сварки, группу материалов, D1/D2, T1/T2, дату сварки или срок действия допуска в реестре клейм.',
    ].join(' ')

    tasks.push(
      createJointChainCheckTask(
        row,
        `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:welder-stamp:${row.id}:${issues
          .map((issue) => `${issue.fieldKey}:${issue.stamp}:${issue.method}:${issue.reason}`)
          .join('|')}`,
        'проверить клеймо',
        details,
        systemIndexSettings,
      ),
    )
  }

  return tasks
}

export function buildIncompleteWelderStampGroupTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
): RepeatedJointCheckTask[] {
  const tasks: RepeatedJointCheckTask[] = []
  const allStampFields = WELD_STAMP_COMPLETION_GROUPS.flatMap((group) => group.fields)
  for (const row of rows) {
    const filledStampFields = allStampFields.filter((fieldKey) => hasText(row[fieldKey]))
    const hasWeldDate = hasText(row.weldDate)
    const joint = String(row.joint ?? '').trim() || '-'
    const officialityText = isUnofficialJoint(row) ? ' (неофициальный)' : ''

    if (!hasWeldDate && filledStampFields.length > 0) {
      const filledText = filledStampFields.map(formatWeldStampCompletionFieldLabel).join(', ')
      tasks.push(
        createJointChainCheckTask(
          row,
          `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:weld-date-required-by-stamps:${row.id}`,
          'дозаполнить дату сварки',
          `Стык ${joint}${officialityText}: заполнены клейма (${filledText}), но дата сварки не заполнена. Если клейма уже указаны, нужно дозаполнить дату сварки.`,
          systemIndexSettings,
        ),
      )
      continue
    }

    if (hasWeldDate && filledStampFields.length === 0) {
      const weldDateText = formatDisplayDate(row.weldDate) || '-'
      const group = WELD_STAMP_COMPLETION_GROUPS[0]
      tasks.push(
        createJointChainCheckTask(
          row,
          `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:weld-stamp-completion-empty-${group.index}:${row.id}`,
          group.reason,
          `Стык ${joint}${officialityText}: дата сварки ${weldDateText} заполнена, но клейма не заполнены. Нужно дозаполнить группу клейма_${group.index}.`,
          systemIndexSettings,
        ),
      )
      continue
    }

    for (const group of WELD_STAMP_COMPLETION_GROUPS) {
      const filledFields = group.fields.filter((fieldKey) => hasText(row[fieldKey]))
      const emptyRequiredFirstGroup = hasWeldDate && group.index === 1 && filledFields.length === 0
      if ((!emptyRequiredFirstGroup && filledFields.length === 0) || filledFields.length === group.fields.length) continue

      const missingFields = group.fields.filter((fieldKey) => !hasText(row[fieldKey]))
      const filledText = filledFields.map(formatWeldStampCompletionFieldLabel).join(', ')
      const missingText = missingFields.map(formatWeldStampCompletionFieldLabel).join(', ')
      const details = emptyRequiredFirstGroup
        ? `Стык ${joint}${officialityText}: дата сварки заполнена, но группа клейма_1 пустая. Нужно указать хотя бы корневое клеймо и дозаполнить группу.`
        : `Стык ${joint}${officialityText}: в группе клейма_${group.index} заполнено ${filledText}, но не заполнено ${missingText}. Если в группе заполнено хотя бы одно клеймо, нужно дозаполнить остальные поля этой группы.`
      tasks.push(
        createJointChainCheckTask(
          row,
          `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:weld-stamp-completion-${group.index}:${row.id}:${missingFields.join(',')}`,
          group.reason,
          details,
          systemIndexSettings,
        ),
      )
    }
  }
  return tasks
}

export function isIncompleteWeldStampGroupReason(reason?: string) {
  return reason === 'дозаполнить клейма_1' || reason === 'дозаполнить клейма_2' || reason === 'дозаполнить дату сварки'
}

export function createJointChainCheckTask(
  row: WeldRow,
  key: string,
  reason: string,
  details?: string,
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
  rootCauseActions: WorkflowRootCauseAction[] = [],
): RepeatedJointCheckTask {
  const sourceJoint = String(row.joint ?? '').trim()
  const baseJoint = parseJointChainName(sourceJoint, systemIndexSettings).base || sourceJoint
  return {
    kind: 'check',
    key: `check-chain:${key}:${reason}:${row.id}`,
    row,
    sourceRow: row,
    sourceJoint,
    targetJoint: sourceJoint,
    baseJoint,
    suffix: 'R',
    reason,
    details,
    ...(rootCauseActions.length > 0 ? { rootCauseActions } : {}),
  }
}

function formatWeldStampCompletionFieldLabel(fieldKey: WeldFieldKey) {
  return FIELD_BY_KEY.get(fieldKey)?.label ?? fieldKey
}

function groupIssuesByRowAndReason<T extends { kind: string; reason: string; message: string; row: { id?: number }; methodCode?: string }>(
  issues: T[],
) {
  const groups = new Map<string, {
    issueKeys: string[]
    messages: string[]
    reason: string
    row: WeldRow
    issues: T[]
  }>()
  for (const issue of issues) {
    const row = issue.row as WeldRow
    const groupKey = `${row.id}:${issue.reason}`
    const group = groups.get(groupKey) ?? { issueKeys: [], messages: [], reason: issue.reason, row, issues: [] }
    group.issueKeys.push(`${issue.kind}:${issue.methodCode ?? ''}`)
    group.messages.push(issue.message)
    group.issues.push(issue)
    groups.set(groupKey, group)
  }
  return [...groups.values()]
}

function hasRealPstoResult(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
}

function getPstoRepeatCycles(row: WeldRow) {
  return ((row as WeldRow & { pstoRepeatCycles?: PstoRepeatCycleRecord[] }).pstoRepeatCycles ?? [])
}

function formatMissingRequiredFields(fields: string[]) {
  return `${fields.length === 1 ? 'не заполнено' : 'не заполнены'} ${fields.join(' и ')}`
}
