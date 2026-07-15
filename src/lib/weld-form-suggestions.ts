import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export type WeldFormSuggestion = {
  value: string
  context: string
  count: number
  score: number
}

const CONTEXT_FIELDS: WeldFieldKey[] = ['projectTitle', 'subtitleCode', 'line', 'joint']
const MATCH_CONTEXT_FIELDS: Array<{ key: WeldFieldKey; score: number }> = [
  { key: 'projectTitle', score: 40 },
  { key: 'subtitleCode', score: 36 },
  { key: 'line', score: 34 },
  { key: 'groupName', score: 20 },
  { key: 'category', score: 20 },
  { key: 'isometry', score: 14 },
  { key: 'spool', score: 14 },
  { key: 'element1', score: 12 },
  { key: 'element2', score: 12 },
  { key: 'material1', score: 10 },
  { key: 'material2', score: 10 },
]

const SHARED_SUGGESTION_FIELD_KEYS: Partial<Record<WeldFieldKey, WeldFieldKey[]>> = {
  element1: ['element1', 'element2'],
  element2: ['element1', 'element2'],
  material1: ['material1', 'material2'],
  material2: ['material1', 'material2'],
  d1: ['d1', 'd2'],
  d2: ['d1', 'd2'],
  t1: ['t1', 't2'],
  t2: ['t1', 't2'],
}

const DISABLED_SUGGESTION_FIELD_KEYS = new Set<WeldFieldKey>(['joint', 'wdi'])

export function getWeldFormSuggestions({
  fieldKey,
  value,
  draft,
  rows,
  limit = 8,
}: {
  fieldKey: WeldFieldKey
  value: unknown
  draft: WeldInput
  rows: readonly WeldInput[]
  limit?: number
}): WeldFormSuggestion[] {
  if (DISABLED_SUGGESTION_FIELD_KEYS.has(fieldKey)) return []

  const query = normalizeSuggestionText(value)
  const currentId = typeof draft.id === 'number' ? draft.id : null
  const sourceFieldKeys = SHARED_SUGGESTION_FIELD_KEYS[fieldKey] ?? [fieldKey]
  const suggestions = new Map<string, WeldFormSuggestion>()

  for (const row of rows) {
    if (currentId !== null && row.id === currentId) continue

    for (const sourceFieldKey of sourceFieldKeys) {
      const candidate = normalizeSuggestionValue(row[sourceFieldKey])
      if (!candidate) continue
      if (query && !normalizeSuggestionText(candidate).includes(query)) continue

      const previous = suggestions.get(candidate)
      const score = getContextScore(row, draft)
      const context = getSuggestionContext(row, fieldKey)
      if (previous) {
        previous.count += 1
        previous.score = Math.max(previous.score, score)
        if (!previous.context && context) previous.context = context
        continue
      }

      suggestions.set(candidate, {
        value: candidate,
        context,
        count: 1,
        score,
      })
    }
  }

  return [...suggestions.values()]
    .sort((left, right) => {
      const scoreDiff = right.score - left.score
      if (scoreDiff !== 0) return scoreDiff

      const countDiff = right.count - left.count
      if (countDiff !== 0) return countDiff

      return left.value.localeCompare(right.value, 'ru', { numeric: true })
    })
    .slice(0, limit)
}

function getContextScore(row: WeldInput, draft: WeldInput) {
  return MATCH_CONTEXT_FIELDS.reduce((score, field) => {
    const draftValue = normalizeSuggestionText(draft[field.key])
    if (!draftValue) return score

    const rowValue = normalizeSuggestionText(row[field.key])
    return rowValue && rowValue === draftValue ? score + field.score : score
  }, 0)
}

function getSuggestionContext(row: WeldInput, fieldKey: WeldFieldKey) {
  return CONTEXT_FIELDS.filter((key) => key !== fieldKey)
    .map((key) => normalizeSuggestionValue(row[key]))
    .filter(Boolean)
    .join(' · ')
}

function normalizeSuggestionValue(value: unknown) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text || text === '-') return ''
  return text
}

function normalizeSuggestionText(value: unknown) {
  return normalizeSuggestionValue(value).toLocaleLowerCase('ru')
}
