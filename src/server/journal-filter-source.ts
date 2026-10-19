import { and, type SQL } from 'drizzle-orm'
import type { OtherSettings } from '@/lib/other-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS } from '@/lib/pre-heat-treatment-report-fields'
import { buildCalculatedReportValueSql } from './report-calculated-values-sql'
import { buildCalculatedFilterWhere } from './report-filter-text-sql'

export const JOURNAL_DERIVED_FILTER_KEYS = [
  'controlBasisSummary', 'rkExposureScheme', ...PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS,
] as const

// Shared by journal reads, filter options and mass-fill/replacement templates.
export function getWeldColumnFilterOptionSourceFilters(columnFilters: Record<string, string>, useCurrentSystemWdi: boolean) {
  const derivedKeys: readonly string[] = useCurrentSystemWdi
    ? [...JOURNAL_DERIVED_FILTER_KEYS, 'wdi'] : JOURNAL_DERIVED_FILTER_KEYS
  if (!derivedKeys.some(key => Boolean(columnFilters[key]?.trim()))) return columnFilters
  return Object.fromEntries(Object.entries(columnFilters).filter(([key]) => !derivedKeys.includes(key)))
}

export function getJournalDerivedFilters(columnFilters: Record<string, string>, useCurrentSystemWdi: boolean) {
  const source = getWeldColumnFilterOptionSourceFilters(columnFilters, useCurrentSystemWdi)
  return Object.fromEntries(Object.entries(columnFilters).filter(([key]) => !Object.hasOwn(source, key)))
}

/** Apply the same derived predicates to pages, totals and transactional import scopes. */
export function buildJournalCalculatedWhere(
  where: SQL | undefined, filters: Record<string, string>, settings: OtherSettings,
) {
  return and(where, ...Object.entries(filters).map(([key, filter]) => {
    const value = buildCalculatedReportValueSql('weldingJournal', key as WeldFieldKey, settings)
    if (!value) throw new Error(`Неизвестное расчётное поле: ${key}`)
    return buildCalculatedFilterWhere(value, filter)
  }))
}
