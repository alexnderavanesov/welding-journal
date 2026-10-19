import { PgDialect } from 'drizzle-orm/pg-core'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { describe, expect, it } from 'vitest'
import { getJournalDerivedFilters, buildJournalCalculatedWhere, getWeldColumnFilterOptionSourceFilters, JOURNAL_DERIVED_FILTER_KEYS } from './journal-filter-source'
import { FIELD_BY_KEY, WELD_FIELDS } from '@/lib/weld-fields'
import { WELDING_JOURNAL_HIDDEN_FIELD_KEYS } from '@/lib/welding-journal-report-config'
import { GENERATED_DOCUMENT_FIELD_TYPES, getWeldColumn } from './weld-server-shared'

describe('shared journal/template filter plan', () => {
  it.each([true, false])('partitions SQL and derived filters without discarding any key (system WDI: %s)', system => {
    const filters = { projectTitle: '=P', search: 'S1', __dispatcherTaskFilter: '{"mode":"with"}',
      wdi: '=10', preVikResult: '=годен', controlBasisSummary: 'ALPHA', rkExposureScheme: '=A', jsrDocument: '=DOC' }
    const sql = getWeldColumnFilterOptionSourceFilters(filters, system)
    const derived = getJournalDerivedFilters(filters, system)
    expect({ ...sql, ...derived }).toEqual(filters)
    expect(Object.keys(sql).filter(key => Object.hasOwn(derived, key))).toEqual([])
    expect(derived).toEqual({ preVikResult: '=годен', controlBasisSummary: 'ALPHA', rkExposureScheme: '=A', ...(system ? { wdi: '=10' } : {}) })
  })
  it('classifies every journal virtual field explicitly; the PSTO-only cycle summary is not a journal column', () => {
    expect(WELDING_JOURNAL_HIDDEN_FIELD_KEYS.has('pstoCycleSummary')).toBe(true)
    for (const field of WELD_FIELDS.filter(field => 'virtual' in field && field.virtual && field.key !== 'pstoCycleSummary')) {
      expect(field.key === 'dispatcherTasks' || Object.hasOwn(GENERATED_DOCUMENT_FIELD_TYPES, field.key) ||
        (JOURNAL_DERIVED_FILTER_KEYS as readonly string[]).includes(field.key), field.key).toBe(true)
    }
    for (const key of JOURNAL_DERIVED_FILTER_KEYS) expect(FIELD_BY_KEY.has(key)).toBe(true)
  })
  it('builds only dependencies used by the predicate, keeping cards out of selection', () => {
    const query = new PgDialect().sqlToQuery(buildJournalCalculatedWhere(undefined,
      { controlBasisSummary: 'ALPHA', preRkResult: '=ремонт' }, DEFAULT_OTHER_SETTINGS)!)
    expect(query.sql).toContain('"pre_heat_treatment_controls"')
    expect(query.sql).toContain('"rk_control_basis"')
    expect(query.sql).not.toContain('"psto_repeat_cycles"')
    expect(query.sql).not.toContain('"welding_journal_note"')
    expect(query.sql).not.toContain('"duplicate_controls"')
    expect(query.params).toContain('ремонт')
    expect(getWeldColumn('preRkResult')).toBeUndefined()
  })
})
