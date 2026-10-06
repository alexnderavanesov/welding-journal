import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { DATA_RELEASE_KEY } from '../src/lib/release-contract'

// No environment files or remote credentials. Only an absent, empty disposable DB.
const root = process.cwd()
const database = 'welding_tracker_test_deploy_first_20261004'
const url = `postgresql://welding:welding@127.0.0.1:5432/${database}`
assert.equal(spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(), 'main')
const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_REMOTE_FOR_MIGRATIONS: '', WELDING_ENV_LOADED: '1' }
const admin = new pg.Client({ connectionString: 'postgresql://welding:welding@127.0.0.1:5432/postgres' })
const db = new pg.Client({ connectionString: url })
const jointCount = process.argv.includes('--scale') ? 200_000 : 200
let owned = false, connected = false, fixture: string | undefined, server: ChildProcess | undefined
let serverLog = ''

function command(args: string[], cwd = root, succeeds = true) {
  const started = performance.now()
  const result = spawnSync('pnpm', args, { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
  if (succeeds) assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
  else assert.notEqual(result.status, 0, 'Expected a guarded failure')
  console.log(JSON.stringify({ command: args.join(' '), expectedSuccess: succeeds, milliseconds: Math.round(performance.now() - started) }))
  return result
}

await admin.connect()
try {
  assert.equal((await admin.query('select 1 from pg_database where datname=$1', [database])).rowCount, 0, 'Refuse existing test DB')
  await admin.query('create database welding_tracker_test_deploy_first_20261004'); owned = true
  await db.connect(); connected = true
  assert.equal((await db.query('select current_database() as name')).rows[0].name, database)
  assert.equal(Number((await db.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count), 0)
  const cache = join(root, 'node_modules/.cache'); mkdirSync(cache, { recursive: true })
  fixture = mkdtempSync(join(cache, 'deploy-first-'))
  for (const name of ['src', 'scripts', 'node_modules']) symlinkSync(join(root, name), join(fixture, name), 'dir')
  for (const name of ['package.json', 'tsconfig.json', 'drizzle.config.ts']) copyFileSync(join(root, name), join(fixture, name))
  mkdirSync(join(fixture, 'drizzle/meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8'))
  for (const entry of journal.entries) copyFileSync(join(root, 'drizzle', `${entry.tag}.sql`), join(fixture, 'drizzle', `${entry.tag}.sql`))
  // Only the fixture journal is sliced; generated migration SQL is never edited.
  writeFileSync(join(fixture, 'drizzle/meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.filter((entry: { idx: number }) => entry.idx <= 37) }))
  command(['db:migrate'], fixture)
  await db.query(`insert into weld_joints(id,project_title,subtitle_code,line,joint,category,group_name,weld_control_percent,has_vik)
    select n,'DEPLOY','S','L'||((n-1)/200),'F'||n,'II','A',10,'нет' from generate_series(1,$1::int) n`, [jointCount])
  await db.query(`insert into dispatcher_accepted_warnings(key,kind,title,accepted_at) values
    ('1:legacy-saved-decision','check','Историческое решение','2026-09-01'),
    ('unknown-legacy-format','check','Неоднозначное решение','2026-09-01')`)
  await db.query(`insert into generated_documents(id,type,title,file_name,mime_type,source_metadata)
    values (1,'layeredVikEdges','Старый автодокумент','fixture.xlsx','application/x-test','{"kind":"layeredControl","version":1}'),
      (2,'custom','Обычный документ','ordinary.xlsx','application/x-test',null)`)
  // A dynamically selected loopback port does not collide with the user's server.
  const portProbe = createServer().listen(0, '127.0.0.1'); await once(portProbe, 'listening')
  const port = (portProbe.address() as { port: number }).port
  await new Promise<void>(resolve => portProbe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, env: { ...env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout?.on('data', chunk => { serverLog += String(chunk) })
  server.stderr?.on('data', chunk => { serverLog += String(chunk) })
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/health/live`)).status === 200) break } catch { /* startup only */ }
    assert(attempt < 100, `Server did not start: ${serverLog}`); await delay(100)
  }
  assert.equal((await fetch(`${origin}/health/ready`)).status, 503)
  const maintenance = await fetch(`${origin}/line-program`, { headers: { accept: 'text/html' } })
  assert.equal(maintenance.status, 503); assert.match(await maintenance.text(), /Идёт обновление системы/)
  for (const path of ['/_serverFn/stale-save', '/api/maintenance/dispatcher-refresh']) {
    assert.equal((await fetch(`${origin}${path}`, { method: 'POST', body: '{}' })).status, 503)
  }
  console.log(JSON.stringify({ oldSchema: '0037', live: 200, ready: 503, staleWritesBlocked: true }))

  const failed = command(['db:release-local'], root, false)
  assert.match(failed.stderr, /Неоднозначные принятые исключения/)
  assert.equal((await db.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0].n, 44)
  assert.equal((await db.query('select count(*)::int as n from line_programs')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int as n from line_program_transition_backups')).rows[0].n, 0)
  assert.equal((await db.query("select count(*)::int as n from weld_joints where has_vik='нет'")).rows[0].n, jointCount)
  assert.equal((await db.query('select count(*)::int as n from generated_documents')).rows[0].n, 2)
  assert.equal((await db.query('select 1 from app_settings where key=$1', [DATA_RELEASE_KEY])).rowCount, 0)
  await delay(5_100)
  assert.equal((await fetch(`${origin}/health/ready`)).status, 503)
  // Fixture-only resolution. Production ambiguities must be discussed, not deleted by the tool.
  await db.query("delete from dispatcher_accepted_warnings where key='unknown-legacy-format'")

  await db.query("select pg_advisory_lock(hashtext('maintenance:database-release:v1'))")
  const concurrent = command(['db:release-local'], root, false)
  assert.match(concurrent.stderr, /Другой выпуск уже выполняется/)
  await db.query("select pg_advisory_unlock(hashtext('maintenance:database-release:v1'))")
  command(['db:release-local'])
  await delay(5_100)
  assert.equal((await fetch(`${origin}/health/ready`)).status, 200)
  assert.equal((await fetch(`${origin}/line-program`)).status, 200)
  assert.equal((await db.query("select count(*)::int as n from weld_joints where has_vik='да' and line_program_id is not null")).rows[0].n, jointCount)
  assert.deepEqual((await db.query('select id from generated_documents order by id')).rows.map(row => row.id), [2])
  assert.equal((await db.query('select weld_joint_id from dispatcher_accepted_warnings')).rows[0].weld_joint_id, 1)
  const fingerprint = async () => (await db.query("select md5(string_agg(md5(to_jsonb(w)::text), '' order by id)) as hash from weld_joints w")).rows[0].hash
  const beforeRetry = await fingerprint()
  const backups = (await db.query('select count(*)::int as n from line_program_transition_backups')).rows[0].n
  command(['db:release-local'])
  assert.equal(await fingerprint(), beforeRetry)
  assert.equal((await db.query('select count(*)::int as n from line_program_transition_backups')).rows[0].n, backups)
  assert.equal((await db.query('select count(*)::int as n from generated_documents')).rows[0].n, 1)
  assert.doesNotMatch(serverLog, /\[error\]|Unhandled|does not exist|unhandledRejection/i)
  console.log(JSON.stringify({ passed: true, joints: jointCount, deployBeforeMigration: true, atomicDataRollback: true,
    safeRetry: true, ordinaryDocumentPreserved: true, automaticReadiness: true, concurrentReleaseRefused: true }))
} finally {
  if (server && server.exitCode === null) { const ended = once(server, 'exit'); server.kill('SIGTERM'); await ended }
  if (connected) await db.end()
  if (owned) await admin.query('drop database welding_tracker_test_deploy_first_20261004 with (force)')
  await admin.end()
  if (fixture) { assert(fixture.startsWith(join(root, 'node_modules/.cache/deploy-first-'))); rmSync(fixture, { recursive: true }) }
}
