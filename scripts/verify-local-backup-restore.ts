import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, openSync, closeSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

// Synthetic current-schema rehearsal only. Never loads .env or accepts a remote URL.
const names = ['welding_tracker_audit_restore_source_20261008', 'welding_tracker_audit_restore_target_20261008'] as const
const base = 'postgresql://welding:welding@127.0.0.1:5432/'
const container = 'welding-tracker-postgres'
const admin = new pg.Client({ connectionString: `${base}postgres` })
const owned = new Map<string, number>()
const directory = mkdtempSync(join(tmpdir(), 'welding-synthetic-backup-'))
const dump = join(directory, 'synthetic.dump')
const command = (program: string, args: string[], options: Parameters<typeof spawnSync>[2] = {}) => {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 60_000, ...options })
  assert.equal(result.status, 0, `${program}: ${result.error ?? ''} ${result.stderr ?? ''}`)
  return String(result.stdout ?? '')
}
assert.equal(command('git', ['branch', '--show-current']).trim(), 'main', 'Migrations require main')
assert.match(command('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim(), /^unix:\/\//, 'Local Docker only')
assert.match(command('docker', ['port', container, '5432/tcp']), /:5432/, 'Expected local test PostgreSQL port')
async function connect<T>(name: string, run: (client: pg.Client) => Promise<T>) {
  assert(names.includes(name as typeof names[number]))
  const client = new pg.Client({ connectionString: base + name })
  await client.connect()
  try {
    assert.equal((await client.query('select current_database() as name')).rows[0].name, name)
    return await run(client)
  } finally { await client.end() }
}
async function fingerprint(name: string) {
  return connect(name, async client => {
    const tables = (await client.query("select tablename from pg_tables where schemaname in ('public','drizzle') order by schemaname,tablename")).rows
    const result: Record<string, unknown> = {}
    for (const { tablename } of tables) {
      assert.match(tablename, /^[a-z_]+$/)
      const schema = tablename === '__drizzle_migrations' ? 'drizzle' : 'public'
      result[tablename] = (await client.query(`select count(*)::int n, md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) hash from ${schema}."${tablename}" t`)).rows[0]
    }
    result.sequences = (await client.query("select schemaname,sequencename,last_value from pg_sequences where schemaname in ('public','drizzle') order by 1,2")).rows
    return result
  })
}
function migrate(name: string) {
  command('pnpm', ['db:migrate'], { env: { ...process.env, DATABASE_URL: base + name, WELDING_ENV_LOADED: '1' } })
}
await admin.connect()
try {
  for (const name of names) {
    assert.equal((await admin.query('select oid from pg_database where datname=$1', [name])).rowCount, 0, `Refuse existing ${name}`)
    await admin.query(`create database ${name}`)
    owned.set(name, (await admin.query('select oid from pg_database where datname=$1', [name])).rows[0].oid)
    await connect(name, async client => assert.equal((await client.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n, 0))
  }
  migrate(names[0])
  await connect(names[0], async client => {
    await client.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,material_group,connection_type,d1,t1,d2,t2)
      select 'SYNTHETIC','BACKUP','L1','F'||n,'2026-10-01',case when n%2=0 then 'М05 + М01' else 'М01' end,'С17',108,6,108,8 from generate_series(1,200) n`)
    await client.query("insert into duplicate_controls(weld_joint_id,method,result,conclusion) values(1,'ПВК','ремонт','Историческое заключение')")
    await client.query("insert into app_settings(key,value) values('audit:preserve','  Точное значение  ')")
    await client.query("insert into dispatcher_accepted_warnings(key,kind,code,title,weld_joint_id) values('audit:accepted','check','ДЗ-09','Старое решение',1)")
    await client.query("insert into generated_documents(type,title,file_name,mime_type,row_count) values('custom','Документ','backup.xlsx','application/x-test',2)")
    await client.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values(1,1),(1,2)')
    await client.query("insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata) values('synthetic','synthetic-not-a-real-blob','template.xlsx','xlsx',0,'{}')")
    await client.query(`insert into technology_cards(name,welding_methods,connection_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,psto,first_used_at)
      values ('Техкарта после переименования',array['РАД','РД'],'С17',array['М01','М05'],57,159,3,8,'any','2026-10-01')`)
    await client.query(`insert into technology_card_names(name,technology_card_id)
      values ('ТК прежнее название',1),('Техкарта после переименования',1)`)
    await client.query("update weld_joints set technology_card_number='ТК прежнее название' where id=1")
    await client.query(`insert into document_operation_receipts(id,request_hash,result)
      values ('synthetic-restored-operation','synthetic-request-hash','{"processedDocumentIds":[1],"completed":true}')`)
  })
  const before = await fingerprint(names[0])
  const out = openSync(dump, 'wx')
  try { command('docker', ['exec', container, 'pg_dump', '-U', 'welding', '-d', names[0], '-Fc', '--no-owner'], { stdio: ['ignore', out, 'pipe'] }) }
  finally { closeSync(out) }
  const input = openSync(dump, 'r')
  try { command('docker', ['exec', '-i', container, 'pg_restore', '-U', 'welding', '-d', names[1], '--no-owner', '--exit-on-error'], { stdio: [input, 'pipe', 'pipe'] }) }
  finally { closeSync(input) }
  assert.deepEqual(await fingerprint(names[1]), before, 'Restored facts, links, settings, decisions and sequences must match')
  migrate(names[1]); migrate(names[1])
  assert.deepEqual(await fingerprint(names[1]), before, 'Current migrations are idempotent after restore')
  console.log(JSON.stringify({ kind: 'synthetic-current-schema-only', joints: 200, tables: Object.keys(before).length - 1, dumpBytes: statSync(dump).size, dump, restored: true, repeatedMigrationPreservedFacts: true, externalTemplateBlobsTested: false }))
} finally {
  for (const [name, oid] of owned) {
    const current = (await admin.query('select oid from pg_database where datname=$1', [name])).rows[0]
    if (current) {
      assert.equal(current.oid, oid, 'Refuse to remove a database replaced by another process')
      await admin.query(`drop database ${name} with (force)`)
    }
  }
  await admin.end()
}
