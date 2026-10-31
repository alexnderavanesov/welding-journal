import { expect, it } from 'vitest'
import { collectResultRequestSources } from './result-request-sources'
import { createRequestDocumentIdentity } from './request-document-identity'

it('counts each selected position once and distinguishes equal names on different dates', () => {
  const rows = [{ id: 1, date: '2026-10-01' }, { id: 2, date: '2026-10-01' }, { id: 3, date: '2026-10-02' }]
  const groups = collectResultRequestSources(rows, ([row]) => [createRequestDocumentIdentity('Request', row.date)!, createRequestDocumentIdentity('Request', row.date)!])
  expect(groups.map(group => [...group.rowIds])).toEqual([[1, 2], [3]])
  expect(rows.map(row => row.id)).toEqual([1, 2, 3])
})
