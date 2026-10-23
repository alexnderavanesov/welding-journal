import { expect, test } from '@playwright/test'
import pg from 'pg'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-table-filtering'
import { isDocumentHistoryGroupRow, type DocumentHistoryGridRequest } from '../../src/lib/document-history-grid'
import { loadRemoteGeneratedDocumentHistoryGrid, normalizeGeneratedDocumentHistoryGridRequest } from '../../src/server/generated-documents'
import { loadIndexedSystemDocumentHistoryGrid, loadSystemDocumentSummaries } from '../../src/server/system-document-index'
import { normalizeSystemDocumentHistoryGridRequest } from '../../src/server/system-documents'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

// Independent document cardinality. This targeted read test is not the deferred
// mixed load / preview / print / rebuild profile, or a 600k-history acceptance.
test.skip(process.env.DOCUMENT_TRANSFER_SCALE !== '1', 'Opt-in document transfer cardinality check')
const project = 'E2E document transfer cardinality'
const defaults: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
const columnFilters = { project: buildWeldColumnValueFilter([project]) }
const read = (kind: 'generated' | 'system', request: Partial<DocumentHistoryGridRequest>) => kind === 'generated'
  ? loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest({ ...defaults, ...request, type: 'weldingJournal', columnFilters }))
  : loadIndexedSystemDocumentHistoryGrid(normalizeSystemDocumentHistoryGridRequest({ ...defaults, ...request, type: 'lnkRequest', columnFilters }))

test.afterEach(async () => { test.setTimeout(300000); await cleanupLineProgramProjects([project]) })
test('document transfer: IDs, distant cells, summaries and counters scale independently of joints', async ({}, info) => {
  test.setTimeout(300000)
  await loadSystemDocumentSummaries('lnkRequest')
  const measurements: unknown[] = []
  for (const count of [1000, 20000]) {
    await cleanupLineProgramProjects([project])
    await withLineProgramFixture(async db => {
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality)
        select $1,'TRANSFER','LINE-'||(n%10),'F'||n,'2026-10-01','действующий','актуальная' from generate_series(1,100) n`, [project])
      await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count,period_from,source_metadata)
        select kind,'TRANSFER-'||lpad(n::text,6,'0'),'transfer.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,'2026-10-01',
          jsonb_build_object('projects',jsonb_build_array($1::text),'subtitleCodes',jsonb_build_array('TRANSFER'),
            'lines',jsonb_build_array('LINE-'||(n%10)),'methodCodes',jsonb_build_array('ВИК'),'sourceKind','base')::text
        from generate_series(1,$2::int) n cross join (values ('weldingJournal'),('system:lnkRequest')) t(kind)`, [project, count])
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        select d.id,w.id from generated_documents d join weld_joints w on w.joint='F'||((right(d.title,6)::int-1)%100+1)
        where w.project_title=$1 and d.title like 'TRANSFER-%'`, [project])
      for (const name of ['weld_joints', 'generated_documents', 'generated_document_weld_joints']) await db.query(`analyze ${name}`)
    })
    for (const kind of ['generated', 'system'] as const) {
      const first = await read(kind, {})
      expect(first.total).toBe(count)
      const original = pg.Client.prototype.query
      let statements = 0
      pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
        statements++
        return (original as (...values: unknown[]) => unknown).apply(this, args)
      } as typeof original
      try {
        const idsStart = performance.now()
        const ids = await read(kind, { idsOnly: true, revision: first.revision })
        expect(ids.rows).toEqual([]); expect(ids.ids).toHaveLength(count)
        expect(statements).toBe(kind === 'generated' ? 2 : 5)
        measurements.push({ kind, count, joints: 100, name: 'full-ids', statements,
          milliseconds: performance.now() - idsStart, bytes: Buffer.byteLength(JSON.stringify(ids)) })
        const scenarios: Array<{ name: string; request: Partial<DocumentHistoryGridRequest> }> = [
          { name: 'groups', request: { rowGroupCols: ['line'] } },
          { name: 'distant-cells', request: { startRow: count - 500, endRow: count, cells: { columns: ['title', 'rowCount'] } } },
          { name: 'whole-summary', request: { endRow: count, cells: { columns: ['title', 'rowCount'], summary: true } } },
          { name: 'partial-counts', request: { selectedIds: ids.ids!.slice(0, count / 2), rowGroupCols: ['line'], countRoutes: [[], ['["value","LINE-1"]']], cells: { columns: ['title'], summary: true } } },
        ]
        for (const { name, request } of scenarios) {
          statements = 0
          const start = performance.now(), result = await read(kind, { ...request, revision: first.revision })
          const milliseconds = performance.now() - start, bytes = Buffer.byteLength(JSON.stringify(result))
          expect(statements).toBe(kind === 'generated' ? 2 : 5)
          expect(result.total).toBe(count)
          if (name === 'groups') {
            expect(result.rows).toHaveLength(10)
            expect(result.rows.every(row => isDocumentHistoryGroupRow(row) && row.childCount === count / 10)).toBe(true)
          } else if (name === 'distant-cells') {
            expect(result.rows).toEqual([]); expect(result.cells).toHaveLength(500)
            expect(result.cells!.every(row => typeof row[0] === 'string' && row[1] === 1)).toBe(true)
          } else if (name === 'whole-summary') {
            expect(result.rows).toEqual([])
            expect(result.summary).toEqual({ count: count * 2, numericCount: count, sum: count, average: 1 })
          } else {
            expect(result.counts?.['[]']).toBe(count / 2)
            expect(result.matchingSelectedIds).toBeUndefined()
            expect(bytes).toBeLessThan(1000)
          }
          expect(bytes).toBeLessThan(400000)
          measurements.push({ kind, count, joints: 100, name, statements, milliseconds, bytes })
        }
      } finally { pg.Client.prototype.query = original }
    }
  }
  console.info('DOCUMENT_TRANSFER_SCALE', JSON.stringify(measurements))
  await info.attach('document-transfer-cardinality', { body: JSON.stringify(measurements), contentType: 'application/json' })
})
