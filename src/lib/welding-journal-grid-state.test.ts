import { beforeEach, describe, expect, it } from 'vitest'
import { journalFilterValueLabel, normalizeJournalAppearance, DEFAULT_JOURNAL_APPEARANCE, JOURNAL_GRID_STORAGE_KEY, journalClipboardValue, journalColumnLayout, mergeJournalSelection, readJournalGridStorage, writeJournalGridStorage } from './welding-journal-grid-state'
import type { WeldRow } from './dispatcher-types'
import { WELD_GRID_PROFILES } from './weld-report-grid-profile'

describe('welding journal grid state', () => {
  beforeEach(() => localStorage.clear())
  it('keeps PSTO layouts and named appearance snapshots separate from the journal', () => {
    const journal = { columns: [{ colId: 'joint', width: 180 }], appearance: DEFAULT_JOURNAL_APPEARANCE, views: {} }
    const psto = { columns: [{ colId: 'pstoResult', width: 280 }], appearance: { ...DEFAULT_JOURNAL_APPEARANCE, theme: 'balham' as const }, views: {} }
    writeJournalGridStorage(journal)
    const original = localStorage.getItem(JOURNAL_GRID_STORAGE_KEY)
    writeJournalGridStorage(psto, WELD_GRID_PROFILES.heatTreatment.storageKey)
    expect(localStorage.getItem(JOURNAL_GRID_STORAGE_KEY)).toBe(original)
    expect(readJournalGridStorage().appearance.theme).toBe('quartz')
    expect(readJournalGridStorage(WELD_GRID_PROFILES.heatTreatment.storageKey)).toMatchObject(psto)
  })
  it('preserves selections outside the currently loaded page without keeping deselected visible rows', () => {
    const previous = new Set([1, 2, 501])
    expect(mergeJournalSelection(previous, [1, 2, 3], [2, 3])).toEqual(new Set([2, 3, 501]))
    expect(previous).toEqual(new Set([1, 2, 501]))
  })
  it('never restores server sorting or visibility from a sizing snapshot', () => {
    expect(journalColumnLayout([{ colId: '__groupLabel', pinned: 'left' }, { colId: 'line', width: 9000, pinned: 'left', sort: 'desc', hide: true }]))
      .toEqual([{ colId: 'line', width: 1200, pinned: 'left', rowGroup: false, rowGroupIndex: null }])
  })
  it('survives malformed storage and roundtrips layout alongside existing named views', () => {
    localStorage.setItem(JOURNAL_GRID_STORAGE_KEY, '{broken')
    expect(readJournalGridStorage().appearance).toEqual(DEFAULT_JOURNAL_APPEARANCE)
    const layout = { columns: [{ colId: 'joint', width: 160, rowGroup: true, rowGroupIndex: 0 }], appearance: { ...DEFAULT_JOURNAL_APPEARANCE, density: 'compact' as const, wrapText: false } }
    writeJournalGridStorage({ ...layout, views: { 'смена': layout } })
    expect(readJournalGridStorage()).toEqual({ ...layout, views: { 'смена': layout } })
  })
  it('keeps previous appearance settings when adding wrapping', () => {
    expect(normalizeJournalAppearance({ density: 'compact', stripes: false })).toEqual({ ...DEFAULT_JOURNAL_APPEARANCE, density: 'compact', stripes: false })
    expect(normalizeJournalAppearance({ wrapText: false }).wrapText).toBe(false)
  })
  it('defaults older views to Quartz and persists supported themes', () => {
    expect(normalizeJournalAppearance({ density: 'compact' }).theme).toBe('quartz')
    expect(normalizeJournalAppearance({ theme: 'unknown' as never }).theme).toBe('quartz')
    for (const theme of ['alpine', 'balham'] as const) {
      const layout = { columns: [], appearance: { ...DEFAULT_JOURNAL_APPEARANCE, theme } }
      writeJournalGridStorage({ ...layout, views: { personal: layout } })
      expect(readJournalGridStorage().appearance.theme).toBe(theme)
      expect(readJournalGridStorage().views.personal.appearance.theme).toBe(theme)
    }
  })
  it('formats numeric facets without changing identifiers or blank choices', () => {
    expect(journalFilterValueLabel('d1', '159.000')).toBe('159')
    expect(journalFilterValueLabel('t1', '10.256')).toBe('10,3')
    expect(journalFilterValueLabel('joint', '001.000')).toBe('001.000')
    expect(journalFilterValueLabel('d1', '')).toBe('')
  })
  it('copies operator-visible dates and booleans, preserving textual codes', () => {
    const row = { id: 1 } as WeldRow
    expect(journalClipboardValue(row, 'weldDate', '2026-10-15')).toBe('15.10.2026')
    expect(journalClipboardValue(row, 'hasVik', true)).toBe('да')
    expect(journalClipboardValue(row, 'hasVik', false)).toBe('')
    expect(journalClipboardValue(row, 'joint', '00012R1')).toBe('00012R1')
  })
})
