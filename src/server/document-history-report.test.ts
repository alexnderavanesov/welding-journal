import { beforeEach, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import type { DocumentHistoryReportRequest } from '@/lib/document-history-report'
const mocks = vi.hoisted(() => ({ db: vi.fn(), permission: vi.fn(), prepare: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: mocks.db }))
vi.mock('./access-context', () => ({ requirePermission: mocks.permission }))
vi.mock('./generated-documents', async original => ({ ...await original<typeof import('./generated-documents')>(), prepareGeneratedDocumentHistoryOutput: mocks.prepare }))
import { normalizeDocumentHistoryReportRequest, readDocumentHistoryReport, createDocumentHistoryExcelResponse, visitDocumentHistoryReport } from './document-history-report'

const request = (): DocumentHistoryReportRequest => ({ source: { kind: 'generated', types: ['weldingJournal'], columnFilters: {} },
  title: 'Список документов', columns: [{ key: 'title', label: 'Документ' }, { key: 'rowCount', label: 'Стыков' }], search: '', rowGroupCols: [], sortModel: [] })
const dialect = new PgDialect()
function source(total: number) {
  let offset = 0
  const execute = vi.fn(async query => {
    const text = dialect.sqlToQuery(query).sql
    if (text.startsWith('select transaction_timestamp')) return { rows: [{ time: '2026-11-12T09:00:00Z' }] }
    if (text.startsWith('fetch')) {
      const rows = Array.from({ length: Math.max(0, Math.min(1000, total - offset)) }, (_, n) => ({ title: `00-${offset + n}`, rowCount: offset + n, __outputTotal: total }))
      offset += rows.length
      return { rows }
    }
    return { rows: [] }
  })
  const transaction = vi.fn(async (run, options) => { expect(options.isolationLevel).toBe('repeatable read'); return run({ execute }) })
  mocks.db.mockReturnValue({ transaction })
  mocks.prepare.mockResolvedValue({ query: sql`select 1`, cells: (keys: string[], row: Record<string, unknown>) => keys.map(key => row[key]) })
  return { execute, transaction }
}
beforeEach(() => { vi.resetAllMocks() })

it.each([
  (input: any) => { input.source.types = ['unknown'] },
  (input: any) => { input.source.kind = 'unknown' },
  (input: any) => { input.columns.push(input.columns[0]) },
  (input: any) => { input.columns[0].key = '__actions' },
  (input: any) => { input.sortModel = [{ colId: 'title', sort: 'drop table' }] },
])('rejects unsupported scopes/columns/order instead of widening the export', change => {
  const input = request(); change(input)
  expect(() => normalizeDocumentHistoryReportRequest(input)).toThrow()
})
it('retains only the preview bound and closes its cursor while reporting the full count', async () => {
  const { execute } = source(200_001)
  const report = await readDocumentHistoryReport(request())
  expect(report.preview).toEqual({ truncated: true, sourceRows: 200_001, totalRows: 200_001, freshExcel: true })
  expect(report.tables![0].rows).toHaveLength(2000)
  expect(execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql).filter(text => text.startsWith('fetch'))).toHaveLength(2)
  expect(dialect.sqlToQuery(execute.mock.calls.at(-1)![0]).sql).toBe('close document_history_output')
  expect(mocks.permission.mock.calls.map(([value]) => value)).toEqual(['documents.view', 'documents.export'])
})
it('exports beyond 10000 rows with textual identifiers and numeric counts', async () => {
  source(10_007)
  const response = await createDocumentHistoryExcelResponse(request(), new AbortController().signal)
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()))
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  expect(sheet['!ref']).toBe('A1:B10008')
  expect(sheet.A2).toMatchObject({ t: 's', v: '00-0' })
  expect(sheet.A10008.v).toBe('00-10006')
  expect(sheet.B10008).toMatchObject({ t: 'n', v: 10006 })
})
it('closes the cursor on cancelled output and refuses output without export permission', async () => {
  const { execute } = source(5000), controller = new AbortController()
  await expect(visitDocumentHistoryReport(request(), async () => { controller.abort() }, controller.signal)).rejects.toThrow()
  expect(dialect.sqlToQuery(execute.mock.calls.at(-1)![0]).sql).toBe('close document_history_output')
  mocks.permission.mockRejectedValueOnce(new Error('access denied'))
  const calls = execute.mock.calls.length
  await expect(readDocumentHistoryReport(request())).rejects.toThrow('access denied')
  expect(execute).toHaveBeenCalledTimes(calls)
})
