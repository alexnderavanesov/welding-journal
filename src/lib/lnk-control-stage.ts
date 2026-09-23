import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import { hasHistoricalPreHeatTreatmentExemption, isPreHeatTreatmentStageEnabled, type PreHeatTreatmentPolicyRow } from '@/lib/pre-heat-treatment-policy'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import {
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
  requiresPostHeatTreatmentCompletion,
} from '@/lib/tvmt-cycle'

export const LNK_CONTROL_STAGES = ['primary', 'beforeHeatTreatment'] as const
export type LnkControlStage = (typeof LNK_CONTROL_STAGES)[number]

export const PRIMARY_LNK_CONTROL_STAGE = 'primary' satisfies LnkControlStage
export const PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE = 'beforeHeatTreatment' satisfies LnkControlStage

export const LNK_CONTROL_STAGE_LABELS: Record<LnkControlStage, string> = {
  primary: 'Основной',
  beforeHeatTreatment: 'До ТО',
}

export const PRE_HEAT_TREATMENT_LNK_METHODS = [
  { code: 'ВИК', enabledKey: 'hasVik' },
  { code: 'РК', enabledKey: 'hasRk' },
  { code: 'УЗК', enabledKey: 'hasUzk' },
  { code: 'ПВК', enabledKey: 'hasPvk' },
] as const satisfies ReadonlyArray<{ code: string; enabledKey: WeldFieldKey }>

export type PreHeatTreatmentLnkMethodCode = (typeof PRE_HEAT_TREATMENT_LNK_METHODS)[number]['code']

export type StagedLnkControlSnapshot = {
  stage: LnkControlStage
  methodCode: string
  requestName: string
  requestDate: string
  result: string
  conclusionDate: string
  conclusionName: string
}

export type PreHeatTreatmentControlRecord = {
  id: number
  weldJointId: number
  method: string
  requestName?: string | null
  requestDate?: string | null
  result?: string | null
  conclusionDate?: string | null
  conclusionName?: string | null
  defectDescription?: string | null
  rkExposureConfirmedDiameter?: number | null
  createdAt?: Date | string
  updatedAt?: Date | string
}

export type RejectedPreHeatTreatmentControl = {
  control: PreHeatTreatmentControlRecord
  methodCode: PreHeatTreatmentLnkMethodCode
  result: 'ремонт' | 'вырез'
}

export type PrimaryLnkStageDebt = {
  missingPreHeatTreatmentControls: Array<{
    methodCode: PreHeatTreatmentLnkMethodCode
    nextAction: 'request' | 'result'
  }>
  pstoState: ReturnType<typeof getPstoTvmtWorkflowState>
  reason: string
}

export type PrimaryLnkStageAccess = {
  status: 'ready' | 'allowed-with-warning' | 'blocked'
  reason: string
  debt: PrimaryLnkStageDebt | null
}

type PrimaryLnkStageAccessSettings = Pick<
  ControlProcessSettings,
  'preHeatTreatmentLnkEnabled' | 'allowPrimaryLnkBeforePreviousStagesComplete'
>

const STRICT_PRIMARY_LNK_STAGE_SETTINGS: PrimaryLnkStageAccessSettings = {
  preHeatTreatmentLnkEnabled: true,
  allowPrimaryLnkBeforePreviousStagesComplete: false,
}

const PRE_HEAT_TREATMENT_METHOD_CODES = new Set<string>(
  PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => method.code),
)

export function isPreHeatTreatmentLnkMethodCode(value: unknown): value is PreHeatTreatmentLnkMethodCode {
  return PRE_HEAT_TREATMENT_METHOD_CODES.has(normalizeMethodCode(value))
}

export function getRequiredLnkControlStages(
  row: WeldInput,
  methodCode: string,
): LnkControlStage[] {
  const normalizedMethod = normalizeMethodCode(methodCode)
  const method = LNK_METHODS.find((candidate) => candidate.code === normalizedMethod)
  if (!method || !isControlEnabledValue(row[method.enabledKey])) return []

  if (
    requiresPreHeatTreatmentLnk(row) &&
    isPreHeatTreatmentLnkMethodCode(normalizedMethod)
  ) {
    return [PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE, PRIMARY_LNK_CONTROL_STAGE]
  }

  return [PRIMARY_LNK_CONTROL_STAGE]
}

