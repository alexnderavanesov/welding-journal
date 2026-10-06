import { describe, expect, it } from 'vitest'
import { getJournalDerivedFilters, getJournalDerivedFilterSelect, getWeldColumnFilterOptionSourceFilters, JOURNAL_DERIVED_FILTER_KEYS } from './journal-filter-source'
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
  it('loads only the fields needed by each derived predicate, never full cards', () => {
    const basis = getJournalDerivedFilterSelect({ controlBasisSummary: 'ALPHA' })
    expect(Object.keys(basis).sort()).toEqual(['id', 'rowVersion', 'vikControlBasis', 'rkControlBasis', 'uzkControlBasis', 'pvkControlBasis'].sort())
    const pre = getJournalDerivedFilterSelect({ preRkResult: '=ремонт' })
    expect(Object.keys(pre).sort()).toEqual(['id', 'rowVersion', 'hasVik', 'hasRk', 'hasPvk', 'hasUzk'].sort())
    const scheme = getJournalDerivedFilterSelect({ rkExposureScheme: 'A' })
    expect(scheme).toHaveProperty('lnkDefectDescription')
    for (const select of [basis, pre, scheme, getJournalDerivedFilterSelect({ wdi: '=10' })]) {
      expect(select).not.toHaveProperty('weldingJournalNote')
      expect(select).not.toHaveProperty('pstoNote')
      expect(select).toHaveProperty('rowVersion')
    }
    expect(getWeldColumn('preRkResult')).toBeUndefined()
  })
})
