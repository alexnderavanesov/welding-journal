import { parseWeldColumnChoiceFilter } from './weld-column-choice-filter'

export const PSTO_EXCEPTION_FIELDS = ['projectTitle', 'subtitleCode', 'line', 'joint', 'rootJoint', 'linePsto', 'required', 'basis'] as const
export type PstoExceptionField = typeof PSTO_EXCEPTION_FIELDS[number]
export type PstoExceptionTableRequest = { search?: string; page?: number; pageSize?: number; filters?: Record<string, string> }

export function normalizePstoExceptionTableRequest(value: PstoExceptionTableRequest = {}) {
  const filters: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value.filters ?? {})) {
    if (!PSTO_EXCEPTION_FIELDS.includes(key as PstoExceptionField) || typeof raw !== 'string' || raw.length > 100_000) throw new Error('Некорректный фильтр таблицы исключений.')
    const parsed = parseWeldColumnChoiceFilter(raw)
    if (parsed && parsed.kind !== 'values') throw new Error('Выберите значения фильтра.')
    if (raw.trim()) filters[key] = raw.trim()
  }
  return { search: String(value.search ?? '').trim().slice(0, 200),
    page: Number.isSafeInteger(value.page) && value.page! > 0 ? value.page! : 0,
    pageSize: [25, 50, 100].includes(value.pageSize!) ? value.pageSize! : 50,
    filters }
}
