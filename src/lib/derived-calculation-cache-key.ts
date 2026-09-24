import { DERIVED_CALCULATION_CACHE_VERSION } from '@/lib/derived-calculation-cache-version'

export function buildDerivedCalculationCacheKey(namespace: string, input: unknown) {
  // A data revision can exceed the next version's revision floor. Keeping the
  // rule version in the key prevents reusing that old payload after deployment.
  return `rules:v${DERIVED_CALCULATION_CACHE_VERSION}:${namespace}:${stableSerialize(input)}`
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
