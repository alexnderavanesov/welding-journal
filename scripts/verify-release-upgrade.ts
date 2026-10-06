import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { eq, sql } from 'drizzle-orm'

// No .env loading, remote target or existing database is accepted. SQL migrations
// are copied byte-for-byte from Drizzle output; only the fixture journal is sliced.
const root = process.cwd()
const database = 'welding_tracker_line_program_test_release_20261003'
const url = `postgresql://welding:welding@127.0.0.1:5432/${database}`
assert.equal(spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(), 'main')
const admin = new pg.Client({ connectionString: 'postgresql://welding:welding@127.0.0.1:5432/postgres' })
const client = new pg.Client({ connectionString: url })
process.env.DATABASE_URL = url
process.env.WELDING_ENV_LOADED = '1'
const count = process.argv.includes('--scale') ? 200_000 : 200
let owned = false, connected = false, fixture: string | undefined, pool: pg.Pool | undefined
const journal = JSON.parse(readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[]
}

function migrate(cwd: string) {
  const started = performance.now()
  const result = spawnSync('pnpm', ['db:migrate'], { cwd, env: process.env, encoding: 'utf8', timeout: 180_000 })
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
  console.log(JSON.stringify({ migration: cwd === root ? 'current' : 'fixture', milliseconds: Math.round(performance.now() - started) }))
}