export function requiresPreHeatTreatmentLnk(row: PreHeatTreatmentPolicyRow) {
  return isPreHeatTreatmentLnkAvailable(row) && !hasHistoricalPreHeatTreatmentExemption(row)
}

export function isPreHeatTreatmentLnkAvailable(row: WeldInput) {
  return isPreHeatTreatmentStageEnabled(row) && requiresHeatTreatmentStagedLnk(row)
}

export function requiresHeatTreatmentStagedLnk(row: WeldInput) {
  return isControlEnabledValue(row.pstoRequired) || requiresPostHeatTreatmentCompletion(row)
}

export function getPreHeatTreatmentControls(row: WeldInput) {
  return ((row as WeldInput & {
    preHeatTreatmentControls?: PreHeatTreatmentControlRecord[]
  }).preHeatTreatmentControls ?? [])
}

export function getPreHeatTreatmentControl(
  row: WeldInput,
  methodCode: PreHeatTreatmentLnkMethodCode,
) {
  return getPreHeatTreatmentControls(row).find(
    (control) => normalizeMethodCode(control.method) === methodCode,
  )
}

export function getRejectedPreHeatTreatmentControls(
  row: WeldInput,
): RejectedPreHeatTreatmentControl[] {
  if (!isPreHeatTreatmentLnkAvailable(row)) return []

  return getPreHeatTreatmentControls(row).flatMap((control) => {
    const methodCode = normalizeMethodCode(control.method)
    const result = normalizeResult(control.result)
    if (!isPreHeatTreatmentLnkMethodCode(methodCode)) return []
    const method = PRE_HEAT_TREATMENT_LNK_METHODS.find((candidate) => candidate.code === methodCode)
    return method &&
      isControlEnabledValue(row[method.enabledKey]) &&
      (result === 'ремонт' || result === 'вырез')
      ? [{ control, methodCode, result } satisfies RejectedPreHeatTreatmentControl]
      : []
  })
}

export function isPreHeatTreatmentMethodNoNeed(
  row: WeldInput,
  methodCode: PreHeatTreatmentLnkMethodCode,
) {
  if (getRejectedPreHeatTreatmentControls(row).length === 0) return false
  const result = normalizeResult(getPreHeatTreatmentControl(row, methodCode)?.result)
  return result !== 'годен' && result !== 'ремонт' && result !== 'вырез'
}

export function getPreHeatTreatmentPendingFinalStatus(row: WeldInput) {
  if (getRejectedPreHeatTreatmentControls(row).length > 0) return 'не годен' as const
  if (!requiresPreHeatTreatmentLnk(row)) return null
  const requiredMethods = PRE_HEAT_TREATMENT_LNK_METHODS.filter((method) =>
    isControlEnabledValue(row[method.enabledKey]),
  )
  if (requiredMethods.length === 0) return null

  let hasMissingRequest = false
  let hasPendingResult = false
  for (const method of requiredMethods) {
    const control = getPreHeatTreatmentControl(row, method.code)
    if (!normalizeValue(control?.requestName)) {
      hasMissingRequest = true
      continue
    }
    if (normalizeResult(control?.result) !== 'годен') hasPendingResult = true
  }
  if (hasMissingRequest) return 'ожидает заявку' as const
  if (hasPendingResult) return 'ожидает НК' as const
  return null
}

export function getPrimaryPstoStartBlockReason(row: WeldInput) {
  const { rejected, missingRequests, pendingResults } = getPrimaryPstoStartPrerequisites(row)
  if (rejected.length > 0) {
    return `ПСТО и ТВМТ для этого стыка не требуются: НК до ТО имеет негодный результат: ${rejected.join(', ')}. ` +
      'Продолжите цепочку новым официальным или R/W-стыком.'
  }
  if (missingRequests.length > 0) {
    return `Сначала создайте заявки НК до ТО: ${missingRequests.join(', ')}.`
  }
  if (pendingResults.length > 0) {
    return `Сначала внесите годные результаты НК до ТО: ${pendingResults.join(', ')}.`
  }
  return ''
}

export function getPrimaryPstoStartStatusLabel(row: WeldInput) {
  const { rejected, missingRequests, pendingResults } = getPrimaryPstoStartPrerequisites(row)
  if (rejected.length > 0) return `НК до ТО не годен: ${rejected.join(', ')}`
  if (missingRequests.length > 0) return `ожидает заявку НК до ТО: ${missingRequests.join(', ')}`
  if (pendingResults.length > 0) return `ожидает НК до ТО: ${pendingResults.join(', ')}`
  return ''
}

