import { expect, test } from '@playwright/test'
import pg from 'pg'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { withE2eDatabase } from '../database'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-table-filtering'
import { isDocumentHistoryGroupRow, type DocumentHistoryGridRequest } from '../../src/lib/document-history-grid'
import { loadRemoteGeneratedDocumentHistoryGrid, normalizeGeneratedDocumentHistoryGridRequest } from '../../src/server/generated-documents'
import { loadIndexedSystemDocumentHistoryGrid, loadIndexedSystemDocumentHistoryFilterOptions, loadSystemDocumentSummaries } from '../../src/server/system-document-index'
import { normalizeSystemDocumentHistoryGridRequest, normalizeSystemDocumentHistoryFilterOptionsRequest } from '../../src/server/system-documents'
import { requireDb } from '../../src/db'
import { deleteWeldJoint, deleteWeldJoints } from '../../src/server/weld-mutations'
import { deleteEmptyGeneratedDocuments, loadGeneratedDocumentIdsForWeldDeletion } from '../../src/server/generated-document-cleanup'
import { SYSTEM_DOCUMENT_TYPES, type SystemDocumentType } from '../../src/lib/system-document-types'

const project = 'E2E independent document cardinality'
const defaults: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
const columnFilters = { project: buildWeldColumnValueFilter([project]) }
const manual = ['weldingJournal', 'checklist', 'zni'] as const