function selectFixtureVersion(lastIndex: number) {
  assert(fixture)
  writeFileSync(join(fixture, 'drizzle/meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.filter(entry => entry.idx <= lastIndex) }))
}

async function savedFacts(exclude: string[] = []) {
  const rows = (await client.query(`select count(*)::int as count,
    md5(string_agg(md5((to_jsonb(w)-$1::text[])::text),'' order by id)) as hash from weld_joints w`, [exclude])).rows[0]
  const related: Record<string, unknown> = {}
  for (const table of ['pre_heat_treatment_controls', 'psto_repeat_cycles', 'duplicate_controls', 'generated_documents', 'generated_document_weld_joints', 'document_templates', 'app_settings', 'dispatcher_accepted_warnings']) {
    // Identifiers are a fixed test allowlist, never user input.
    const projection = table === 'dispatcher_accepted_warnings'
      ? "to_jsonb(t)-array['weld_joint_id','line_program_id','welder_stamp_id']" : 'to_jsonb(t)'
    related[table] = (await client.query(`select coalesce(jsonb_agg(${projection} order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)).rows[0].rows
  }
  return { rows, related }
}

await admin.connect()
try {
  assert.equal((await admin.query('select 1 from pg_database where datname=$1', [database])).rowCount, 0, 'Refuse existing database')
  await admin.query('create database welding_tracker_line_program_test_release_20261003')
  owned = true
  await client.connect(); connected = true
  assert.equal((await client.query('select current_database() as name')).rows[0].name, database)
  assert.equal(Number((await client.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count), 0)
  const cache = join(root, 'node_modules/.cache')
  mkdirSync(cache, { recursive: true })
  fixture = mkdtempSync(join(cache, 'release-upgrade-'))
  for (const name of ['src', 'scripts', 'node_modules']) symlinkSync(join(root, name), join(fixture, name), 'dir')
  for (const name of ['package.json', 'tsconfig.json', 'drizzle.config.ts']) copyFileSync(join(root, name), join(fixture, name))
  mkdirSync(join(fixture, 'drizzle/meta'), { recursive: true })
  for (const entry of journal.entries) copyFileSync(join(root, 'drizzle', `${entry.tag}.sql`), join(fixture, 'drizzle', `${entry.tag}.sql`))
  if (process.argv.includes('--transition-regression')) {
    selectFixtureVersion(43)
    migrate(fixture)
    const regression = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-line-program-local.ts', '--scale'], {
      cwd: root, env: process.env, encoding: 'utf8', timeout: 180_000,
    })
    assert.equal(regression.status, 0, `${regression.error ?? ''}\n${regression.stdout}\n${regression.stderr}`)
    console.log(regression.stdout)
  } else {
  selectFixtureVersion(37)
  migrate(fixture)
  assert.equal((await client.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0].n, 38)
  assert.equal((await client.query("select to_regclass('line_programs') as name")).rows[0].name, null)

  // Legacy data precedes all six new migrations. Two physical connections on
  // CHAIN: repaired F1; F2 replaced by two welded sides -> three, not six records.
  await client.query(`insert into weld_joints(id,project_title,subtitle_code,line,joint,weld_date,
    officiality,revision_actuality,connection_type,category,group_name,weld_control_percent,stamp_1_k,has_vik,has_rk,rk_result)
    values (1,'UPGRADE','S','CHAIN','F1','2026-09-01','действующий','актуальная','С17','II','A',10,'A','отменен','да','ремонт'),
      (2,'UPGRADE','S','CHAIN','F1R1','2026-09-02','действующий','актуальная','С17','II','A',10,'B',null,'да','годен'),
      (3,'UPGRADE','S','CHAIN','F2','2026-09-01','действующий','актуальная','С17','II','A',10,'A','да','да','вырез'),
      (4,'UPGRADE','S','CHAIN','F2Y1','2026-09-03','действующий','актуальная','С17','II','A',10,'A','да',null,null),
      (5,'UPGRADE','S','CHAIN','F2Y2','2026-09-03','действующий','актуальная','С17','II','A',10,'A','да',null,null),
      (6,'UPGRADE','S','CONFLICT','F3','2026-09-01','действующий','актуальная','У19','II','A',10,'A','нет',null,null),
      (7,'UPGRADE','S','CONFLICT','F4','2026-09-01','неофициальный','не актуален','У19','III','B',30,'B','да',null,null)`)
  await client.query(`insert into weld_joints(id,project_title,subtitle_code,line,joint,weld_date,
    connection_type,category,group_name,weld_control_percent,stamp_1_k,has_vik)
    select 100+n,'UPGRADE','S','LOAD-'||((n-1)/200),'F'||n,'2026-09-01','С17','II','A',10,'A','да'
    from generate_series(1,$1::int) n`, [count])
  await client.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,request_name,request_date,conclusion_name,conclusion_date,defect_description)
    values (1,'ВИК','годен','Историческая заявка','2026-09-01','Историческое заключение','2026-09-01','  ДНО  ')`)
  await client.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_date,psto_result,tvmt_result,psto_note)
    values (6,2,'Повторная ПСТО','2026-09-04','выполнено','не годен','  Фактическая история  ')`)
  await client.query(`insert into duplicate_controls(weld_joint_id,method,result,conclusion,conclusion_date)
    values (5,'УЗК','годен','Дубль заказчика','2026-09-04')`)
  await client.query(`insert into app_settings(key,value) values ('release-fixture:sequence','731'),('release-fixture:setting','  сохранить точно  ')`)
  await client.query(`insert into dispatcher_accepted_warnings(key,kind,title,accepted_at)
    values ('1:legacy-saved-decision','check','Сохранённое решение','2026-09-01'),
      ('999999:legacy-removed-object','check','Удалённый объект','2026-09-01')`)
  await client.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,options)
    values ('release-template','fixture-only-not-a-real-file','template.xlsx','xlsx',123,'{}','{"retained":true}')`)
  for (const [index, type] of ['layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers', 'system:lnkConclusion', 'custom'].entries()) {
    await client.query(`insert into generated_documents(id,type,title,file_name,mime_type,document_number,source_metadata)
      values ($1,$2,$3,'fixture.xlsx','application/x-test',$4,$5)`, [index + 1, type, `История ${index}`, 731 + index,
      index < 4 ? JSON.stringify({ kind: 'layeredControl', version: 1 }) : JSON.stringify({ retained: true })])
    await client.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,6)', [index + 1])
  }
  const before = await savedFacts()
  // Exercise an interrupted rollout at 0041 as well as the complete 0037->0043 upgrade.
  selectFixtureVersion(41)
  migrate(fixture)
  await client.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,replaced_by_coil)
    values (3,'primary',3,true)`)
  migrate(root)
  const newFields = ['line_program_id', 'pvk_control_percent', 'layered_control_assigned']
  assert.deepEqual(await savedFacts(newFields), before, 'Schema upgrade must preserve every old fact, timestamp and document link')
  assert.deepEqual((await client.query('select replacement_coil_ids from weld_joint_program_states where weld_joint_id=3')).rows[0].replacement_coil_ids, [])
  assert.equal((await client.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0].n, 44)
  const migrated = await savedFacts()
  migrate(root)
  assert.deepEqual(await savedFacts(), migrated, 'Repeated migration must not rewrite facts or dates')

  const [{ requireDb }, schema, transition, program, chain, topology, calculation] = await Promise.all([
    import('../src/db/index'), import('../src/db/schema'), import('../src/server/line-program-transition'),
    import('../src/server/line-program'), import('../src/server/line-program-chain-state'),
    import('../src/lib/line-program-topology'), import('../src/lib/line-program-calculation'),
  ])
  const db = requireDb(); pool = (db as unknown as { $client: pg.Pool }).$client
  const excluded = [...newFields, 'category', 'group_name', 'weld_control_percent', 'has_vik', 'updated_at']
  const factsBeforeTransition = (await savedFacts(excluded)).rows
  const started = performance.now()
  assert.equal((await db.transaction(transition.transitionLinePrograms)).skipped, false)
  console.log(JSON.stringify({ transition: 'legacy-data', joints: count + 7, milliseconds: Math.round(performance.now() - started) }))
  assert.deepEqual((await savedFacts(excluded)).rows, factsBeforeTransition, 'Only agreed transition fields may change')
  assert.equal((await client.query("select count(*)::int as n from weld_joints where has_vik is distinct from 'да'")).rows[0].n, 0)
  assert.deepEqual((await client.query("select category,group_name,weld_control_percent,pvk_control_percent from line_programs where line='CHAIN'")).rows[0],
    { category: 'II', group_name: 'A', weld_control_percent: '10.000', pvk_control_percent: '10.000' })
  const conflict = (await client.query("select category,weld_control_percent,configuration_issue from line_programs where line='CONFLICT'")).rows[0]
  assert.equal(conflict.category, null); assert.equal(conflict.weld_control_percent, null); assert.match(conflict.configuration_issue, /СП-02/)
  const transitioned = await savedFacts()
  for (const table of ['pre_heat_treatment_controls', 'psto_repeat_cycles', 'duplicate_controls', 'document_templates']) {
    assert.deepEqual(transitioned.related[table], before.related[table], table)
  }
  assert.deepEqual((await client.query('select id from generated_documents order by id')).rows.map(row => row.id), [5, 6])
  assert.equal((await client.query("select value from app_settings where key='release-fixture:sequence'")).rows[0].value, '731')
  // Verify the provided maintenance recovery, then rollback just this probe.
  const rollback = new Error('rollback recovery probe')
  await assert.rejects(db.transaction(async tx => {
    await transition.restoreLineProgramTransition(tx)
    assert.equal((await tx.execute(sql`select count(*)::int as n from generated_documents`)).rows[0].n, 6)
    assert.equal((await tx.execute(sql`select count(*)::int as n from generated_document_weld_joints`)).rows[0].n, 6)
    assert.equal((await tx.execute(sql`select count(*)::int as n from line_programs`)).rows[0].n, 0)
    throw rollback
  }), error => error === rollback)
  const once = await savedFacts()
  assert.equal((await db.transaction(transition.transitionLinePrograms)).skipped, true)
  assert.deepEqual(await savedFacts(), once)
  await assert.rejects(db.transaction(async tx => {
    await tx.update(schema.weldJoints).set({ updatedAt: new Date('2030-01-01') }).where(eq(schema.weldJoints.id, 1))
    await transition.restoreLineProgramTransition(tx)
  }), /После перехода данные изменились/)
  assert.deepEqual(await savedFacts(), once, 'Refused restoration rolls back without overwriting later work')

  const { backfillAcceptedWarningObjects } = await import('../src/server/accepted-warning-backfill')
  const readWarnings = async () => (await client.query('select * from dispatcher_accepted_warnings order by key')).rows
  const legacyWarnings = await readWarnings()
  const warningPreview = await db.transaction(tx => backfillAcceptedWarningObjects(tx), { accessMode: 'read only' })
  assert.deepEqual(warningPreview, { examined: 2, linked: 1, removedOrphans: 1, removedObsolete: 0, unresolved: [] })
  assert.deepEqual(await readWarnings(), legacyWarnings, 'Warning preview cannot write')
  assert.deepEqual(await db.transaction(tx => backfillAcceptedWarningObjects(tx, true)), warningPreview)
  const linkedWarnings = await readWarnings()
  assert.deepEqual(linkedWarnings, [{ ...legacyWarnings[0], weld_joint_id: 1 }])
  assert.equal((await db.transaction(tx => backfillAcceptedWarningObjects(tx, true))).examined, 0)
  assert.deepEqual(await readWarnings(), linkedWarnings)

  const identity = { projectTitle: 'UPGRADE', subtitleCode: 'S', line: 'CHAIN' }
  const rows = await program.loadLineProgramRows(db, identity)
  assert.equal(topology.buildLineProgramTopology(rows, false).physicalRows.length, 3)
  const a = calculation.calculateLineProgram(rows, 10, 10).find(group => group.stamp === 'A')!
  assert.equal(a.rowIds.length, 3); assert.deepEqual(a.rejectedRowIds, [1, 3])
  assert.equal(a.common.baseRequired, 1); assert.equal(a.common.additionalRequired, 4)
  assert.deepEqual(a.common.coveredRowIds, [1]); assert.equal(a.common.missing, 2)
  assert.equal(calculation.calculateLineProgram(rows, 10, 10).some(group => group.stamp === 'B'), false, 'Repairer has no percentage contribution')
  await db.transaction(async tx => {
    const previous = await program.loadLineProgramRows(tx, identity)
    await tx.delete(schema.weldJoints).where(sql`${schema.weldJoints.id} in (4,5)`)
    await chain.syncProgramChainStates(tx, [], new Map(previous.filter(row => [4, 5].includes(row.id)).map(row => [row.id, row])))
  })
  const afterDeletion = await program.loadLineProgramRows(db, identity)
  const afterTopology = topology.buildLineProgramTopology(afterDeletion, false)
  assert.equal(afterTopology.physicalRows.length, 1)
  assert(afterTopology.issues.some(issue => issue.rowId === 3 && issue.code === 'missing-replacement'))
  assert.equal((await client.query('select count(*)::int as n from weld_joint_program_states where weld_joint_id in (4,5)')).rows[0].n, 2, '0042 preserves deleted coil identity')
  assert.equal((await client.query('select replaced_by_coil from weld_joint_program_states where weld_joint_id=3')).rows[0].replaced_by_coil, true)
  console.log(JSON.stringify({ passed: true, baseline: '0037', intermediate: '0041', target: '0043', joints: count + 7,
    factsAndDocumentsPreserved: true, migrationIdempotent: true, transitionRecoveryAndConflict: true, explicitWarningBackfill: true,
    physicalCounts: [3, 1], mandatoryExplicitCoilRestoration: true }))
  }
} finally {
  if (pool) await pool.end()
  if (connected) await client.end()
  if (owned) await admin.query('drop database welding_tracker_line_program_test_release_20261003 with (force)')
  await admin.end()
  if (fixture) {
    assert(resolve(fixture).startsWith(join(root, 'node_modules/.cache/release-upgrade-')))
    rmSync(fixture, { recursive: true }) // Only this run's mkdtemp directory, never symlink targets.
  }
}
