import type { WeldFieldKey, WeldInput } from './weld-field-definitions'
import { normalizeJointChainPart, parseJointChainName } from './joint-chain'
import { getRejectedDuplicateControls, hasRejectedDuplicateControl } from '@/lib/duplicate-control-utils'
import { isControlEnabledValue } from '@/lib/control-availability-values'

export const RESULT_STATUS_OPTIONS = ['годен', 'ремонт', 'вырез', 'ожидает', 'ожидает НК', 'ожидает заявку'] as const
export const PSTO_RESULT_STATUS_OPTIONS = ['проведено'] as const
export const FINAL_STATUS_OPTIONS = ['годен', 'не годен', 'не годен по дублю', 'ожидает сварку', 'ожидает ремонт', 'ожидает заявку', 'ожидает НК', 'ошибка'] as const
export const RESULT_FIELD_KEYS = new Set<WeldFieldKey>([
  'vikResult',
  'rkResult',
  'uzkResult',
  'pvkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'pstoResult',
  'mkkResult',
  'finalStatus',
])

export const CONTROL_RESULT_PAIRS = [
  { code: 'ВИК', enabledKey: 'hasVik', resultKey: 'vikResult' },
  { code: 'РК', enabledKey: 'hasRk', resultKey: 'rkResult' },
  { code: 'УЗК', enabledKey: 'hasUzk', resultKey: 'uzkResult' },
  { code: 'ПВК', enabledKey: 'hasPvk', resultKey: 'pvkResult' },
  { code: 'ТВМТ', enabledKey: 'hasTvmt', resultKey: 'tvmtResult' },
  { code: 'РФА', enabledKey: 'hasRfa', resultKey: 'rfaResult' },
  { code: 'СТЛС', enabledKey: 'hasStls', resultKey: 'stlsResult' },
  { code: 'МКК', enabledKey: 'hasMkk', resultKey: 'mkkResult' },
] as const satisfies ReadonlyArray<{ code: string; enabledKey: WeldFieldKey; resultKey: WeldFieldKey }>

const CONTROL_STATE_PAIRS = [
  { enabledKey: 'hasVik', requestKey: 'vikRequest', resultKey: 'vikResult' },
  { enabledKey: 'hasRk', requestKey: 'rkRequest', resultKey: 'rkResult' },
  { enabledKey: 'hasUzk', requestKey: 'uzkRequest', resultKey: 'uzkResult' },
  { enabledKey: 'hasPvk', requestKey: 'pvkRequest', resultKey: 'pvkResult' },
  { enabledKey: 'hasTvmt', requestKey: 'tvmtRequest', resultKey: 'tvmtResult' },
  { enabledKey: 'hasRfa', requestKey: 'rfaRequest', resultKey: 'rfaResult' },
  { enabledKey: 'hasStls', requestKey: 'stlsRequest', resultKey: 'stlsResult' },
  { enabledKey: 'hasMkk', requestKey: 'mkkRequest', resultKey: 'mkkResult' },
] as const satisfies ReadonlyArray<{ enabledKey: WeldFieldKey; requestKey: WeldFieldKey; resultKey: WeldFieldKey }>

export function calculateFinalStatus(record: WeldInput) {
  const hasResultWithoutEnabledControl = getInactiveControlResultErrors(record).length > 0
  if (hasResultWithoutEnabledControl) return 'ошибка'

  if (hasRejectedDuplicateControl(record)) return 'не годен по дублю'

  if (!hasText(record.weldDate)) return getPendingWeldFinalStatus(record)

  let hasActiveControl = false
  let hasMissingRequest = false
  let hasPendingResult = false
  let hasOnlyGoodResults = true

  for (const { enabledKey, requestKey, resultKey } of CONTROL_STATE_PAIRS) {
    if (!isEnabledControl(record[enabledKey])) continue
    hasActiveControl = true

    const result = normalizeResultStatus(record[resultKey])
    if (result === 'вырез' || result === 'ремонт') return 'не годен'
    if (result === 'годен') continue

    hasOnlyGoodResults = false
    if (hasText(record[requestKey])) {
      hasPendingResult = true
    } else {
      hasMissingRequest = true
    }
  }

  if (!hasActiveControl) return 'ожидает заявку'
  if (hasOnlyGoodResults) return 'годен'
  if (hasPendingResult) return 'ожидает НК'
  if (hasMissingRequest) return 'ожидает заявку'
  return 'ожидает НК'
}

