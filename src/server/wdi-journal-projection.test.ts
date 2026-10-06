import { describe, expect, it } from 'vitest'
import { getJournalWdiFilterSelect, mergeJournalFilterPage } from './weld-read'
import { WELD_TABLE_SELECT } from './weld-server-shared'
import { calculateFinalStatus } from '@/lib/weld-status'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('compact WDI journal filtering', () => {
  it('keeps required calculation fields and explicitly requested ordinary fields, not unrelated free text', () => {
    const select = getJournalWdiFilterSelect({ wdi: '=10', stamp1K: '=K1' })
    expect(select).not.toBe(WELD_TABLE_SELECT)
    expect(select).toHaveProperty('stamp1K')
    expect(select).toHaveProperty('rowVersion')
    expect(select).not.toHaveProperty('weldingJournalNote')
    expect(select).not.toHaveProperty('pstoNote')
    expect(getJournalWdiFilterSelect({ wdi: '=10' }, 'weldingJournalNote')).toHaveProperty('weldingJournalNote')
  })
  it('does not silently strip dependencies from unsupported virtual filters', () => {
    expect(getJournalWdiFilterSelect({ wdi: '=10', dispatcherTasks: 'СП-04' })).toBe(WELD_TABLE_SELECT)
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
    const compact = Object.fromEntries(Object.keys(getJournalWdiFilterSelect({ wdi: '=10' })).map(key => [key, row[key as keyof WeldRow]]))
    expect(calculateFinalStatus(compact)).toBe(expected)
  })
  it('restores every full-card field while preserving filter order, current WDI and computed status', () => {
    const filtered = [{ id: 2, rowVersion: '2', wdi: 10, finalStatus: 'годен' }, { id: 1, rowVersion: '1', wdi: 4.25 }] as WeldRow[]
    const full = [{ id: 1, rowVersion: '1', weldingJournalNote: 'История A' },
      { id: 2, rowVersion: '2', weldingJournalNote: 'История B', wdi: 777, finalStatus: 'не годен' }] as WeldRow[]
    expect(mergeJournalFilterPage(filtered, full)).toEqual([
      { ...full[1], ...filtered[0] }, { ...full[0], ...filtered[1] },
    ])
  })
  it.each([{ full: [] }, { full: [{ id: 1, rowVersion: 'new' }] }])('rejects a deleted or concurrently edited page row', ({ full }) => {
    expect(() => mergeJournalFilterPage([{ id: 1, rowVersion: 'old' }] as WeldRow[], full as WeldRow[])).toThrow('Повторите загрузку')
  })
})
