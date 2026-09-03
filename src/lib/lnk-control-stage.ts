import { isControlEnabledValue } from '@/lib/control-availability-values'
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

export function requiresPreHeatTreatmentLnk(row: WeldInput & { preHeatTreatmentLnkExempt?: boolean }) {
  if (row.preHeatTreatmentLnkExempt === true) return false
  return requiresHeatTreatmentStagedLnk(row)
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
  if (!requiresPreHeatTreatmentLnk(row)) return []

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
  if (!requiresPreHeatTreatmentLnk(row)) return null
  const requiredMethods = PRE_HEAT_TREATMENT_LNK_METHODS.filter((method) =>
    isControlEnabledValue(row[method.enabledKey]),
  )
  if (requiredMethods.length === 0) return null
  if (getRejectedPreHeatTreatmentControls(row).length > 0) return 'не годен' as const

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
    return `НК до ТО имеет негодный результат: ${rejected.join(', ')}. Сначала обработайте повторный стык.`
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
  if (!isControlEnabledValue(row.pstoRequired) || !requiresPreHeatTreatmentLnk(row)) return empty
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
  const normalizedMethod = normalizeMethodCode(methodCode)
  if (!isPreHeatTreatmentLnkMethodCode(normalizedMethod)) return ''
  if (!requiresHeatTreatmentStagedLnk(row)) return ''

  if (requiresPreHeatTreatmentLnk(row)) {
    const incompleteMethods = PRE_HEAT_TREATMENT_LNK_METHODS.flatMap((method) => {
      if (!isControlEnabledValue(row[method.enabledKey])) return []
      const control = getPreHeatTreatmentControl(row, method.code)
      return normalizeResult(control?.result) === 'годен' ? [] : [method.code]
    })
    if (incompleteMethods.length > 0) {
      return `Сначала завершите НК до ТО: ${incompleteMethods.join(', ')}.`
    }
  }

  const pstoState = getPstoTvmtWorkflowState(row)
  if (pstoState !== 'complete') {
    return `Контроль ${normalizedMethod} после ТО недоступен: ${getPstoTvmtWorkflowLabel(pstoState)}.`
  }
  return ''
}

export function isPrimaryLnkStageReady(row: WeldInput, methodCode: string) {
  return !getPrimaryLnkStageBlockReason(row, methodCode)
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
