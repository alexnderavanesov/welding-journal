import { expect, it } from 'vitest'
import { formatPstoDocumentDisplay } from './psto-document-display'

it('marks only the cancelled position and restores its original display on reactivation', () => {
  const row = { pstoRequired: 'отменен', pstoRequest: 'П-12', tvmtRequest: 'Т-8', tvmtConclusion: 'ТК-8' }
  for (const key of ['pstoRequest', 'tvmtRequest', 'tvmtConclusion'] as const) {
    expect(formatPstoDocumentDisplay(row, key, row[key])).toBe(`${row[key]} (отменен)`)
    expect(formatPstoDocumentDisplay({ ...row, pstoRequired: 'да' }, key, row[key])).toBe(row[key])
  }
  expect(formatPstoDocumentDisplay(row, 'vikRequest', 'В-1')).toBe('В-1')
  expect(formatPstoDocumentDisplay(row, 'pstoRequest', null)).toBeNull()
  expect(row.pstoRequest).toBe('П-12')
})
