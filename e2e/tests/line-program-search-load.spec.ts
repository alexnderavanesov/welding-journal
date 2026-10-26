import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { observeMixedClient, sampleMixedResources } from '../mixed-resource-telemetry'
import { rpcName } from '../rpc'

const project = 'E2E line search 200k'
const clock = () => performance.now()
const elapsed = (start: number) => Math.round(clock() - start)

test('200k: first complete lines and independent search before the full summary finishes', async ({ browser }, info) => {
  test.skip(process.env.AUDIT_LINE_SEARCH_LOAD !== '1', 'Opt-in fresh isolated database and explicitly resource-limited server')
  test.setTimeout(900_000)
  const totalLines = await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int n from weld_joints')).rows[0].n).toBe(1)
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'SEARCH','SEARCH-L'||lpad(n::text,4,'0'),'II','A',10,0 from generate_series(1,1000) n`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,stamp_1_k,has_vik)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||lpad(n::text,6,'0'),'2026-09-01',
        'действующий','актуальная','С17','SEARCH-STAMP','да'
      from generate_series(1,200000) n join line_programs p on p.project_title=$1
        and p.line='SEARCH-L'||lpad(((n-1)/200+1)::text,4,'0')`, [project])
    await db.query('analyze weld_joints')
    return (await db.query('select count(*)::int n from line_programs')).rows[0].n as number
  })
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({
    baseURL: 'http://127.0.0.1:3100', viewport: { width: 1600, height: 1000 },
  })))
  const clients = contexts.map((context, i) => observeMixedClient(context, `line-search-${i}`))
  const pages = await Promise.all(contexts.map(context => context.newPage()))
  const measurements: Record<string, unknown>[] = []
  const record = (value: Record<string, unknown>) => {
    measurements.push(value); console.log(JSON.stringify({ phase: 'line search timing', ...value }))
  }
  const stopResources = await sampleMixedResources(browser)
  try {
    const fullRequests = pages.map(page => page.waitForRequest(request => rpcName(request.url()).startsWith('getLineProgramSection_')))
    // No artificial delays: compare first rows and the old full calculation in
    // the same real browser session, with three clients sharing the cold cache.
    await Promise.all(pages.map(async (page, i) => {
      const start = clock()
      let fullFinished = false
      const full = fullRequests[i].then(async request => {
        const response = await request.response()
        expect(response?.ok()).toBe(true)
        await response!.finished(); fullFinished = true
        record({ action: 'old full section completed', client: i, milliseconds: elapsed(start) })
      })
      await page.goto('/line-program')
      await expect(page.getByTestId('line-program-card')).toHaveCount(30)
      record({ action: 'cold first 30 lines', client: i, milliseconds: elapsed(start), fullFinished })
      expect(fullFinished).toBe(false)
      await fullRequests[i]
      const searchStart = clock(), term = `SEARCH-L${String(998 + i).padStart(4, '0')}`
      await page.getByLabel('Поиск программы линий').fill(term)
      const card = page.getByTestId('line-program-card')
      await expect(card).toHaveCount(1)
      await expect(card.getByTestId('line-name')).toHaveText(term)
      await expect(card.getByRole('button', { name: 'Учитываемых соединений 200', exact: true })).toBeVisible()
      record({ action: 'search during old full calculation', client: i, milliseconds: elapsed(searchStart), fullFinished })
      const totals = page.getByLabel('Итоги раздела')
      await expect(totals.getByRole('button', { name: 'Линий 1', exact: true })).toBeVisible()
      await expect(totals.getByRole('button', { name: 'К назначению 20', exact: true })).toBeVisible()
      record({ action: 'searched line totals ready', client: i, milliseconds: elapsed(searchStart) })
      await full
      await expect(card).toHaveCount(1)
      await expect(card.getByTestId('line-name')).toHaveText(term)
      const before = clients[i].calls.length
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
      await page.waitForTimeout(700)
      expect(clients[i].calls.slice(before).filter(call => /^getLineProgram/.test(call.name))).toEqual([])
      expect(clients[i].calls.filter(call => /^getLineProgramPage_/.test(call.name))).toHaveLength(2)
      expect(clients[i].calls.filter(call => /^getLineProgramSection_/.test(call.name))).toHaveLength(2)
    }))
    const start = clock()
    await pages[0].reload()
    await expect(pages[0].getByTestId('line-program-card')).toHaveCount(30)
    record({ action: 'warm reload first 30 lines', milliseconds: elapsed(start) })
    await expect(pages[0].getByLabel('Итоги раздела').getByRole('button', { name: `Линий ${totalLines}`, exact: true })).toBeVisible()
    record({ action: 'warm complete section ready', milliseconds: elapsed(start) })
    const counts = JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE!, 'utf8'))
    // A complete line is indivisible, but these 200-joint lines fit bounded
    // batches. No browser receives 200k joints and no full table is hydrated.
    const reads = counts.resources.reads.weld_joints_join_line_programs
    expect(reads.maxWideRows).toBeLessThanOrEqual(10_000)
    // 20 full batches, one early page, two single-line reads per search,
    // and two count queries. Three users share the same initial calculation.
    expect(reads.calls).toBeLessThanOrEqual(20 + 1 + 3 * 2 + 2)
    expect(counts.resources.reads.line_programs.calls).toBeLessThanOrEqual(2 + 3 * 2)
    record({ action: 'server query bounds', statements: counts.statements, reads: counts.resources.reads })

    const retainedSignature = () => withE2eDatabase(async db => (await db.query(`select count(*)::int n,
      md5(string_agg(concat(c.payload,':',c.computed_at::text),',' order by c.cache_key)) signature
      from derived_calculation_cache c join line_programs p on p.id=(c.payload::jsonb->>'lineId')::int
      where c.cache_key like 'line-program-overview:%' and p.project_title=$1 and p.line<>'SEARCH-L0001'`, [project])).rows[0])
    const unchanged = await retainedSignature()
    expect(unchanged.n).toBe(999)
    const first = pages[0].getByTestId('line-program-card').filter({ has: pages[0].getByTestId('line-name').filter({ hasText: /^SEARCH-L0001$/ }) })
    await first.getByRole('button', { name: 'Настроить', exact: true }).click()
    const editor = pages[0].getByRole('dialog', { name: 'Настройка линии' })
    await editor.getByLabel('Базовый % контроля', { exact: true }).fill('15')
    const changedStart = clock()
    await editor.getByRole('button', { name: 'Сохранить программу', exact: true }).click()
    await expect(editor).toBeHidden()
    await pages[0].reload()
    await expect(pages[0].getByTestId('line-program-card')).toHaveCount(30)
    await expect(pages[0].getByLabel('Итоги раздела').getByRole('button', { name: `Линий ${totalLines}`, exact: true })).toBeVisible()
    record({ action: 'save one line and reload complete 200k summary', milliseconds: elapsed(changedStart) })
    expect(await retainedSignature()).toEqual(unchanged)
    await pages[0].getByLabel('Поиск программы линий').fill('SEARCH-L0001')
    await expect(pages[0].getByTestId('line-program-card')).toHaveCount(1)
    await expect(pages[0].getByLabel('Итоги раздела').getByRole('button', { name: 'К назначению 30', exact: true })).toBeVisible()
    // Let the telemetry's periodic flush catch up, then assert transport/query
    // bounds, not a machine-dependent deadline. No other line may be hydrated.
    await pages[0].waitForTimeout(700)
    const afterChange = JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE!, 'utf8'))
    const changedReads = afterChange.resources.reads.weld_joints_join_line_programs
    expect(changedReads.calls - reads.calls).toBeGreaterThan(0)
    expect(changedReads.calls - reads.calls).toBeLessThanOrEqual(4)
    expect(changedReads.rows - reads.rows).toBeLessThanOrEqual(800)
    record({ action: 'unchanged lines retained after edit', retainedLines: unchanged.n,
      additionalLineReads: changedReads.calls - reads.calls, additionalRows: changedReads.rows - reads.rows })
    for (const client of clients) expect(client.errors).toEqual([])
  } finally {
    console.log(JSON.stringify({ phase: 'line search resources', ...await stopResources() }))
    for (const client of clients) console.log(JSON.stringify({ phase: 'line search client', ...await client.summary() }))
    await info.attach('line-search-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
    await Promise.all(contexts.map(context => context.close()))
  }
})
