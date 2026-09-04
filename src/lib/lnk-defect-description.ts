import { getPreHeatTreatmentControl, type LnkControlStage } from '@/lib/lnk-control-stage'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { isCancelledControlValue } from '@/lib/report-value-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export const LNK_NO_DEFECTS_DESCRIPTION = 'ДНО'

export type LnkDefectDescriptionDescriptor = {
  fieldKey: WeldFieldKey
  method: (typeof LNK_METHODS)[number]
  stage: LnkControlStage
}

export type LnkDefectDescriptionUpdate = {
  rowId: number
  expectedVersion: string
  methodCode: string
  stage: LnkControlStage
  value: string | null
}

const SIMPLE_DEFECT_METHODS = LNK_METHODS.filter((method) => method.code !== 'РК')

const SIMPLE_LNK_DEFECT_DESCRIPTION_FIELDS = SIMPLE_DEFECT_METHODS.flatMap((method) => [
  { fieldKey: method.defectDescriptionKey, method, stage: 'primary' as const },
  { fieldKey: method.preDefectDescriptionKey, method, stage: 'beforeHeatTreatment' as const },
]) satisfies readonly LnkDefectDescriptionDescriptor[]

const DESCRIPTOR_BY_FIELD_KEY = new Map<WeldFieldKey, LnkDefectDescriptionDescriptor>(
  SIMPLE_LNK_DEFECT_DESCRIPTION_FIELDS.map((descriptor) => [descriptor.fieldKey, descriptor]),
)

export function getLnkDefectDescriptionDescriptor(fieldKey: WeldFieldKey) {
  return DESCRIPTOR_BY_FIELD_KEY.get(fieldKey)
}

export function isRejectedLnkDefectResult(value: unknown) {
  const result = normalizeResult(value)
  return result === 'ремонт' || result === 'вырез'
}

export function transitionLnkDefectDescription({
  currentResult,
  nextResult,
  currentDescription,
}: {
  currentResult: unknown
  nextResult: unknown
  currentDescription: unknown
}) {
  const current = normalizeResult(currentResult)
  const next = normalizeResult(nextResult)
  const description = normalizeDescription(currentDescription)

  if (next === 'годен') return LNK_NO_DEFECTS_DESCRIPTION
  if (next === 'годен (отменен)' || next === 'отменен') return description
  if (next === 'ремонт' || next === 'вырез') {
    return current === 'ремонт' || current === 'вырез' ? description : null
  }
  return null
}

export function getLnkDefectDescriptionResult(
  row: WeldInput,
  descriptor: LnkDefectDescriptionDescriptor,
) {
  if (descriptor.stage === 'primary') return row[descriptor.method.resultKey]
  return getPreHeatTreatmentControl(row, descriptor.method.code)?.result
}

export function getLnkDefectDescriptionValue(
  row: WeldInput,
  descriptor: LnkDefectDescriptionDescriptor,
) {
  if (descriptor.stage === 'primary') return row[descriptor.fieldKey]
  return getPreHeatTreatmentControl(row, descriptor.method.code)?.defectDescription
}

export function getLnkDefectDescriptionDisplayValue(
  row: WeldInput,
  descriptor: LnkDefectDescriptionDescriptor,
) {
  const value = normalizeDescription(getLnkDefectDescriptionValue(row, descriptor))
  if (isCancelledControlValue(row[descriptor.method.enabledKey])) return value
  const result = normalizeResult(getLnkDefectDescriptionResult(row, descriptor))
  if (result === 'годен' || result === 'годен (отменен)') {
    return value ?? LNK_NO_DEFECTS_DESCRIPTION
  }
  if (result === 'ремонт' || result === 'вырез') return value
  return null
}

export function getLnkDefectDescriptionEditBlockReason(
  row: WeldInput,
  descriptor: LnkDefectDescriptionDescriptor,
) {
  if (isCancelledControlValue(row[descriptor.method.enabledKey])) {
    return 'Контроль отменен. Описание сохранено как история и доступно только для просмотра.'
  }
  const result = normalizeResult(getLnkDefectDescriptionResult(row, descriptor))
  if (result === 'ремонт' || result === 'вырез') return ''
  if (result === 'годен' || result === 'годен (отменен)') {
    return `При результате «годен» значение устанавливается автоматически: ${LNK_NO_DEFECTS_DESCRIPTION}.`
  }
  return 'Описание дефектов станет доступно после результата «ремонт» или «вырез».'
}

export function isLnkDefectDescriptionEditable(
  row: WeldInput,
  descriptor: LnkDefectDescriptionDescriptor,
) {
  return !getLnkDefectDescriptionEditBlockReason(row, descriptor)
}

function normalizeResult(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU')
}

function normalizeDescription(value: unknown) {
  const description = String(value ?? '').trim()
  return description || null
}
