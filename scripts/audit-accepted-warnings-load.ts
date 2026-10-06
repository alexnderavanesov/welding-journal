/** Diagnostic only: own empty localhost database; no application/production data. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const name = 'welding_tracker_exception_audit_20260929'
const adminUrl = 'postgresql://welding:welding@127.0.0.1:5432/postgres'
const url = `postgresql://welding:welding@127.0.0.1:5432/${name}`
assert.equal(new URL(url).hostname, '127.0.0.1')
assert.equal(new URL(url).pathname, `/${name}`)
assert.equal(spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(), 'main')
const admin = new pg.Client({ connectionString: adminUrl })
const client = new pg.Client({ connectionString: url })
let created = false, connected = false
await admin.connect()
try {
  assert.equal((await admin.query('select 1 from pg_database where datname=$1', [name])).rowCount, 0, 'Refuse an existing database')
  await admin.query('create database welding_tracker_exception_audit_20260929')
  created = true
  await client.connect(); connected = true
  assert.equal(Number((await client.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count), 0)
  const migration = spawnSync('pnpm', ['db:migrate'], { env: { ...process.env, DATABASE_URL: url, WELDING_ENV_LOADED: '1' }, encoding: 'utf8' })
  assert.equal(migration.status, 0, migration.stderr || migration.stdout)
  console.log(JSON.stringify({ isolatedDatabase: name, emptyBeforeMigration: true,
    indexes: (await client.query("select indexdef from pg_indexes where tablename='dispatcher_accepted_warnings'")).rows }))
  let previous = 0
  const summary: unknown[] = []
  for (const count of [20_000, 200_000, 1_000_000]) {
    await client.query(`insert into dispatcher_accepted_warnings (key,kind,title,context,accepted_at)
      select 'line-program-excess:' || json_build_array(1+(n%2000),'K'||(n%4),'common',true,n,30,10+(n%20),array['да','да','',''])::text,
        'line-program-control', 'Согласован лишний контроль',
        'Проект: Тестовый проект · Шифр: AUDIT · Линия: L-' || (n%2000) || ' · Клеймо: K' || (n%4) || ' · Стык ID ' || n || ' · РК - УЗК',
        timestamptz '2026-01-01 00:00:00+00' + n * interval '1 second'
      from generate_series($1::int,$2::int) n`, [previous + 1, count])
    previous = count
    await client.query('analyze dispatcher_accepted_warnings')
    async function measured(label: string, statement: string, values: unknown[] = []) {
      const start = performance.now()
      const result = await client.query(statement, values)
      return { label, ms: Math.round(performance.now() - start), rows: result.rowCount, bytes: Buffer.byteLength(JSON.stringify(result.rows)) }
    }
    const measures = []
    // Same two-query page shape as listDispatcherAcceptedWarnings; raw SQL, not browser timings.
    measures.push(await measured('count', 'select count(*) as total from dispatcher_accepted_warnings'))
    measures.push(await measured('first_page_50', 'select * from dispatcher_accepted_warnings order by accepted_at desc, key desc limit 50 offset 0'))
    measures.push(await measured('last_page_50', 'select * from dispatcher_accepted_warnings order by accepted_at desc, key desc limit 50 offset $1', [count - 50]))
    measures.push(await measured('search_no_match_count', `select count(*) as overall_total, count(*) filter (where key ilike $1 or code ilike $1 or title ilike $1 or context ilike $1) as total from dispatcher_accepted_warnings`, ['%Несуществующий стык%']))
    measures.push(await measured('search_no_match_page', `select * from dispatcher_accepted_warnings where key ilike $1 or code ilike $1 or title ilike $1 or context ilike $1 order by accepted_at desc,key desc limit 50`, ['%Несуществующий стык%']))
    const keys = (await client.query('select key from dispatcher_accepted_warnings limit 100')).rows.map(row => row.key)
    measures.push(await measured('program_exact_100_keys', 'select key from dispatcher_accepted_warnings where key=any($1::text[])', [keys]))
    if (count <= 200_000) {
      // Matches the full/scoped dispatcher read; do not allocate a million full objects just for stress.
      measures.push(await measured('dispatcher_all_records', 'select * from dispatcher_accepted_warnings order by accepted_at asc'))
    }
    const plan = (await client.query('explain (format json) select * from dispatcher_accepted_warnings order by accepted_at desc,key desc limit 50')).rows[0]['QUERY PLAN'][0].Plan
    const report = { exceptions: count, measures, firstPagePlan: plan,
      storageBytes: Number((await client.query("select pg_total_relation_size('dispatcher_accepted_warnings') as bytes")).rows[0].bytes) }
    summary.push(report)
    console.log(JSON.stringify(report))
  }
  console.log(JSON.stringify({ complete: true, scope: 'Equivalent SQL/transport measurements; not an end-to-end dispatcher refresh or production capacity guarantee', sizes: summary.length }))
} finally {
  if (connected) await client.end()
  if (created) {
    await admin.query('drop database welding_tracker_exception_audit_20260929')
    console.log(JSON.stringify({ removedOwnedDisposableDatabase: name }))
  }
  await admin.end()
}
