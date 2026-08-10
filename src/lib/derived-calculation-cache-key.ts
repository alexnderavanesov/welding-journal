export function buildDerivedCalculationCacheKey(namespace: string, input: unknown) {
  return `${namespace}:${stableSerialize(input)}`
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}
