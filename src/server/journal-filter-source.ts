import type { SQL } from 'drizzle-orm'
import type { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { CONTROL_ASSIGNMENT_BASIS_FIELDS, withControlBasisSummary } from '@/lib/control-assignment-basis'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { OtherSettings } from '@/lib/other-settings'
import { PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS } from '@/lib/pre-heat-treatment-report-fields'
import { getRkExposureSchemeState } from '@/lib/rk-exposure'
import { filterWeldRowsByColumns } from '@/lib/weld-table-filtering'
import { attachPreHeatTreatmentControlRelations } from './heat-treatment-control-relations'
import { applyCurrentSystemWdi, WELD_ROW_VERSION_SELECT } from './weld-server-shared'
import { WDI_FILTER_SOURCE_SELECT } from './wdi-filter-source'

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

export function getJournalDerivedFilterSelect(filters: Record<string, string>) {
  return {
    ...(filters.wdi ? WDI_FILTER_SOURCE_SELECT : { id: weldJoints.id }),
    rowVersion: WELD_ROW_VERSION_SELECT,
    ...(filters.controlBasisSummary ? Object.fromEntries(CONTROL_ASSIGNMENT_BASIS_FIELDS.map(
      ({ basisKey }) => [basisKey, weldJoints[basisKey]],
    )) : {}),
    ...(filters.rkExposureScheme ? {
      connectionType: weldJoints.connectionType, d1: weldJoints.d1, d2: weldJoints.d2,
      rkExposureConfirmedDiameter: weldJoints.rkExposureConfirmedDiameter,
      lnkDefectDescription: weldJoints.lnkDefectDescription,
    } : {}),
    ...(PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS.some(key => filters[key]) ? {
      hasVik: weldJoints.hasVik, hasRk: weldJoints.hasRk,
      hasUzk: weldJoints.hasUzk, hasPvk: weldJoints.hasPvk,
    } : {}),
  }
}

// SQL filters have already been applied. Do not apply them again to compact
// objects: hidden dispatcher filters, document titles and numeric SQL values
// are not fields of this projection. Only derived values are evaluated here.
export async function loadJournalDerivedFilterMatches(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
  where: SQL | undefined,
  filters: Record<string, string>,
  settings: OtherSettings,
): Promise<Array<{ id: number; rowVersion: string }>> {
  let rows: WeldRow[] = await db.select(getJournalDerivedFilterSelect(filters)).from(weldJoints).where(where)
  if (filters.wdi) rows = applyCurrentSystemWdi(rows, settings)
  if (filters.controlBasisSummary) rows = rows.map(row => withControlBasisSummary(row, 'all'))
  if (filters.rkExposureScheme) rows = rows.map(row => ({ ...row, rkExposureScheme: getRkExposureSchemeState(row, settings.rkExposureTable).label }))
  // Narrow by cheap values before loading related pre-TO history.
  const preKeys: readonly string[] = PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS
  rows = filterWeldRowsByColumns(rows, Object.fromEntries(Object.entries(filters).filter(([key]) => !preKeys.includes(key))))
  if (PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS.some(key => filters[key])) {
    rows = await attachPreHeatTreatmentControlRelations(rows, db)
    rows = filterWeldRowsByColumns(rows, Object.fromEntries(Object.entries(filters).filter(([key]) => preKeys.includes(key))))
  }
  return rows.map(row => ({ id: row.id, rowVersion: String(row.rowVersion ?? '') }))
}
