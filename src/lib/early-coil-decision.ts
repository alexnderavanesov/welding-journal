export const EARLY_COIL_DECISION_KIND = 'early-coil'
export const EARLY_COIL_DECISION_KEY_PREFIX = `${EARLY_COIL_DECISION_KIND}:`

export function getEarlyCoilDecisionKey(sourceRowId: number) {
  const normalizedId = Math.floor(Number(sourceRowId))
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    throw new Error('Некорректный идентификатор исходного стыка для досрочной катушки.')
  }
  return `${EARLY_COIL_DECISION_KEY_PREFIX}${normalizedId}`
}

export function parseEarlyCoilDecisionKey(value: unknown) {
  const key = String(value ?? '').trim()
  if (!key.startsWith(EARLY_COIL_DECISION_KEY_PREFIX)) return null
  const sourceRowId = Number(key.slice(EARLY_COIL_DECISION_KEY_PREFIX.length))
  if (!Number.isInteger(sourceRowId) || sourceRowId <= 0) return null
  return { key, sourceRowId }
}

export function getEarlyCoilDecisionSourceRowIds(keys: Iterable<unknown>) {
  const sourceRowIds = new Set<number>()
  for (const key of keys) {
    const decision = parseEarlyCoilDecisionKey(key)
    if (decision) sourceRowIds.add(decision.sourceRowId)
  }
  return sourceRowIds
}
