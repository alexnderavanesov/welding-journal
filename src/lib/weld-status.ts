import type { WeldFieldKey, WeldInput } from './weld-field-definitions'

export const RESULT_STATUS_OPTIONS = ['годен', 'ремонт', 'вырез', 'ожидает', 'ожидает НК'] as const
export const PSTO_RESULT_STATUS_OPTIONS = ['проведено'] as const
export const FINAL_STATUS_OPTIONS = ['годен', 'не годен', 'ожидает сварку', 'ожидает ремонт', 'ожидает заявку', 'ожидает НК', 'ошибка'] as const
export const RESULT_FIELD_KEYS = new Set<WeldFieldKey>([
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'pstoResult',
  'mkkResult',
  'finalStatus',
])

export const CONTROL_RESULT_PAIRS = [
  { enabledKey: 'hasVik', resultKey: 'vikResult' },
  { enabledKey: 'hasRk', resultKey: 'rkResult' },
  { enabledKey: 'hasPvk', resultKey: 'pvkResult' },
  { enabledKey: 'hasUzk', resultKey: 'uzkResult' },
  { enabledKey: 'hasTvmt', resultKey: 'tvmtResult' },
  { enabledKey: 'hasRfa', resultKey: 'rfaResult' },
  { enabledKey: 'hasStls', resultKey: 'stlsResult' },
  { enabledKey: 'hasMkk', resultKey: 'mkkResult' },
] as const satisfies ReadonlyArray<{ enabledKey: WeldFieldKey; resultKey: WeldFieldKey }>

const CONTROL_STATE_PAIRS = [
  { enabledKey: 'hasVik', requestKey: 'vikRequest', resultKey: 'vikResult' },
  { enabledKey: 'hasRk', requestKey: 'rkRequest', resultKey: 'rkResult' },
  { enabledKey: 'hasPvk', requestKey: 'pvkRequest', resultKey: 'pvkResult' },
  { enabledKey: 'hasUzk', requestKey: 'uzkRequest', resultKey: 'uzkResult' },
  { enabledKey: 'hasTvmt', requestKey: 'tvmtRequest', resultKey: 'tvmtResult' },
  { enabledKey: 'hasRfa', requestKey: 'rfaRequest', resultKey: 'rfaResult' },
  { enabledKey: 'hasStls', requestKey: 'stlsRequest', resultKey: 'stlsResult' },
  { enabledKey: 'hasMkk', requestKey: 'mkkRequest', resultKey: 'mkkResult' },
] as const satisfies ReadonlyArray<{ enabledKey: WeldFieldKey; requestKey: WeldFieldKey; resultKey: WeldFieldKey }>

export function calculateFinalStatus(record: WeldInput) {
  const hasResultWithoutEnabledControl = CONTROL_RESULT_PAIRS.some(
    ({ enabledKey, resultKey }) =>
      !isEnabledControl(record[enabledKey]) && !isCancelledControl(record[enabledKey]) && normalizeResultStatus(record[resultKey]) !== null,
  )
  if (hasResultWithoutEnabledControl) return 'ошибка'

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
  if (hasMissingRequest) return 'ожидает заявку'
  if (hasPendingResult) return 'ожидает НК'
  return 'ожидает НК'
}

export function normalizeResultStatus(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'да') return 'годен'
  if (text === 'проведено') return 'годен'
  const option = RESULT_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? null
}

export function normalizeFinalStatus(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'ожидает') return 'ожидает НК'
  const option = FINAL_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? null
}

function getPendingWeldFinalStatus(record: WeldInput) {
  const joint = String(record.joint ?? '').replace(/\s+/g, '').toUpperCase()
  const hasCoilSegment = /Y\d+/.test(joint)
  const hasRepairSegment = /[RW]\d+/.test(joint)
  return hasRepairSegment && !hasCoilSegment ? 'ожидает ремонт' : 'ожидает сварку'
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function isEnabledControl(value: unknown) {
  if (value === true) return true
  return String(value ?? '').trim().toLowerCase() === 'да'
}

function isCancelledControl(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'отменен'
}
