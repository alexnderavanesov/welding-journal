import assert from 'node:assert/strict'
import pg from 'pg'

// Run only after e2e/global-setup.ts, on its otherwise unused disposable DB.
const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const client = new pg.Client({ connectionString: url.toString() })
await client.connect()
const project = 'E2E WDI import load'
const original = pg.Client.prototype.query
let statements = 0
let pool: pg.Pool | undefined
let ownsFixtures = false
try {
  assert.equal((await client.query('select count(*)::int as n from weld_joints')).rows[0].n, 1)
  assert.equal((await client.query('select count(*)::int as n from line_programs')).rows[0].n, 0)
  assert.equal((await client.query("select count(*)::int as n from app_settings where key='other'")).rows[0].n, 0)
  ownsFixtures = true
  await client.query("insert into app_settings(key,value) values ('other', $1)", [JSON.stringify({ wdiCalculationMode: 'formula' })])
  const [{ listWeldingJournalImportScope }, { requireDb }] = await Promise.all([
    import('../src/server/weld-import'), import('../src/db/index'),
  ])
  pool = (requireDb() as unknown as { $client: pg.Pool }).$client
  const { listReportPage, normalizeWeldPageRequest, listColumnFilterOptions, normalizeWeldColumnFilterOptionsRequest } = await import('../src/server/weld-read')
  // This benchmark isolates reading/filtering, not dispatcher reconstruction.
  // Direct fixture inserts do not dirty the index. Initialize it before timing.
  await (await import('../src/server/dispatcher-task-index')).ensureDispatcherTaskIndexFresh()
  pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
    statements++
    return (original as (...args: unknown[]) => unknown).apply(this, args)
  } as typeof original
  for (const count of [200, 200_000]) {
    await client.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'WDI','WDI-'||n,'II','A',10,0 from generate_series(1,$2::int/200) n`, [project, count])
    await client.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,has_vik,d1,d2,wdi)
      select p.id,$1,'WDI',p.line,'F'||n,'2026-09-01','действующий','актуальная','С17','да',
        case when n=$2 then 254 else 108 end,case when n=$2 then 254 else 108 end,777
      from generate_series(1,$2::int) n join line_programs p on p.project_title=$1 and p.line='WDI-'||((n-1)/200+1)`, [project, count])
    for (const [filter, expected] of [['=4.25', count - 1], ['=10', 1], ['=777', 0]] as const) {
      statements = 0
      const started = performance.now()
      const result = await listWeldingJournalImportScope({ data: { columnFilters: { projectTitle: `=${project}`, wdi: filter } } })
      assert.equal(result.total, expected)
      assert.equal(result.limitExceeded, expected > 500)
      assert.equal(result.rows.length, expected > 500 ? 0 : expected)
      if (filter === '=10') assert.equal(Number(result.rows[0].wdi), 10, 'Use the current formula, not stale stored 777')
      assert.ok(statements <= 30, 'No row-wise queries even for a wide source filter')
      console.log(JSON.stringify({ workflow: 'computed WDI import filter', joints: count, filter, queries: statements,
        milliseconds: Math.round(performance.now() - started), responseBytes: Buffer.byteLength(JSON.stringify(result)),
        heapUsedMiB: Math.round(process.memoryUsage().heapUsed / 1024 ** 2),
        rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }))
    }
    await client.query(`update weld_joints set vik_control_basis=case when d1=254 then 'ALPHA' else 'BETA' end where project_title=$1`, [project])
    await client.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,request_name,request_date,conclusion_name,conclusion_date)
      select id,'ВИК','годен',case when d1=254 then 'PRE-LAST' else 'PRE-MANY' end,'2026-09-01','PRE-CONCLUSION','2026-09-01'
      from weld_joints where project_title=$1`, [project])
    const cases: Array<[Record<string, string>, number]> = [
      [{ controlBasisSummary: 'ALPHA' }, 1],
      [{ controlBasisSummary: 'BETA' }, count - 1],
      [{ controlBasisSummary: 'ALPHA', wdi: '=10' }, 1],
      [{ preVikRequest: '=PRE-LAST' }, 1],
      [{ preVikRequest: '=PRE-LAST', wdi: '=10', controlBasisSummary: 'ALPHA' }, 1],
      [{ preVikResult: '=годен' }, count],
      [{ search: `F${count}` }, 1],
    ]
    for (const [filters, expected] of cases) {
      statements = 0
      const started = performance.now()
      const result = await listWeldingJournalImportScope({ data: { columnFilters: { projectTitle: `=${project}`, ...filters } } })
      assert.equal(result.total, expected)
      assert.equal(result.limitExceeded, expected > 500)
      assert.equal(result.rows.length, expected > 500 ? 0 : expected)
      if (expected === 1) assert.equal(result.rows[0].joint, `F${count}`)
      assert.ok(statements <= 30, `No per-row queries for combined filters: ${statements}`)
      console.log(JSON.stringify({ workflow: 'combined journal import filters', joints: count, filters, queries: statements,
        milliseconds: Math.round(performance.now() - started), responseBytes: Buffer.byteLength(JSON.stringify(result)),
        rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }))
    }
    for (const [filters, expected] of [cases[0], cases[1], cases[3], cases[5]]) {
      statements = 0
      const started = performance.now()
      const result = await listReportPage('weldingJournal', normalizeWeldPageRequest({ page: 1, pageSize: 100,
        columnFilters: { projectTitle: `=${project}`, ...filters } }))
      assert.equal(result.total, expected)
      assert.equal(result.rows.length, Math.min(100, expected))
      assert.ok(statements <= 40, `No per-row queries for derived journal: ${statements}`)
      if (expected === 1) assert.equal(result.rows[0].joint, `F${count}`)
      console.log(JSON.stringify({ workflow: 'combined journal page', joints: count, filters, queries: statements,
        milliseconds: Math.round(performance.now() - started), responseBytes: Buffer.byteLength(JSON.stringify(result)),
        rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }))
    }
    // The original journal benchmark measures primary NK separately.
    await client.query('delete from pre_heat_treatment_controls where weld_joint_id in (select id from weld_joints where project_title=$1)', [project])
    await client.query("update weld_joints set vik_result='годен',final_status='годен' where project_title=$1 and d1=254", [project])
    for (const [filter, expected, wdiTotal] of [['=4.25', count - 1, 0], ['=10', 1, 10], ['=777', 0, 0]] as const) {
      statements = 0
      const started = performance.now()
      const result = await listReportPage('weldingJournal', normalizeWeldPageRequest({ page: 1, pageSize: 100,
        columnFilters: { projectTitle: `=${project}`, wdi: filter } }))
      assert.equal(result.total, expected)
      assert.equal('acceptedWdiTotal' in result ? result.acceptedWdiTotal : undefined, wdiTotal)
      assert.equal(result.rows.length, Math.min(100, expected))
      assert.ok(statements <= 40, `No row-wise queries: ${statements}`)
      if (filter === '=10') {
        assert.equal(result.rows[0].joint, `F${count}`)
        assert.equal(Number(result.rows[0].wdi), 10)
      }
      console.log(JSON.stringify({ workflow: 'computed WDI journal page', joints: count, filter, queries: statements,
        milliseconds: Math.round(performance.now() - started), responseBytes: Buffer.byteLength(JSON.stringify(result)),
        rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }))
    }
    statements = 0
    const options = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({ report: 'weldingJournal', fieldKey: 'wdi',
      columnFilters: { projectTitle: `=${project}` } }))
    assert.deepEqual(options.map(({ value, count }) => [value, count]).sort(), [['10', 1], ['4.25', count - 1]].sort())
    assert.ok(statements <= 2, `WDI options need only settings and dimensions: ${statements}`)
    console.log(JSON.stringify({ workflow: 'computed WDI options', joints: count, queries: statements }))
    await client.query('delete from weld_joints where project_title=$1', [project])
    await client.query('delete from line_programs where project_title=$1', [project])
  }
} finally {
  pg.Client.prototype.query = original
  if (ownsFixtures) {
    await client.query('delete from weld_joints where project_title=$1', [project])
    await client.query('delete from line_programs where project_title=$1', [project])
    await client.query("delete from app_settings where key='other'")
  }
  await pool?.end()
  await client.end()
}
