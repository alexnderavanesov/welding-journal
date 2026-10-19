import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildReportQueryWhere } from './weld-read'
import { WELD_TABLE_SELECT } from './weld-server-shared'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { calculateFinalStatus } from '@/lib/weld-status'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('WDI filtering without a compact/full-card read gap', () => {
  it('combines current WDI with factual and pre-TO predicates in SQL', () => {
    const query = new PgDialect().sqlToQuery(buildReportQueryWhere('weldingJournal', {
      columnFilters: { wdi: '=10', stamp1K: '=K1', preRkResult: '=ремонт' },
    }, { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' }))
    expect(query.sql).toContain('round(case')
    expect(query.sql).toContain('"stamp_1_k"')
    expect(query.sql).toContain('"pre_heat_treatment_controls"')
    expect(query.sql).not.toContain('"welding_journal_note"')
    expect(query.params).toEqual(expect.arrayContaining(['10', 'K1', 'ремонт']))
    expect(WELD_TABLE_SELECT).toHaveProperty('rowVersion')
    expect(WELD_TABLE_SELECT).toHaveProperty('weldingJournalNote')
  })
  it.each([
    [{}, 'годен'],
    [{ vikResult: 'ремонт' }, 'не годен'],
    [{ hasVik: '', vikResult: 'годен' }, 'ошибка'],
    [{ weldDate: '' }, 'ожидает сварку'],
    [{ vikResult: '', vikRequest: '' }, 'ожидает заявку'],
    [{ vikResult: '', vikRequest: 'ВИК-1' }, 'ожидает НК'],
    [{ pstoRequired: 'да', pstoRequest: '' }, 'ожидает заявку'],
  ])('retains independent status expectation %j → %s', (changes, expected) => {
    const row = { id: 1, joint: 'S1', weldDate: '2026-09-01', hasVik: 'да', vikResult: 'годен', ...changes } as WeldRow
    const compact = Object.fromEntries(Object.keys(WELD_TABLE_SELECT).map(key => [key, row[key as keyof WeldRow]]))
    expect(calculateFinalStatus(compact)).toBe(expected)
  })
})
