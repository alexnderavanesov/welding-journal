import { expect, it } from 'vitest'
import { gridClipboardNumber } from './grid-clipboard-number'
import { journalClipboardValue } from './welding-journal-grid-state'
import type { WeldRow } from './dispatcher-types'

it('uses decimal commas without rounding or altering codes and dates', () => {
  expect(gridClipboardNumber(45.6789123)).toBe('45,6789123')
  expect(gridClipboardNumber('1\u202f234.5600')).toBe('1234,5600')
  expect(gridClipboardNumber('-0.00001')).toBe('-0,00001')
  expect(gridClipboardNumber('0')).toBe('0')
  const row = {} as WeldRow
  expect(journalClipboardValue(row, 'wdi', 31.123456)).toBe('31,123456')
  expect(journalClipboardValue(row, 'joint', '001.2')).toBe('001.2')
  expect(journalClipboardValue(row, 'line', 'A1.2')).toBe('A1.2')
  expect(gridClipboardNumber('19.10.2026')).toBe('19.10.2026')
})
