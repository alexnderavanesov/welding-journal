import { describe, expect, it } from 'vitest'
import { JOURNAL_INLINE_FIELDS, normalizeJournalCellEdits, parseJournalClipboard } from './journal-inline-edit'

describe('journal inline input', () => {
  it('keeps the selected free-entry fields and excludes spool, qualifications and managed workflows', () => {
    expect([...JOURNAL_INLINE_FIELDS]).toHaveLength(11)
    for (const field of ['spool', 'spoolId', 'weldDate', 'stamp1K', 'materialGroup', 'technologyCardNumber', 'finalStatus', 'hasVik', 'vikResult', 'jsrDocument', 'pstoResult']) {
      expect(() => normalizeJournalCellEdits([{ id: 1, version: '42', values: { [field]: 'x' } }])).toThrow('нельзя редактировать')
    }
  })
  it('retains versions, normalizes numbers and clear operations without widening the record', () => {
    expect(normalizeJournalCellEdits([{ id: 2, version: '123', values: { sheet: '2,5', weldingElectrodes: ' Э-1 ', shieldingGas: '' } }]))
      .toEqual({ records: [{ id: 2, sheet: 2.5, weldingElectrodes: 'Э-1', shieldingGas: null }], expectedVersions: [{ id: 2, version: '123' }] })
  })
  it.each(['abc', '1.2.3', 'Infinity', '1e5', true, {}])('refuses invalid numeric input %j instead of clearing or truncating it', value => {
    expect(() => normalizeJournalCellEdits([{ id: 1, version: '1', values: { sheet: value } }])).toThrow()
  })
  it.each([[], [{ id: 1, values: { isometry: 'x' } }], [{ id: 1, version: '1', values: {} }],
    [{ id: 1, version: '1', values: { isometry: 'x' } }, { id: 1, version: '1', values: { isometry: 'y' } }]].map(input => ({ input })))('rejects missing versions, empty edits and duplicate targets', ({ input }) => {
    expect(() => normalizeJournalCellEdits(input)).toThrow()
  })
  it('reads Excel quotes, tabs, multiline notes and a trailing row separator', () => {
    expect(parseJournalClipboard('"Э\t1"\t"строка 1\r\nстрока ""2"""\r\nА\tБ\r\n'))
      .toEqual([['Э\t1', 'строка 1\nстрока "2"'], ['А', 'Б']])
    expect(parseJournalClipboard('')).toEqual([['']])
    expect(parseJournalClipboard('a\t\n')).toEqual([['a', '']])
  })
  it.each(['a\tb\nc', '"missing', '"closed"oops'])('rejects malformed clipboard %j before any write', text => {
    expect(() => parseJournalClipboard(text)).toThrow()
  })
})