export function calculateFinalStatusInRows(record: WeldInput, rows: readonly WeldInput[]) {
  const status = calculateFinalStatus(record)
  if (status === 'ожидает сварку' && isOfficialSameNameRepairAfterUnofficialRejected(record, rows)) {
    return 'ожидает ремонт'
  }
  return status
}

export function getFinalStatusErrorReason(record: WeldInput) {
  const inactiveControlResults = getInactiveControlResultErrors(record)
  if (inactiveControlResults.length === 0) return null

  const details = inactiveControlResults.map(({ code, enabledValue, resultValue }) => {
    const enabledText = hasText(enabledValue) ? `«${String(enabledValue).trim()}»` : '«пусто»'
    return `${code}: результат «${String(resultValue).trim()}» заполнен, но назначение ${code} = ${enabledText}`
  })

  return `${details.join('; ')}. В назначении контроля выберите «да», «отменен» или «дополнительный», либо очистите результат.`
}

export function normalizeResultStatus(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'да') return 'годен'
  if (text === 'проведено') return 'годен'
  if (text === 'годен (отменен)') return 'годен'
  if (text === 'проведено (отменен)') return 'годен'
  const option = RESULT_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? null
}

export function normalizeFinalStatus(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'ожидает') return 'ожидает НК'
  if (text === 'не годен по дублю') return 'не годен'
  const option = FINAL_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? null
}

export function hasRejectedControlResult(record: WeldInput) {
  if (hasRejectedDuplicateControl(record)) return true
  return CONTROL_RESULT_PAIRS.some(({ resultKey }) => {
    const result = normalizeResultStatus(record[resultKey])
    return result === 'ремонт' || result === 'вырез'
  })
}

export function getRejectedDuplicateControlLabel(record: WeldInput) {
  const control = getRejectedDuplicateControls(record)[0]
  return control ? `${control.method} (дубль) - ${control.result}` : ''
}

export function formatFinalStatusDisplay(record: WeldInput, value: unknown) {
  const text = String(value ?? '').trim()
  if (text.toLowerCase() !== 'не годен по дублю') return text

  const methods = Array.from(
    new Set(
      getRejectedDuplicateControls(record)
        .map((control) => String(control.method ?? '').trim())
        .filter(Boolean),
    ),
  )

  return methods.length > 0 ? `${text} (${methods.join(', ')})` : text
}

function getPendingWeldFinalStatus(record: WeldInput) {
  const joint = String(record.joint ?? '').replace(/\s+/g, '').toUpperCase()
  const hasCoilSegment = /Y\d+/.test(joint)
  const hasRepairSegment = /[RW]\d+/.test(joint)
  return hasRepairSegment && !hasCoilSegment ? 'ожидает ремонт' : 'ожидает сварку'
}

function isOfficialSameNameRepairAfterUnofficialRejected(record: WeldInput, rows: readonly WeldInput[]) {
  if (hasText(record.weldDate) || isUnofficialStatus(record.status)) return false
  const joint = String(record.joint ?? '').trim()
  if (!joint) return false

  const parsed = parseJointChainName(joint)
  if (parsed.segments.length > 0) return false

  const targetIdentity = getSameNameChainIdentity(record)
  if (!targetIdentity) return false

  return rows.some((row) => {
    if (row === record) return false
    if (record.id !== undefined && row.id !== undefined && record.id === row.id) return false
    if (!isUnofficialStatus(row.status) || !hasRejectedControlResult(row)) return false
    const identity = getSameNameChainIdentity(row)
    return identity === targetIdentity && normalizeJointChainPart(row.joint) === normalizeJointChainPart(joint)
  })
}

function getSameNameChainIdentity(record: WeldInput) {
  const joint = String(record.joint ?? '').trim()
  if (!joint) return null
  const parsed = parseJointChainName(joint)
  return [
    normalizeJointChainPart(record.projectTitle),
    normalizeJointChainPart(record.subtitleCode),
    normalizeJointChainPart(record.line),
    normalizeJointChainPart(parsed.base),
  ].join('|')
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function isUnofficialStatus(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'неофициальный'
}

function isEnabledControl(value: unknown) {
  return isControlEnabledValue(value)
}

function isCancelledControl(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'отменен'
}

function getInactiveControlResultErrors(record: WeldInput) {
  return CONTROL_RESULT_PAIRS.flatMap(({ code, enabledKey, resultKey }) => {
    const result = normalizeResultStatus(record[resultKey])
    if (result === null || isEnabledControl(record[enabledKey]) || isCancelledControl(record[enabledKey])) return []
    return [{ code, enabledValue: record[enabledKey], resultValue: record[resultKey] }]
  })
}
