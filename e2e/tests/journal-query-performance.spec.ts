import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import type { JournalGridRequest, JournalGridResult } from '../../src/lib/journal-server-grid'
import { getReportOrderBy } from '../../src/server/weld-read'
import { weldJoints } from '../../src/db/schema'
import { journalNaturalPageIds } from '../../src/server/journal-natural-page'
import { measureJournalQueriesInSafari } from '../journal-query-safari'

const enabled = process.env.JOURNAL_QUERY_BENCHMARK === '1'
test.skip(!enabled, 'Opt-in isolated comparison of query changes')
test.use({ trace: 'off', video: 'off' })
const project = 'E2E Query Performance'
const total = process.env.SMOOTH_JOINT_COUNT === '200000' ? 200_000 : 9000
let other: string | undefined
test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(300_000)
  await withLineProgramFixture(async db => {
    if (process.env.JOURNAL_QUERY_BEFORE_INDEX === '1') {
      await db.query('drop index if exists weld_joints_natural_joint_asc_idx, weld_joints_natural_joint_desc_idx')
    }
    other = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}') on conflict(key) do update set value=excluded.value`)
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,isometry,officiality,connection_type,wdi)
      select $1,'QUERY','QUERY-'||lpad(((n-1)/300)::text,4,'0'),'F'||n,
        date '2026-10-01'+(n%20),'ISO-'||lpad((n%100)::text,3,'0'),'действующий','СШ',1
      from generate_series(1,$2::int) n`, [project, total])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [project])
    await db.query('analyze weld_joints')
    await db.query('analyze weld_joint_program_states')
  })
})
test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(300_000)
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(db => other === undefined
    ? db.query("delete from app_settings where key='other'")
    : db.query("update app_settings set value=$1 where key='other'", [other]))
})

test('measured filter, sort and group matrix preserves complete selections', async ({ page, browser }, info) => {
  test.setTimeout(600_000)
  let observed = ''
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
  await page.addInitScript(hidden => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [],
  })), WELD_FIELDS.filter(field => !['projectTitle', 'line', 'joint', 'weldDate', 'isometry', 'wdi'].includes(field.key)).map(field => field.key))
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(project)
  await expect(page.getByText(`Найдено: ${total}`, { exact: true })).toBeVisible({ timeout: 240_000 })
  await page.waitForLoadState('networkidle')
  const call = async (data: JournalGridRequest) => {
    const response = await page.request.post(siblingRpcUrl(observed, 'readJournalGrid_createServerFn_handler'), {
      data: await serializeRpcData(data), headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin',
        'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    expect(response.ok()).toBe(true)
    const payload = await deserializeRpcResponse(await response.text()) as { result: JournalGridResult; error?: Error }
    if (payload.error) throw payload.error
    return payload.result
  }
  const samples: object[] = []
  // Same SQL membership, distinct cold keys. Each round also measures reuse
  // after adding a child level and after reopening the same group.
  for (const scope of [project, project.toLowerCase(), project.toUpperCase()]) {
    const base: JournalGridRequest = { columnFilters: { projectTitle: '=' + scope }, groupBy: [], route: [], start: 0, end: 100 }
    const cases: { name: string; request: JournalGridRequest; count: number; joints?: string[] }[] = [
      ...(['asc', 'desc'] as const).map(direction => ({ name: 'sort-joint-' + direction,
        request: { ...base, sort: { fieldKey: 'joint' as const, direction } }, count: total,
        joints: Array.from({ length: 100 }, (_, i) => 'F' + (direction === 'asc' ? i + 1 : total - i)) })),
      { name: 'sort-date', request: { ...base, sort: { fieldKey: 'weldDate', direction: 'desc' } }, count: total },
      { name: 'filter-line', request: { ...base, columnFilters: { ...base.columnFilters, line: buildWeldColumnValueFilter(['QUERY-0001']) } }, count: 300 },
      { name: 'filter-joint', request: { ...base, columnFilters: { ...base.columnFilters, joint: buildWeldColumnValueFilter(['F2', 'F10']) }, sort: { fieldKey: 'joint', direction: 'asc' } }, count: 2, joints: ['F2', 'F10'] },
      { name: 'filter-contains', request: { ...base, columnFilters: { ...base.columnFilters, isometry: 'ISO-007' } }, count: total / 100 },
      { name: 'quick-search', request: { ...base, columnFilters: { ...base.columnFilters, search: 'F' + total } }, count: 1, joints: ['F' + total] },
      { name: 'group-line', request: { ...base, groupBy: ['line'] }, count: Math.ceil(total / 300) },
      { name: 'group-project', request: { ...base, groupBy: ['projectTitle'] }, count: 1 },
      { name: 'group-project-line', request: { ...base, groupBy: ['projectTitle', 'line'] }, count: 1 },
      { name: 'group-numeric', request: { ...base, groupBy: ['wdi'] }, count: 1 },
      { name: 'group-filtered', request: { ...base, columnFilters: { ...base.columnFilters, isometry: 'ISO-007' }, groupBy: ['line'] }, count: Math.ceil(total / 300) },
      ...['open', 'reopen'].map(action => ({ name: 'group-' + action, request: { ...base, groupBy: ['line' as const], route: ['QUERY-0000'], sort: { fieldKey: 'joint' as const, direction: 'asc' as const } }, count: 300,
        joints: Array.from({ length: 100 }, (_, i) => 'F' + (i + 1)) })),
    ]
    for (const item of cases) {
      const before = await auditSqlCount(), detailsBefore = await auditSqlDetails()
      const started = performance.now()
      const result = await call(item.request)
      const milliseconds = performance.now() - started
      expect(result.rowCount, item.name).toBe(item.count)
      if (item.joints) expect(result.rows.map(row => row.joint), item.name).toEqual(item.joints)
      if (item.name === 'group-project' || item.name === 'group-project-line' || item.name === 'group-numeric') {
        expect(result.rows[0].journalGroup?.summary).toMatchObject({ joints: total, wdi: total })
      }
      if (item.name === 'group-line') expect(result.rows[0].journalGroup?.summary).toMatchObject({ joints: 300, wdi: 300 })
      const after = await auditSqlCount(), detailsAfter = await auditSqlDetails()
      const statements = before === undefined || after === undefined ? undefined : after - before
      if (statements !== undefined) expect(statements, item.name).toBeLessThanOrEqual(26)
      samples.push({ name: item.name, scope, milliseconds, statements, detailsBefore, detailsAfter })
    }
  }
  // Plans are collected outside timed work, on the disposable DB only.
  const plans: object[] = []
  const indexWrites: object[] = []
  let indexSizes: object[] = []
  await withE2eDatabase(async db => {
    for (const direction of ['asc', 'desc'] as const) {
      const where = sql`lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = lower(${project})`
      const order = getReportOrderBy('weldingJournal', { fieldKey: 'joint', direction })
      const query = new PgDialect().sqlToQuery(sql`select ${weldJoints.id} from ${weldJoints}
        where ${weldJoints.id} in ${journalNaturalPageIds(where, order, 100)}
        order by ${sql.join(order, sql`, `)} limit 100`)
      const result = await db.query('explain (analyze, buffers, format json) ' + query.sql, query.params)
      plans.push({ direction, plan: result.rows[0]['QUERY PLAN'] })
    }
    indexSizes = (await db.query(`select indexrelname,pg_relation_size(indexrelid)::int as bytes from pg_stat_user_indexes
      where indexrelname in ('weld_joints_natural_joint_asc_idx','weld_joints_natural_joint_desc_idx') order by indexrelname`)).rows
    if (indexSizes.length === 2) for (const indexed of [false, true, true, false, false, true]) {
      await db.query('begin')
      try {
        // Transactional DDL and fixture writes are rolled back each time.
        // The application has finished reading; no committed state changes.
        if (!indexed) await db.query('drop index weld_joints_natural_joint_asc_idx, weld_joints_natural_joint_desc_idx')
        const started = performance.now()
        await db.query(`insert into weld_joints(project_title,line,joint,isometry)
          select 'E2E query write cost','WRITE','F'||n,'before' from generate_series(1,1000) n`)
        const insertMs = performance.now() - started
        const updateStart = performance.now()
        await db.query(`update weld_joints set isometry='after' where project_title='E2E query write cost'`)
        const notesMs = performance.now() - updateStart
        const nameStart = performance.now()
        await db.query(`update weld_joints set joint=joint||'R1' where project_title='E2E query write cost'`)
        indexWrites.push({ indexed, records: 1000, insertMs, notesMs, namesMs: performance.now() - nameStart })
      } finally { await db.query('rollback') }
    }
  })
  await writeFile(info.outputPath('query-matrix.json'), JSON.stringify({ total, browser: browser.version(), samples, plans, indexSizes, indexWrites, errors }, null, 2))
  expect(errors).toEqual([])
})

test('measured group reopening keeps checked joints and bounds reads', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  await page.addInitScript(() => Object.keys(localStorage).filter(key => key === 'welding-journal-ag-grid:v1' || key.startsWith('welding-user:') && key.endsWith(':welding-journal-ag-grid:v1')).forEach(key => localStorage.removeItem(key)))
  await page.addInitScript(hidden => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [],
  })), WELD_FIELDS.filter(field => !['projectTitle', 'line', 'joint', 'wdi'].includes(field.key)).map(field => field.key))
  const samples: object[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const frame = page.locator('[data-welding-journal-grid] .journal-grid-frame')
  for (let round = 0; round < 3; round++) {
    await page.goto('/journal')
    await page.getByRole('searchbox').fill(project)
    await expect(page.getByText(`Найдено: ${total}`, { exact: true })).toBeVisible({ timeout: 180_000 })
    await expect(frame).toHaveAttribute('aria-busy', 'false')
    await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
    await expect(page.getByRole('button', { name: 'Развернуть группу QUERY-0000', exact: true })).toBeVisible()
    await expect(frame).toHaveAttribute('aria-busy', 'false')
    for (const action of ['open', 'reopen'] as const) {
      await page.waitForLoadState('networkidle')
      calls = []
      const started = performance.now()
      await page.getByRole('button', { name: 'Развернуть группу QUERY-0000', exact: true }).click()
      await expect(page.getByRole('checkbox', { name: 'Выбрать стык F19', exact: true })).toBeVisible()
      await expect(frame).toHaveAttribute('aria-busy', 'false')
      const milliseconds = performance.now() - started
      if (action === 'open') await page.getByRole('checkbox', { name: 'Выбрать стык F19', exact: true }).check()
      else await expect(page.getByRole('checkbox', { name: 'Выбрать стык F19', exact: true })).toBeChecked()
      await page.waitForLoadState('networkidle')
      const blockReads = calls.filter(name => name.startsWith('readJournalGrid_')).length
      if (action === 'reopen' && process.env.JOURNAL_QUERY_BEFORE_INDEX !== '1') expect(blockReads).toBe(0)
      samples.push({ round, action, milliseconds, blockReads, calls: [...calls] })
      await page.getByRole('button', { name: 'Свернуть группу QUERY-0000', exact: true }).click()
      await expect(page.getByRole('checkbox', { name: 'Выбрать стык F19', exact: true })).toHaveCount(0)
    }
  }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('group-reopening.json'), JSON.stringify({ total, browser: browser.version(), samples, errors }, null, 2))
})

test('native Safari query comparison', async ({}, info) => {
  test.skip(process.env.JOURNAL_QUERY_SAFARI !== '1', 'Requires the foreground local SafariDriver window')
  test.setTimeout(300_000)
  const result = await measureJournalQueriesInSafari(project, total, info.outputPath('safari-diagnostic.json'))
  await writeFile(info.outputPath('safari-queries.json'), JSON.stringify(result, null, 2))
})