export function isPrimaryPstoReady(row: WeldInput) {
  return !getPrimaryPstoStartBlockReason(row)
}

function getPrimaryPstoStartPrerequisites(row: WeldInput) {
  const empty = { rejected: [] as string[], missingRequests: [] as string[], pendingResults: [] as string[] }
  if (!isPreHeatTreatmentStageEnabled(row)) return empty
  empty.rejected = getRejectedPreHeatTreatmentControls(row).map(({ methodCode }) => methodCode)
  if (empty.rejected.length > 0 || !isControlEnabledValue(row.pstoRequired) || !requiresPreHeatTreatmentLnk(row)) return empty
  const requiredMethods = PRE_HEAT_TREATMENT_LNK_METHODS.filter((method) =>
    isControlEnabledValue(row[method.enabledKey]),
  )
  if (requiredMethods.length === 0) return empty

  for (const method of requiredMethods) {
    const control = getPreHeatTreatmentControl(row, method.code)
    const result = normalizeResult(control?.result)
    if (result === 'ремонт' || result === 'вырез') {
      empty.rejected.push(method.code)
    } else if (!normalizeValue(control?.requestName)) {
      empty.missingRequests.push(method.code)
    } else if (result !== 'годен') {
      empty.pendingResults.push(method.code)
    }
  }
  return empty
}

export function getPrimaryLnkStageBlockReason(
  row: WeldInput,
  methodCode: string,
) {
  const access = getPrimaryLnkStageAccess(row, methodCode)
  return access.status === 'blocked' ? access.reason : ''
}

export function getPrimaryLnkStageAccess(
  row: WeldInput,
  methodCode: string,
  settings?: PrimaryLnkStageAccessSettings,
): PrimaryLnkStageAccess {
  const effectiveSettings = settings ?? {
    ...STRICT_PRIMARY_LNK_STAGE_SETTINGS,
    preHeatTreatmentLnkEnabled: isPreHeatTreatmentStageEnabled(row),
  }
  if (effectiveSettings.preHeatTreatmentLnkEnabled !== isPreHeatTreatmentStageEnabled(row)) {
    row = { ...row, preHeatTreatmentLnkEnabled: effectiveSettings.preHeatTreatmentLnkEnabled } as WeldInput
  }
  const normalizedMethod = normalizeMethodCode(methodCode)
  if (
    !isPreHeatTreatmentLnkMethodCode(normalizedMethod) ||
    !requiresHeatTreatmentStagedLnk(row)
  ) {
    return { status: 'ready', reason: '', debt: null }
  }

  const requestAccess = getPrimaryLnkRequestAccess(row, normalizedMethod)
  if (requestAccess.status === 'blocked') return requestAccess

  const debt = getPrimaryLnkStageDebt(row, normalizedMethod)
  if (!debt) return { status: 'ready', reason: '', debt: null }

  const permissive = effectiveSettings.preHeatTreatmentLnkEnabled &&
    effectiveSettings.allowPrimaryLnkBeforePreviousStagesComplete
  return {
    status: permissive ? 'allowed-with-warning' : 'blocked',
    reason: debt.reason,
    debt,
  }
}

export function getPrimaryLnkStageDebt(
  row: WeldInput,
  methodCode: string,
): PrimaryLnkStageDebt | null {
  const normalizedMethod = normalizeMethodCode(methodCode)
  if (
    !isPreHeatTreatmentLnkMethodCode(normalizedMethod) ||
    !requiresHeatTreatmentStagedLnk(row)
  ) {
    return null
  }
  if (getRejectedPreHeatTreatmentControls(row).length > 0) return null

  const missingPreHeatTreatmentControls = requiresPreHeatTreatmentLnk(row)
    ? PRE_HEAT_TREATMENT_LNK_METHODS.flatMap((method) => {
        if (!isControlEnabledValue(row[method.enabledKey])) return []
        const control = getPreHeatTreatmentControl(row, method.code)
        if (normalizeResult(control?.result) === 'годен') return []
        return [{
          methodCode: method.code,
          nextAction: normalizeValue(control?.requestName) ? 'result' as const : 'request' as const,
        }]
      })
    : []
  const pstoState = getPstoTvmtWorkflowState(row)
  if (missingPreHeatTreatmentControls.length === 0 && pstoState === 'complete') return null

  const reason = missingPreHeatTreatmentControls.length > 0
    ? `Сначала завершите НК до ТО: ${missingPreHeatTreatmentControls.map(({ methodCode: code }) => code).join(', ')}.`
    : `Контроль ${normalizedMethod} после ТО недоступен: ${getPstoTvmtWorkflowLabel(pstoState)}.`
  return { missingPreHeatTreatmentControls, pstoState, reason }
}

