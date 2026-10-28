import { expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { limitReportPreview } from './report-preview-limit'
import { useReportPreview } from './use-report-preview'
import { getReportPrintRestriction } from './report-print-policy'

it('limits across tables including group rows, without changing the complete report or download', async () => {
  const report = { title: 'Statistics', tables: [
    { title: 'First', columns: ['A'], rows: Array.from({ length: 1999 }, (_, i) => [String(i)]) },
    { title: 'Second', columns: ['A'], rows: [['Group'], ['Last']], rowKinds: ['group', 'detail'] as Array<'group' | 'detail'> },
  ] }
  const download = vi.fn(async () => { expect(report.tables[1].rows).toEqual([['Group'], ['Last']]) })
  const { result } = renderHook(() => useReportPreview())
  await act(async () => result.current.open(async () => ({ report, onDownloadExcel: download })))
  const shown = limitReportPreview(result.current.previewProps!.report!)
  expect(shown.tables![1].rows).toEqual([['Group']])
  expect(shown.tables![1].rowKinds).toEqual(['group'])
  expect(shown.preview).toMatchObject({ totalRows: 2001, truncated: true, freshExcel: false })
  expect(getReportPrintRestriction(shown)).toContain('2001 строк')
  await result.current.previewProps!.onDownloadExcel!()
  expect(download).toHaveBeenCalledOnce()
})

it.each([0, 1000, 2000])('keeps a report of %i rows intact', count => {
  const report = { title: 'Report', tables: [{ title: '', columns: ['A'], rows: Array.from({ length: count }, () => ['row']) }] }
  expect(limitReportPreview(report)).toBe(report)
})


it('bounds hidden print identity payloads with the preview rows', () => {
  const rows = Array.from({ length: 2001 }, (_, i) => [i])
  const identity = { columns: ['Линия', 'Стык'], indexes: [-1, -1], rows: rows.map(([i]) => ['L', `F${i}`]) }
  const report = { title: 'Report', tables: [{ title: '', columns: ['Value'], rows, printIdentity: identity }] }
  const table = limitReportPreview(report).tables![0]
  expect(table.rows).toHaveLength(2000)
  expect(table.printIdentity!.rows).toEqual(identity.rows.slice(0, 2000))
  expect(identity.rows).toHaveLength(2001)
})
