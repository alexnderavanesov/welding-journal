const COLUMN_CHOICE_FILTER_PREFIX = '__column_choice_filter__:'

export type WeldColumnChoiceFilter = {
  kind: 'values'
  values: string[]
}

export function buildWeldColumnValueFilter(values: string[]) {
  const normalizedValues = Array.from(new Set(values.map(normalizeWeldColumnChoiceValue)))
  if (normalizedValues.length === 0) return ''
  return encodeWeldColumnChoiceFilter({ kind: 'values', values: normalizedValues })
}

export function parseWeldColumnChoiceFilter(value: string): WeldColumnChoiceFilter | null {
  if (!value.startsWith(COLUMN_CHOICE_FILTER_PREFIX)) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(COLUMN_CHOICE_FILTER_PREFIX.length))) as Partial<WeldColumnChoiceFilter>
    if (parsed.kind === 'values' && Array.isArray(parsed.values)) {
      return {
        kind: 'values',
        values: parsed.values.map(normalizeWeldColumnChoiceValue),
      }
    }
  } catch {
    return null
  }
  return null
}

export function normalizeWeldColumnChoiceValue(value: unknown) {
  return String(value ?? '').trim()
}

function encodeWeldColumnChoiceFilter(filter: WeldColumnChoiceFilter) {
  return `${COLUMN_CHOICE_FILTER_PREFIX}${encodeURIComponent(JSON.stringify(filter))}`
}