export function isPrimaryLnkStageReady(
  row: WeldInput,
  methodCode: string,
  settings?: PrimaryLnkStageAccessSettings,
) {
  return getPrimaryLnkStageAccess(row, methodCode, settings).status === 'ready'
}

// A request schedules control; only an actual result requires completed stages.
// Rejected pre-TO control still excludes this joint from further primary NDT.
export function getPrimaryLnkRequestAccess(
  row: WeldInput,
  methodCode: string,
  settings?: PrimaryLnkStageAccessSettings,
): { status: 'ready' | 'blocked'; reason: string; debt: null } {
  if (settings && settings.preHeatTreatmentLnkEnabled !== isPreHeatTreatmentStageEnabled(row)) {
    row = { ...row, preHeatTreatmentLnkEnabled: settings.preHeatTreatmentLnkEnabled } as WeldInput
  }
  const rejected = isPreHeatTreatmentLnkMethodCode(methodCode)
    ? getRejectedPreHeatTreatmentControls(row).map(({ methodCode: code }) => code)
    : []
  return rejected.length > 0
    ? { status: 'blocked', reason: `Основной этап НК для этого стыка не требуется: НК до ТО имеет негодный результат: ${rejected.join(', ')}.`, debt: null }
    : { status: 'ready', reason: '', debt: null }
}

export function canCreatePrimaryLnkRequest(
  row: WeldInput,
  methodCode: string,
  settings?: PrimaryLnkStageAccessSettings,
) {
  return getPrimaryLnkRequestAccess(row, methodCode, settings).status !== 'blocked'
}

export function hasPrimaryLnkResultTrace(row: WeldInput, methodCode: string) {
  const normalizedMethod = normalizeMethodCode(methodCode)
  const method = LNK_METHODS.find((candidate) => candidate.code === normalizedMethod)
  if (!method) return false
  const values = [
    row[method.conclusionDateKey],
    row[method.conclusionKey],
    row[method.defectDescriptionKey],
  ]
  if (isFinalResult(row[method.resultKey])) values.push(row[method.resultKey])
  if (normalizedMethod === 'РК') values.push(row.rkExposureConfirmedDiameter)
  return values.some((value) => normalizeValue(value).length > 0)
}

export function buildPrimaryLnkControlSnapshot(
  row: WeldInput,
  methodCode: string,
): StagedLnkControlSnapshot | null {
  const normalizedMethod = normalizeMethodCode(methodCode)
  const method = LNK_METHODS.find((candidate) => candidate.code === normalizedMethod)
  if (!method) return null

  return {
    stage: PRIMARY_LNK_CONTROL_STAGE,
    methodCode: method.code,
    requestName: normalizeValue(row[method.requestKey]),
    requestDate: normalizeValue(row[method.requestDateKey]),
    result: normalizeValue(row[method.resultKey]),
    conclusionDate: normalizeValue(row[method.conclusionDateKey]),
    conclusionName: normalizeValue(row[method.conclusionKey]),
  }
}

export function buildPreHeatTreatmentControlSnapshot(
  record: PreHeatTreatmentControlRecord,
): StagedLnkControlSnapshot | null {
  const methodCode = normalizeMethodCode(record.method)
  if (!isPreHeatTreatmentLnkMethodCode(methodCode)) return null

  return {
    stage: PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE,
    methodCode,
    requestName: normalizeValue(record.requestName),
    requestDate: normalizeValue(record.requestDate),
    result: normalizeValue(record.result),
    conclusionDate: normalizeValue(record.conclusionDate),
    conclusionName: normalizeValue(record.conclusionName),
  }
}

function normalizeMethodCode(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('ru-RU')
}

function normalizeValue(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeResult(value: unknown) {
  return normalizeValue(value).toLocaleLowerCase('ru-RU')
}

function isFinalResult(value: unknown) {
  const result = normalizeResult(value)
  return result === 'годен' || result === 'ремонт' || result === 'вырез'
}