// Every source position has a real relation/fact. Document cardinality is not
// inferred from the number of welds: sizes 2/10/20, two NK methods, before-TO
// controls and two historical repeat cycles are varied independently.
async function seed() {
  for (const type of SYSTEM_DOCUMENT_TYPES) await loadSystemDocumentSummaries(type)
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int n from weld_joints')).rows[0].n).toBe(1)
    expect((await db.query('select count(*)::int n from generated_documents')).rows[0].n).toBe(0)
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,officiality,revision_actuality,
      has_vik,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,vik_result,
      rk_request,rk_request_date,rk_conclusion,rk_conclusion_date,rk_result,
      psto_required,psto_request,psto_request_date,psto_date,heat_treatment_diagram,psto_result,
      tvmt_request,tvmt_request_date,tvmt_conclusion,tvmt_conclusion_date,tvmt_result)
      select $1,'CARD','L'||lpad(((n-1)/100+1)::text,4,'0'),'F'||n,n::text,'2026-08-20','действующий','актуальная',
        'да','NK-'||((n-1)/2+1),'2026-09-02','VIK-'||((n-1)/2+1),'2026-09-03','годен',
        'NK-'||((n-1)/2+1),'2026-09-02','RK-'||((n-1)/2+1),'2026-09-03','годен',
        'да','PSTOR-'||((n-1)/20+1),'2026-09-04','2026-09-05','PSTOC-'||((n-1)/20+1),'выполнено',
        'TVMTR-'||((n-1)/20+1),'2026-09-05','TVMTC-'||((n-1)/20+1),'2026-09-06',case when n<=10000 then 'не годен' else 'годен' end
      from generate_series(1,200000) n`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,conclusion_name,conclusion_date,result)
      select id,m,'PRE-NK-'||((isometry::int-1)/10+1),'2026-08-28','PRE-'||m||'-'||((isometry::int-1)/10+1),'2026-08-29','годен'
      from weld_joints cross join unnest(array['ВИК','РК']) m where project_title=$1`, [project])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,heat_treatment_diagram,psto_result,
      tvmt_request,tvmt_request_date,tvmt_conclusion,tvmt_conclusion_date,tvmt_result)
      select id,s,'REP-PSTOR-'||s||'-'||((isometry::int-1)/2+1),date '2026-09-10'+(s-2)*3,date '2026-09-11'+(s-2)*3,
        'REP-PSTOC-'||s||'-'||((isometry::int-1)/2+1),'выполнено',
        'REP-TVMTR-'||s||'-'||((isometry::int-1)/2+1),date '2026-09-11'+(s-2)*3,'REP-TVMTC-'||s||'-'||((isometry::int-1)/2+1),date '2026-09-12'+(s-2)*3,case when s=2 then 'не годен' else 'годен' end
      from weld_joints cross join generate_series(2,3) s where project_title=$1 and isometry::int<=10000`, [project])
    await db.query(`create temporary table cardinality_positions(storage text,title text,weld_id int,line text,
      kind text,relation_id int,sequence int,method text,event_date date)`)
    for (const [storage, prefix, size] of [
      ['weldingJournal', 'J2', 2], ['weldingJournal', 'J10', 10], ['checklist', 'CL', 10], ['zni', 'ZNI', 10],
    ] as const) await db.query(`insert into cardinality_positions
      select $2,$3||'-'||((isometry::int-1)/$4::int+1),id,line,null,null,null,null,weld_date from weld_joints where project_title=$1`, [project, storage, prefix, size])
    for (const [storage, field, method, dateField] of [
      ['lnkRequest', 'vik_request', 'ВИК', 'vik_request_date'], ['lnkRequest', 'rk_request', 'РК', 'rk_request_date'],
      ['lnkConclusionVik', 'vik_conclusion', 'ВИК', 'vik_conclusion_date'], ['lnkConclusionRk', 'rk_conclusion', 'РК', 'rk_conclusion_date'],
      ['pstoRequest', 'psto_request', null, 'psto_request_date'], ['pstoConclusion', 'heat_treatment_diagram', null, 'psto_date'],
      ['tvmtRequest', 'tvmt_request', 'ТВМТ', 'tvmt_request_date'], ['tvmtConclusion', 'tvmt_conclusion', 'ТВМТ', 'tvmt_conclusion_date'],
    ] as const) await db.query(`insert into cardinality_positions
      select $2,${field},id,line,null,null,null,$3,${dateField} from weld_joints where project_title=$1`, [project, `system:${storage}`, method])
    for (const [storage, field, method, dateField] of [
      ['lnkRequest', 'request_name', 'ВИК', 'request_date'], ['lnkRequest', 'request_name', 'РК', 'request_date'],
      ['lnkConclusionVik', 'conclusion_name', 'ВИК', 'conclusion_date'], ['lnkConclusionRk', 'conclusion_name', 'РК', 'conclusion_date'],
    ] as const) await db.query(`insert into cardinality_positions
      select $2,c.${field},w.id,w.line,'beforeHeatTreatment',c.id,null,c.method,c.${dateField}
      from pre_heat_treatment_controls c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 and c.method=$3`, [project, `system:${storage}`, method])
    for (const [storage, field, method, dateField] of [
      ['pstoRequest', 'psto_request', null, 'psto_request_date'], ['pstoConclusion', 'heat_treatment_diagram', null, 'psto_date'],
      ['tvmtRequest', 'tvmt_request', 'ТВМТ', 'tvmt_request_date'], ['tvmtConclusion', 'tvmt_conclusion', 'ТВМТ', 'tvmt_conclusion_date'],
    ] as const) await db.query(`insert into cardinality_positions
      select $2,c.${field},w.id,w.line,'pstoCycle',c.id,c.sequence,$3,c.${dateField}
      from psto_repeat_cycles c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1`, [project, `system:${storage}`, method])
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
      select storage,title,'cardinality.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',min(event_date),max(event_date),count(distinct weld_id),
        jsonb_strip_nulls(jsonb_build_object('sourceKind',min(kind),'label',storage,
          'projects',jsonb_build_array($1::text),'subtitleCodes',jsonb_build_array('CARD'),'lines',jsonb_agg(distinct line),
          'positionCount',count(*),'methodCodes',coalesce(jsonb_agg(distinct method) filter(where method is not null),'[]'::jsonb),
          'cycleSequences',coalesce(jsonb_agg(distinct sequence) filter(where sequence is not null),'[]'::jsonb),
          'sourcePositions',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind',kind,'weldJointId',weld_id,
            'relationId',relation_id,'sequence',sequence,'methodCode',method))) filter(where kind is not null),'[]'::jsonb)))::text
      from cardinality_positions group by storage,title`, [project])
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select distinct d.id,p.weld_id from cardinality_positions p join generated_documents d on d.type=p.storage and d.title=p.title`)
    const counts = (await db.query(`select (select count(*)::int from generated_documents) documents,
      (select count(*)::int from generated_document_weld_joints) relations,
      (select count(*)::int from cardinality_positions) positions`)).rows[0]
    expect(counts).toEqual({ documents: 600000, relations: 2880000, positions: 3280000 })
    console.log(JSON.stringify({ phase: 'document cardinality fixture', joints: 200000, ...counts }))
    for (const table of ['weld_joints', 'generated_documents', 'generated_document_weld_joints']) await db.query(`analyze ${table}`)
  })
}

test(`${process.env.AUDIT_DOCUMENT_PLANS_ONLY === '1' ? 'PLAN DIAGNOSTIC ONLY: ' : ''}600k documents: independent registry cardinality, methods, stages, history and bounded browser blocks`, async ({ page }, info) => {
  test.skip(process.env.AUDIT_DOCUMENT_CARDINALITY !== '1', 'Requires a fresh owned disposable local database')
  test.setTimeout(1_200_000)
  await seed()
  const measurements: unknown[] = []
  const plans: Array<{type:string;text:string;values:unknown[]}> = []
  const plansOnly = process.env.AUDIT_DOCUMENT_PLANS_ONLY === '1'
  if (plansOnly) expect(process.env.AUDIT_DOCUMENT_EXPLAIN).toBe('1')
  const read = (type: string, request: Partial<DocumentHistoryGridRequest> = {}) => manual.includes(type as typeof manual[number])
    ? loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest({ ...defaults, ...request, type: type as typeof manual[number], columnFilters }))
    : loadIndexedSystemDocumentHistoryGrid(normalizeSystemDocumentHistoryGridRequest({ ...defaults, ...request, type: type as SystemDocumentType, columnFilters }))
  for (const [type, total, search] of [['weldingJournal', 120000, 'J2-100000'], ['checklist', 20000, 'CL-20000'], ['zni', 20000, 'ZNI-20000'],
    ['lnkRequest', 140000, 'NK-100000'], ['lnkConclusion', 260000, 'RK-100000'],
    ['pstoRequest', 20000, 'REP-PSTOR-3-5000'], ['pstoConclusion', 20000, 'REP-PSTOC-3-5000']] as const) {
    if (plansOnly && !['weldingJournal','lnkConclusion'].includes(type)) continue
    const first = await read(type, { endRow: 500 })
    expect(first.total).toBe(total)
    const original = pg.Client.prototype.query
    let statements = 0
    let longestQuery = {text:'',values:[] as unknown[]}
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      statements++
      const text = typeof args[0] === 'string' ? args[0] : (args[0] as {text?:string})?.text ?? ''
      if (text.length > longestQuery.text.length) longestQuery = {text,values:Array.isArray(args[1]) ? args[1] : []}
      return (original as (...values: unknown[]) => unknown).apply(this, args)
    } as typeof original
    try {
      for (const [path, request] of [
        ['last-block', { startRow: total - 100, endRow: total, sortModel: [{ colId: 'title', sort: 'asc' }] }],
        ['groups', { rowGroupCols: ['line'] }],
        ['search', { search }],
        ...[10, 100, 500].map(n => [`selection-${n}`, { selectionOnly: true, selectedIds: first.rows.slice(0, n).map(row => row.id) }] as const),
      ] as Array<readonly [string, Partial<DocumentHistoryGridRequest>]>) {
        if (plansOnly && path !== 'groups') continue
        statements = 0
        longestQuery = {text:'',values:[]}
        const start = performance.now(), result = await read(type, request)
        const bytes = Buffer.byteLength(JSON.stringify(result))
        expect(result.total).toBe(path === 'search' ? 1 : total)
        expect(statements).toBeLessThanOrEqual(5)
        expect(bytes).toBeLessThan(1_000_000)
        expect(result.rows.length).toBe(path.startsWith('selection-') ? Number(path.split('-')[1]) : path === 'search' ? 1 : 100)
        if (path === 'groups') { expect(result.rowCount).toBe(2000); expect(result.rows.every(isDocumentHistoryGroupRow)).toBe(true) }
        measurements.push({ type, path, milliseconds: Math.round(performance.now() - start), statements, bytes, total })
        console.log(JSON.stringify({ phase: 'document cardinality read', ...measurements.at(-1) as object }))
        if (path === 'groups' && ['weldingJournal','lnkConclusion'].includes(type)) plans.push({type,...longestQuery})
      }
    } finally { pg.Client.prototype.query = original }
  }
  if (process.env.AUDIT_DOCUMENT_EXPLAIN === '1') {
    for (const query of plans) {
      expect(query.text.trim()).toMatch(/^(select|with)\b/i)
      const plan = await withE2eDatabase(db => db.query('explain (analyze,buffers,format json) ' + query.text, query.values))
      await writeFile(info.outputPath('document-plan-' + query.type + '.json'),JSON.stringify({query,plan:plan.rows},null,2))
    }
  }
  if (process.env.AUDIT_DOCUMENT_COMPARE_PLANS) {
    const comparison: unknown[] = []
    for (const current of plans) {
      const saved = JSON.parse(await readFile(resolve(process.env.AUDIT_DOCUMENT_COMPARE_PLANS, 'document-plan-' + current.type + '.json'), 'utf8'))
      const previous = saved.query as typeof current
      expect(previous.type).toBe(current.type)
      expect(previous.text.trim()).toMatch(/^(select|with)\b/i)
      expect(previous.values).toEqual(current.values)
      await withE2eDatabase(async db => {
        const before = await db.query(previous.text, previous.values)
        const after = await db.query(current.text, current.values)
        expect(after.rows).toEqual(before.rows)
        for (const [iteration, query] of [previous, current, current, previous, previous, current].entries()) {
          const result = await db.query('explain (analyze,buffers,format json) ' + query.text, query.values)
          const plan = result.rows[0]['QUERY PLAN'][0]
          const measurement = { type: current.type, variant: query === current ? 'current' : 'previous', iteration,
            milliseconds: plan['Execution Time'], planning: plan['Planning Time'] }
          comparison.push(measurement)
          console.log(JSON.stringify({ phase: 'paired group query', ...measurement }))
        }
      })
    }
    await writeFile(info.outputPath('document-group-query-comparison.json'), JSON.stringify(comparison, null, 2))
  }
  if (plansOnly) return
  const stages = await loadIndexedSystemDocumentHistoryFilterOptions(normalizeSystemDocumentHistoryFilterOptionsRequest({ type: 'lnkRequest', fieldKey: 'stage', columnFilters }))
  expect(Object.fromEntries(stages.options.map(option => [option.value, option.count]))).toEqual({ 'Основной': 100000, 'До ТО': 20000, 'Цикл 1': 10000, 'Цикл 2': 5000, 'Цикл 3': 5000 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  const cdp = await page.context().newCDPSession(page)
  try {
    // The UI gives TVMT its own tab; the lower-level lnkRequest API also holds
    // those 20000 documents, checked above. This tab contains main/pre-TO NK.
    for (const [kind, total] of [['generated:weldingJournal', 120000], ['system:lnkRequest:', 120000]] as const) {
      if (kind.startsWith('system')) await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
      const grid = page.locator(`[data-document-history-grid^="${kind}"]`)
      await expect(grid.getByText(`Найдено: ${total}`, { exact: true })).toBeVisible({ timeout: 120000 })
      for (const fraction of [0, .2, .4, .6, .8, 1, 0]) {
        await grid.locator('.ag-grid-viewport').evaluate((element, value) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * value }, fraction)
        await expect.poll(() => grid.locator('.ag-row[row-id^="document:"]').count(), { timeout: 120000 }).toBeGreaterThan(0)
        await expect(grid.locator('.ag-row-loading')).toHaveCount(0, { timeout: 120000 })
        await page.waitForLoadState('networkidle')
        const indices = await grid.locator('.ag-row[row-id^="document:"]').evaluateAll(elements => elements.map(element => Number(element.getAttribute('row-index'))))
        // Prove that the browser actually visits distant blocks, rather than
        // measuring the first viewport repeatedly after a no-op scroll.
        if (fraction) expect(Math.max(...indices)).toBeGreaterThanOrEqual(Math.floor((total - 1) * fraction) - 100)
        else expect(Math.min(...indices)).toBe(0)
        await cdp.send('HeapProfiler.collectGarbage')
        const heap = await cdp.send('Runtime.getHeapUsage')
        const rows = await grid.locator('.ag-row[row-id^="document:"]').count()
        expect(rows).toBeGreaterThan(0); expect(rows).toBeLessThan(60)
        const loaded = Number((await grid.locator('.document-grid-footer').getByText(/^Загружено:/).innerText()).replace('Загружено:', '').trim())
        expect(loaded).toBeLessThanOrEqual(500)
        measurements.push({ kind, fraction, rows, loaded, firstIndex: Math.min(...indices), lastIndex: Math.max(...indices), heap: heap.usedSize })
      }
    }
    expect(errors).toEqual([])
  } finally {
    await cdp.detach()
    console.log(JSON.stringify({ phase: 'document cardinality measurements', measurements }))
    await info.attach('document-cardinality', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  }

  // Measure the real cleanup on a complete registry, including the case where
  // no documents need deleting. Roll back each probe before operator mutations.
  const rollbackProbe = new Error('rollback document cleanup measurement')
  const cleanupTargets = await withE2eDatabase(async db => (await db.query<{id:number}>(
    "select id from weld_joints where project_title=$1 and isometry='1'",[project])).rows.map(row=>row.id))
  for (let repeat = 0; repeat < 3; repeat++) {
    const start = performance.now()
    await expect(requireDb().transaction(async tx => {
      const documentIds = await loadGeneratedDocumentIdsForWeldDeletion(tx,cleanupTargets)
      await deleteEmptyGeneratedDocuments(tx,documentIds)
      throw rollbackProbe
    })).rejects.toBe(rollbackProbe)
    console.log(JSON.stringify({ phase: '600k empty-document cleanup', repeat, milliseconds: Math.round(performance.now() - start) }))
  }
  const beforeDelete = await withE2eDatabase(async db => {
    const targets = (await db.query<{ id: number; version: string }>(
      "select id,xmin::text version from weld_joints where project_title=$1 and isometry in ('1','2') order by isometry::int", [project])).rows
    expect(targets).toHaveLength(2)
    const ids = targets.map(row => row.id)
    const affected = (await db.query<{ id: number; survivors: number }>(`select a.document_id id,
      count(*) filter(where not a.weld_joint_id=any($1::int[]))::int survivors
      from generated_document_weld_joints a where a.document_id in
        (select document_id from generated_document_weld_joints where weld_joint_id=any($1::int[])) group by a.document_id`, [ids])).rows
    return { targets, affected }
  })
  for (const [index, target] of beforeDelete.targets.entries()) {
    const start = performance.now()
    if (index === 0) await deleteWeldJoint({ data: target })
    else await deleteWeldJoints({ data: { targets: [target] } })
    console.log(JSON.stringify({ phase: '600k registry joint deletion', mode: index ? 'bulk' : 'single', milliseconds: Math.round(performance.now() - start) }))
  }
  await withE2eDatabase(async db => {
    const removed = beforeDelete.affected.filter(row => row.survivors === 0).map(row => row.id)
    expect(removed.length).toBeGreaterThan(0)
    expect((await db.query('select count(*)::int n from generated_documents')).rows[0].n).toBe(600000 - removed.length)
    expect((await db.query('select id from generated_documents where id=any($1::int[])', [removed])).rows).toEqual([])
    const surviving = (await db.query<{ id: number; survivors: number }>(`select document_id id,count(*)::int survivors
      from generated_document_weld_joints where document_id=any($1::int[]) group by document_id order by document_id`,
    [beforeDelete.affected.map(row => row.id)])).rows
    expect(surviving).toEqual(beforeDelete.affected.filter(row => row.survivors > 0).sort((a, b) => a.id - b.id))
    const positions = (await db.query<{ source_metadata: string }>(`select source_metadata from generated_documents
      where id=any($1::int[]) and source_metadata is not null`, [surviving.map(row => row.id)])).rows
    for (const { source_metadata } of positions) {
      expect((JSON.parse(source_metadata).sourcePositions ?? []).some((position: { weldJointId: number }) =>
        beforeDelete.targets.some(target => target.id === position.weldJointId))).toBe(false)
    }
  })
})
