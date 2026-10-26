import { expect, test } from '@playwright/test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { invalidateDerivedCalculationCache } from '../../src/server/dispatcher-task-index-dirty'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import type { WeldFilters, WeldReportKind } from '../../src/server/weld-contracts'

const project = 'E2E report filters performance'
test('derived filter benchmark: scopes, cold/warm cache, five readers and DB transport', async ({}, info) => {
  test.skip(process.env.AUDIT_REPORT_FILTERS !== '1', 'Explicit isolated 200k performance profile')
  test.setTimeout(1_200_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  const skew = process.env.AUDIT_REPORT_FILTERS_SKEW === '1'
  const sortWdi = process.env.AUDIT_REPORT_FILTERS_SORT_WDI === '1'
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,group_name,category,
      weld_date,connection_type,d1,t1,wdi,has_vik,has_rk,has_uzk,has_pvk,psto_required,
      vik_result,rk_result,uzk_result,pvk_result,vik_control_basis,rk_control_basis,psto_request,psto_result,
      lnk_defect_description,rk_exposure_confirmed_diameter)
      select $1,'FILTERS','FILTER-'||lpad(((n-1)/5000+1)::text,2,'0'),'F'||n,lpad(n::text,6,'0'),
        case when n<=1000 then 'first1000' end,case when n<=10000 then 'first10000' end,
        '2026-06-01','С17',114,6,4.49,'да','да','да','да','да',
        'годен',case when n%20=0 then 'ремонт' else 'годен' end,
        case when n%30=0 then 'вырез' else 'годен' end,'годен','проект','дополнительный',
        'PSTO-'||n,'проведено','0: ДНО'||chr(10)||'120: ДНО'||chr(10)||'240: ДНО',114
      from generate_series(1,200000) n`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,result,defect_description)
      select id,'РК','PRE-'||isometry,case when isometry::int%40=0 then 'ремонт' else 'годен' end,
        '0: A: B'||chr(10)||'120: ДНО'
      from weld_joints where project_title=$1 and isometry::int%10=0`, [project])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_result,tvmt_request,tvmt_result)
      select id,2,'REPEAT-'||isometry,'проведено','TVMT-'||isometry,'годен'
      from weld_joints where project_title=$1 and isometry::int%20=0`, [project])
    if (skew) await db.query(`update weld_joints set line='ONE-LARGE-LINE',
      lnk_defect_description=repeat('0: long defect description 50%_A'||chr(10),20),
      lnk_note=repeat('Long history ',200) where project_title=$1`, [project])
    if (sortWdi) await db.query(`update weld_joints set
      d1=case when isometry::int%3=0 then null when isometry::int%3=1 then 114 else 245 end,
      wdi=case when isometry::int%3=1 then 99 else 1 end where project_title=$1`, [project])
    for (const table of ['weld_joints', 'pre_heat_treatment_controls', 'psto_repeat_cycles']) await db.query(`analyze ${table}`)
  })
  // An explicit local snapshot can be used for an apples-to-apples baseline.
  const api: typeof import('../../src/server/weld-read') = process.env.REPORT_FILTER_READ_MODULE
    ? await import(pathToFileURL(process.env.REPORT_FILTER_READ_MODULE).href) : await import('../../src/server/weld-read')
  if (process.env.AUDIT_REPORT_FILTERS_PLANS === '1') {
    // Isolate database work from card hydration and dispatcher setup. The
    // fixture and all settings are synthetic and belong to this disposable DB.
    const { requireDb } = await import('../../src/db')
    const { weldJoints } = await import('../../src/db/schema')
    const { sql, asc } = await import('drizzle-orm')
    const { DEFAULT_OTHER_SETTINGS } = await import('../../src/lib/other-settings')
    const { buildCalculatedReportValueSql } = await import('../../src/server/report-calculated-values-sql')
    const table = { fileName: 'cost profile', uploadedAt: '', entries: Array.from({ length: 300 }, (_, i) => ({
      diameter: i + 1, options: Array.from({ length: 4 }, (_, j) => ({
        label: j === 0 ? 'Три снимка' : `Вариант ${j}`, values: j === 0 ? ['0', '120', '240'] : [String(j)],
        isDefault: j === 0, note: '',
      })),
    })) }
    const plans: Record<string, unknown> = {}
    try {
      for (const field of ['pstoCycleSummary', 'pstoRequest', 'pstoDate', 'pstoResult', 'tvmtResult',
        'preVikResult', 'preRkResult', 'preRkExposureScheme', 'controlBasisSummary', 'rkExposureScheme'] as const) {
        const report = field.startsWith('psto') || field.startsWith('tvmt') ? 'heatTreatment' : 'lnk'
        const settings = { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: table }
        const value = buildCalculatedReportValueSql(report, field, settings)!
        const query = requireDb().select({ value: sql`${value}::text`, count: sql`count(*)` }).from(weldJoints)
          .where(sql`${weldJoints.projectTitle} = ${project}`).groupBy(sql`1`)
        const explained = await requireDb().execute(sql`explain (analyze, buffers, format json) ${query}`)
        plans[field] = explained.rows
        console.info('FILTER DATABASE COST:', field, JSON.stringify(explained.rows).match(/Execution Time[^,}]+/)?.[0])
      }
      const pageQuery = requireDb().select({ id: weldJoints.id }).from(weldJoints)
        .where(api.buildReportQueryWhere('heatTreatment', { projectTitle: project, columnFilters: { pstoCycleSummary: 'Повтор' } }, DEFAULT_OTHER_SETTINGS))
        .orderBy(asc(weldJoints.isometry)).limit(101)
      plans.cyclePage = (await requireDb().execute(sql`explain (analyze, buffers, format json) ${pageQuery}`)).rows
      await info.attach('filter-query-plans', { body: JSON.stringify(plans, null, 2), contentType: 'application/json' })
      if (process.env.REPORT_FILTER_METRICS_PATH) await writeFile(process.env.REPORT_FILTER_METRICS_PATH, JSON.stringify(plans, null, 2))
    } finally { await cleanupLineProgramProjects([project]) }
    return
  }
  const { ensureDispatcherTaskIndexFresh, isDispatcherTaskIndexFresh } = await import('../../src/server/dispatcher-task-index')
  expect(isDispatcherTaskIndexFresh(await ensureDispatcherTaskIndexFresh())).toBe(true)
  const measures: Array<Record<string, unknown>> = []
  let dbRows = 0, dbBytes = 0, maxRows = 0, queries = 0, peakRss = 0
  const original = pg.Client.prototype.query
  pg.Client.prototype.query = function(this: pg.Client, ...args: unknown[]) {
    queries++
    type Callback = (error: Error | null, result?: pg.QueryResult) => unknown
    const capture = (result: pg.QueryResult) => {
      dbRows += result.rowCount ?? 0
      maxRows = Math.max(maxRows, result.rowCount ?? 0)
      // Count the JSON array without constructing one potentially >512 MB
      // string; instrumentation must not cause the legacy path's failure.
      dbBytes += 2 + Math.max(0, result.rows.length - 1)
      for (const row of result.rows) dbBytes += Buffer.byteLength(JSON.stringify(row))
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    }
    const observe = (callback: Callback): Callback => (error, result) => { if (result) capture(result); return callback(error, result) }
    if (typeof args[2] === 'function') args[2] = observe(args[2] as Callback)
    else if (typeof args[1] === 'function') args[1] = observe(args[1] as Callback)
    else if (typeof args[0] === 'object' && args[0] && 'callback' in args[0]) {
      const config = args[0] as { callback: Callback }
      args[0] = { ...config, callback: observe(config.callback) }
    }
    const result = (original as (...args: unknown[]) => unknown).apply(this, args)
    return result && typeof (result as Promise<unknown>).then === 'function'
      ? (result as Promise<pg.QueryResult>).then(result => { capture(result); return result }) : result
  } as typeof original
  const value = (text: string) => buildWeldColumnValueFilter([text])
  const page = (report: WeldReportKind, scope: WeldFilters, columnFilters: Record<string, string>, pageSize = 100) =>
    api.listReportPage(report, api.normalizeWeldPageRequest({ projectTitle: project, ...scope, columnFilters,
      page: 1, pageSize: pageSize as 100, includeTotals: false, sort: { fieldKey: 'isometry', direction: 'asc' } }))
  async function measure(name: string, run: () => Promise<unknown>, cold: boolean) {
    if (cold) await withE2eDatabase(db => db.query('delete from derived_calculation_cache'))
    dbRows = dbBytes = maxRows = queries = 0
    const startRss = process.memoryUsage().rss
    peakRss = startRss
    const cpu = process.cpuUsage(), start = performance.now()
    const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 25)
    let result: unknown
    try { result = await run() } finally { clearInterval(timer) }
    const used = process.cpuUsage(cpu)
    measures.push({ name, cold, ms: Math.round(performance.now() - start), queries, dbRows, maxRows, dbBytes,
      cpuMs: Math.round((used.user + used.system) / 1000), peakRss, rssGrowth: peakRss - startRss,
      responseBytes: Buffer.byteLength(JSON.stringify(result)) })
    if (name.startsWith('configured-scheme:') || name.startsWith('wdi-')) {
      assert.equal((result as Awaited<ReturnType<typeof page>>).rows.length, 100, name)
    }
    // Persist completed samples outside the measured interval, including when
    // a legacy comparison later exhausts the worker's heap.
    if (process.env.REPORT_FILTER_METRICS_PATH) await writeFile(process.env.REPORT_FILTER_METRICS_PATH, JSON.stringify(measures, null, 2))
    console.info('REPORT FILTER SAMPLE:', name, measures.at(-1)?.ms, 'ms')
    return result
  }
  async function setOtherSettings(settings: unknown) {
    // Match app-settings.ts: `other` invalidates derived values, not the
    // dispatcher. The general raw weld fixture helper is intentionally broader.
    await withE2eDatabase(async db => {
      await db.query('begin')
      try {
        if (settings) await db.query(`insert into app_settings(key,value) values('other',$1)
          on conflict(key) do update set value=excluded.value`, [JSON.stringify(settings)])
        else await db.query("delete from app_settings where key='other'")
        await invalidateDerivedCalculationCache(drizzle(db))
        await db.query('commit')
      } catch (error) { await db.query('rollback'); throw error }
    })
  }
  try {
    if (sortWdi) {
      for (const mode of ['formula', 'table'] as const) {
        await setOtherSettings({ wdiCalculationMode: mode, wdiTable: {
          fileName: 'sort load', uploadedAt: '', diameters: [114, 245], thicknesses: [6], values: [[8], [2]],
        } })
        for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
          for (const direction of ['asc', 'desc'] as const) {
            for (const pageNumber of [1, 200]) {
              for (let repeat = 0; repeat < 3; repeat++) {
                const result = await measure(`sort-wdi:${report}:${mode}:${direction}:page${pageNumber}:${repeat}`, () =>
                  api.listReportPage(report, api.normalizeWeldPageRequest({ projectTitle: project,
                    columnFilters: { controlBasisSummary: report === 'heatTreatment' ? '=' : 'проект' },
                    page: pageNumber, pageSize: 1000, includeTotals: false, sort: { fieldKey: 'wdi', direction },
                  })), repeat === 0) as Awaited<ReturnType<typeof page>>
                assert.equal(result.rows.length, 1000)
                const expected = pageNumber === 200 ? null : mode === 'formula'
                  ? direction === 'asc' ? 4.49 : 9.65 : direction === 'asc' ? 2 : 8
                for (const row of result.rows) assert.equal(row.wdi ?? null, expected)
                assert.equal(result.hasMore, pageNumber === 1)
                // Facts and related records stay bounded by this page; an SQL
                // sort of the full selection must not transfer every ID/card.
                assert(maxRows <= 8000, `unbounded DB result: ${maxRows}`)
                assert(queries <= 26, `unbounded query count: ${queries}`)
              }
            }
          }
        }
      }
      return
    }
    if (process.env.AUDIT_REPORT_FILTERS_INTERLEAVED === '1') {
      assert(process.env.REPORT_FILTER_BASELINE_MODULE, 'An explicit local baseline snapshot is required')
      const baseline: typeof api = await import(pathToFileURL(process.env.REPORT_FILTER_BASELINE_MODULE).href)
      const versions = [['before', baseline], ['after', api]] as const
      for (const report of ['weldingJournal', 'heatTreatment'] as const) {
        const request = api.normalizeWeldPageRequest({ projectTitle: project, columnFilters: {},
          page: 1, pageSize: 100, includeTotals: false, sort: { fieldKey: 'isometry', direction: 'asc' } })
        for (let repeat=0; repeat<5; repeat++) for (const [, version] of versions) await version.listReportPage(report, request)
        const previous = JSON.parse(JSON.stringify(await baseline.listReportPage(report, request))) as Awaited<ReturnType<typeof page>>
        const current = JSON.parse(JSON.stringify(await api.listReportPage(report, request))) as typeof previous
        if (report === 'heatTreatment') {
          // The old ordinary path built this label before loading repeats.
          // The fixture's repeat is completed; its primary cycle lacks TVMT.
          for (const [index, row] of current.rows.entries()) if (Number(row.isometry) % 20 === 0) {
            expect(row.pstoCycleSummary).toBe('Повтор #2 · цикл завершен')
            expect(previous.rows[index].pstoCycleSummary).toBe('Основной · ожидает заявку ТВМТ')
            previous.rows[index].pstoCycleSummary = row.pstoCycleSummary
          }
        }
        expect(current).toEqual(previous)
        // Reverse each pair to remove a consistent first/second-call bias.
        for (let repeat=0; repeat<20; repeat++) {
          for (const [name, version] of repeat % 2 ? [...versions].reverse() : versions) {
            await measure(`interleaved:${report}:${name}:${repeat}`, () => version.listReportPage(report, request), false)
          }
        }
      }
      return
    }
    if (process.env.AUDIT_REPORT_FILTERS_ORDINARY_RELATED === '1') {
      for (const report of ['weldingJournal', 'heatTreatment'] as const) {
        for (let repeat=0; repeat<5; repeat++) await page(report, {}, {})
        for (let repeat=0; repeat<20; repeat++) await measure(`ordinary:${report}:${repeat}`, () => page(report, {}, {}), false)
      }
      return
    }
    if (process.env.AUDIT_REPORT_FILTERS_ORDINARY === '1') {
      for (let repeat=0; repeat<5; repeat++) await page('lnk', {}, {})
      for (let repeat=0; repeat<20; repeat++) await measure(`ordinary:${repeat}`, () => page('lnk', {}, {}), false)
      return
    }
    if (process.env.AUDIT_REPORT_FILTERS_REPEATS === '1') {
      // Repeat the remaining expensive families independently of the broad
      // inventory, and collect enough warm mixed samples for a useful p95.
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const [name, report, columnFilters] of [
          ['rk', 'lnk', { rkResult: value('ремонт') }],
          ['pre', 'lnk', { preRkResult: value('ремонт') }],
          ['basis', 'lnk', { controlBasisSummary: 'проект' }],
          ['scheme', 'lnk', { rkExposureScheme: 'схема' }],
          ['cycle-summary', 'heatTreatment', { pstoCycleSummary: 'Повтор' }],
          ['ordinary', 'lnk', {}],
        ] as const) await measure(`repeat:${name}:${repeat}`, () => page(report, {}, columnFilters), true)
      }
      for (const size of [3, 300]) {
        await setOtherSettings({ rkExposureTable: { fileName: 'benchmark', uploadedAt: '',
          entries: Array.from({ length: size }, (_, i) => ({ diameter: size === 3 ? [50, 100, 200][i] : i + 1,
            options: Array.from({ length: 4 }, (_, j) => ({ label: j === 0 ? 'Три снимка' : `Вариант ${j}`,
              values: j === 0 ? ['0', '120', '240'] : [String(j)], isDefault: j === 0, note: '' })),
          })),
        } })
        for (let repeat = 0; repeat < 3; repeat++) await measure(`configured-scheme:${size}:${repeat}`, () =>
          page('lnk', {}, { rkExposureScheme: value('Три снимка') }), true)
        for (let repeat = 0; repeat < 20; repeat++) await measure(`configured-scheme:${size}:warm:${repeat}`, () =>
          page('lnk', {}, { rkExposureScheme: value('Три снимка') }), false)
      }
      for (const mode of ['formula', 'table']) {
        await setOtherSettings({ wdiCalculationMode: mode, wdiTable: {
          fileName: 'benchmark', uploadedAt: '', diameters: [100], thicknesses: [5], values: [[7.25]],
        } })
        const wdiPage = () => page('weldingJournal', {}, {
          wdi: value(mode === 'formula' ? '4.49' : '7.25'), preRkResult: value('ремонт'),
        })
        for (let repeat=0; repeat<3; repeat++) await measure(`wdi-${mode}:cold:${repeat}`, wdiPage, true)
        for (let repeat=0; repeat<20; repeat++) await measure(`wdi-${mode}:warm:${repeat}`, wdiPage, false)
      }
      await setOtherSettings(null)
      await page('lnk', {}, { rkResult: value('ремонт') })
      for (let repeat = 0; repeat < 20; repeat++) await measure(`warm:${repeat}`, () =>
        page('lnk', {}, { rkResult: value('ремонт') }), false)
      const mixed = () => Promise.all(Array.from({ length: 5 }, (_, index) =>
        page(index % 2 ? 'heatTreatment' : 'lnk', {}, { [index % 2 ? 'preRkResult' : 'rkResult']: value('ремонт') })))
      await measure('five-readers:cold', mixed, true)
      for (let repeat = 0; repeat < 20; repeat++) await measure(`five-readers:warm:${repeat}`, mixed, false)
      return
    }
    if (skew) {
      for (let repeat=0; repeat<3; repeat++) {
        await measure(`skew:page1000:${repeat}`, () => page('lnk', {}, { rkResult: value('ремонт') }, 1000), true)
        await measure(`skew:late-page:${repeat}`, () => api.listReportPage('lnk', api.normalizeWeldPageRequest({
          projectTitle: project, columnFilters: { preRkResult: value('ремонт') },
          page: 40, pageSize: 100, includeTotals: false, sort: { fieldKey: 'isometry', direction: 'asc' },
        })), true)
      }
      await measure('skew:long-rk-description', () => page('lnk', {}, { rkExposureScheme: 'схема' }), true)
      await measure('skew:lnk-summary', () => api.getWeldReportSummary({ data: {
        report: 'lnk', projectTitle: project, columnFilters: { rkResult: value('ремонт') },
      } }), true)
      await measure('skew:output500', () => api.listReportPage('lnk', api.normalizeWeldPageRequest({
        projectTitle: project, category: 'first10000', columnFilters: { rkResult: value('ремонт') },
        pageSize: 'all', includeTotals: false, sort: { fieldKey: 'isometry', direction: 'asc' },
      })), true)
      for (const mode of ['formula', 'table']) {
        const settings = { wdiCalculationMode: mode, wdiTable: {
          fileName: 'benchmark', uploadedAt: '', diameters: [100], thicknesses: [5], values: [[7.25]],
        } }
        await setOtherSettings(settings)
        for (let repeat=0; repeat<3; repeat++) await measure(`skew:wdi-${mode}:${repeat}`, () =>
          page('weldingJournal', {}, { wdi: value(mode === 'formula' ? '4.49' : '7.25'), preRkResult: value('ремонт') }), true)
        await measure(`skew:wdi-${mode}-facet`, () => api.listColumnFilterOptions(api.normalizeWeldColumnFilterOptionsRequest({
          report: 'weldingJournal', fieldKey: 'wdi', projectTitle: project, columnFilters: { preRkResult: value('ремонт') },
        })), true)
      }
      await setOtherSettings(null)
      await measure('skew:five-readers-with-write', async () => {
        await Promise.all([
          ...Array.from({ length: 5 }, () => page('lnk', {}, { rkResult: value('ремонт') }).then(result => {
            if (typeof api.buildReportQueryWhere === 'function') assert(result.rows.every(row => row.rkResult === 'ремонт'))
            return result
          }).catch(error => {
            // An explicit stale-page retry is valid; an empty successful page
            // or a silently changed selection is not.
            if (error instanceof Error && error.message.includes('изменились во время отбора')) return { retry: true }
            throw error
          })),
          withLineProgramFixture(db => db.query(`update weld_joints set rk_result='годен'
            where project_title=$1 and isometry='000020'`, [project])),
        ])
        const fresh = await page('lnk', {}, { rkResult: value('ремонт') })
        assert.equal(fresh.rows[0].isometry, '000040')
        return fresh
      }, true)
      if (typeof api.buildReportQueryWhere === 'function') {
        const { requireDb } = await import('../../src/db')
        const { weldJoints } = await import('../../src/db/schema')
        const { sql, asc } = await import('drizzle-orm')
        const { DEFAULT_OTHER_SETTINGS } = await import('../../src/lib/other-settings')
        for (const [report, columnFilters] of [['lnk', { rkResult: value('ремонт') }],
          ['weldingJournal', { preRkResult: value('ремонт') }], ['heatTreatment', { pstoCycleSummary: 'Повтор' }]] as const) {
          const selected = requireDb().select({ id: weldJoints.id }).from(weldJoints)
            .where(api.buildReportQueryWhere(report, { projectTitle: project, columnFilters }, DEFAULT_OTHER_SETTINGS))
            .orderBy(asc(weldJoints.isometry)).limit(101)
          const plan = await requireDb().execute(sql`explain (analyze, buffers, format json) ${selected}`)
          await info.attach(`plan-${report}.json`, { body: JSON.stringify(plan.rows, null, 2), contentType: 'application/json' })
          if (process.env.REPORT_FILTER_METRICS_PATH) await writeFile(process.env.REPORT_FILTER_METRICS_PATH + `.${report}-plan.json`, JSON.stringify(plan.rows, null, 2))
        }
      }
      return
    }
    for (const [size, scope] of [[1000, { groupName: 'first1000' }], [10000, { category: 'first10000' }], [200000, {}]] as const) {
      for (let repeat = 0; repeat < 3; repeat++) {
        const result = await measure(`${size}:lnk-rk:${repeat}`, () => page('lnk', scope, { rkResult: value('ремонт') }), true) as Awaited<ReturnType<typeof api.listReportPage>>
        assert.equal(result.rows.length, Math.min(size / 20, 100))
        assert.deepEqual(result.rows.map(row => row.isometry), Array.from({ length: Math.min(size / 20, 100) }, (_, i) => String((i + 1) * 20).padStart(6, '0')))
      }
      for (const report of ['lnk', 'heatTreatment', 'weldingJournal'] as const) {
        await measure(`${size}:${report}:pre`, () => page(report, scope, { preRkResult: value('ремонт') }), true)
        await measure(`${size}:${report}:basis`, () => page(report, scope, { controlBasisSummary: 'проект' }), true)
        await measure(`${size}:${report}:scheme`, () => page(report, scope, { rkExposureScheme: 'схема' }), true)
        const facet = await measure(`${size}:${report}:facet`, () => api.listColumnFilterOptions(api.normalizeWeldColumnFilterOptionsRequest({
          report, fieldKey: 'preRkResult', projectTitle: project, ...scope, columnFilters: { rkResult: value('ремонт') },
        })), true)
        if (typeof api.buildReportQueryWhere === 'function') expect(facet).toEqual([
          { value: 'годен', label: 'годен', count: size / 40 }, { value: 'ремонт', label: 'ремонт', count: size / 40 },
        ])
      }
      await measure(`${size}:psto:cycle-summary`, () => page('heatTreatment', scope, { pstoCycleSummary: 'Повтор' }), true)
      await measure(`${size}:lnk:ordinary`, () => page('lnk', scope, {}), true)
    }
    for (let repeat = 0; repeat < 20; repeat++) await measure(`warm:${repeat}`, () => page('lnk', {}, { rkResult: value('ремонт') }), false)
    for (let repeat = 0; repeat < 5; repeat++) await measure(`five-readers:${repeat}`, () => Promise.all(
      Array.from({ length: 5 }, (_, index) => page(index % 2 ? 'heatTreatment' : 'lnk', {}, {
        [index % 2 ? 'preRkResult' : 'rkResult']: value('ремонт'),
      }))), repeat === 0)
  } finally {
    pg.Client.prototype.query = original
    const body = JSON.stringify(measures, null, 2)
    await info.attach('report-filter-performance.json', { body, contentType: 'application/json' })
    if (process.env.REPORT_FILTER_METRICS_PATH) await writeFile(process.env.REPORT_FILTER_METRICS_PATH, body)
    console.info('REPORT FILTER METRICS:', measures.length, 'samples')
    await cleanupLineProgramProjects([project])
  }
})
