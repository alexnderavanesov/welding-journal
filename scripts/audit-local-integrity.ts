import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getTableColumns, type Table } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import { inspectHistoricalRelations, type IntegrityFinding } from './local-integrity-checks'
import type { WeldRow } from '../src/lib/dispatcher-types'
import { getPstoLineIdentityKey } from '../src/lib/psto-line-assignment'

// Explicit local copy only. No .env, migration, repair or application startup.
const args = process.argv.slice(2)
const database = args[args.indexOf('--database') + 1]
const output = args[args.indexOf('--output') + 1]
assert(args.includes('--database') && /^welding_tracker_integrity_\d{8}(?:_[a-z0-9]+)?$/.test(database), 'Pass --database welding_tracker_integrity_YYYYMMDD[_suffix]')
assert(args.includes('--output') && output, 'Pass --output to a private local report file')
const url = new URL(`postgresql://welding:welding@127.0.0.1:5432/${database}`)
url.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000')
process.env.DATABASE_URL = url.toString()
process.env.WELDING_ENV_LOADED = '1'
process.env.DATABASE_POOL_MAX = '1'
delete process.env.DATABASE_SSL_CA
const client = new pg.Client({ connectionString: url.toString(), types: {
  // pg's default DATE parser returns a local-time Date; the application uses
  // date-only strings. Preserve PostgreSQL's value without timezone conversion.
  getTypeParser: (oid, format) => oid === 1082 ? (value: string) => value : pg.types.getTypeParser(oid, format),
} })
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`
const findings: IntegrityFinding[] = []
const started = Date.now()
await client.connect()
let closeDatabase: (() => Promise<void>) | undefined
try {
  assert.equal((await client.query('select current_database() name')).rows[0].name, database)
  await client.query('begin isolation level repeatable read read only')
  assert.equal((await client.query('show transaction_read_only')).rows[0].transaction_read_only, 'on')
  const tables = (await client.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row => String(row.tablename))
  assert(tables.includes('weld_joints') && tables.includes('generated_documents'), 'Not a restored application database')
  async function fingerprint() {
    const result: Record<string, unknown> = {}
    for (const table of tables) result[table] = (await client.query(`select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) hash from public.${identifier(table)} t`)).rows[0]
    result.sequences = (await client.query("select sequencename,last_value from pg_sequences where schemaname='public' order by sequencename")).rows
    return result
  }
  const before = await fingerprint()
  const foreignKeys = (await client.query(`select c.conname, child.relname as child, parent.relname as parent, c.confmatchtype as match,
    array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum order by k.ord) as child_columns,
    array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum order by k.ord) as parent_columns
    from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_class parent on parent.oid=c.confrelid
    where c.contype='f' and child.relnamespace='public'::regnamespace and parent.relnamespace='public'::regnamespace`)).rows
  const fkViolations: { constraint: string; count: number }[] = []
  for (const fk of foreignKeys) {
    const present = (fk.child_columns as string[]).map(column => `c.${identifier(column)} is not null`).join(fk.match === 'f' ? ' or ' : ' and ')
    const match = (fk.child_columns as string[]).map((column, i) => `c.${identifier(column)}=p.${identifier(fk.parent_columns[i])}`).join(' and ')
    const count = Number((await client.query(`select count(*) n from public.${identifier(fk.child)} c where (${present}) and not exists(select 1 from public.${identifier(fk.parent)} p where ${match})`)).rows[0].n)
    if (count) fkViolations.push({ constraint: fk.conname, count })
  }
  async function read<T>(name: string, table: Table): Promise<T[]> {
    const columns = Object.entries(getTableColumns(table))
    return (await client.query(`select * from public.${identifier(name)}`)).rows.map(row => Object.fromEntries(columns
      .filter(([, column]) => Object.hasOwn(row, column.name))
      .map(([key, column]) => [key, row[column.name] != null && column.dataType === 'number' ? Number(row[column.name]) : row[column.name]]))) as T[]
  }
  const rows = await read<WeldRow>('weld_joints', schema.weldJoints)
  const documents = await read<typeof schema.generatedDocuments.$inferSelect>('generated_documents', schema.generatedDocuments)
  const links = await read<typeof schema.generatedDocumentWeldJoints.$inferSelect>('generated_document_weld_joints', schema.generatedDocumentWeldJoints)
  const preControls = await read<typeof schema.preHeatTreatmentControls.$inferSelect>('pre_heat_treatment_controls', schema.preHeatTreatmentControls)
  const cycles = await read<typeof schema.pstoRepeatCycles.$inferSelect>('psto_repeat_cycles', schema.pstoRepeatCycles)
  const chainStates = await read<typeof schema.weldJointProgramStates.$inferSelect>('weld_joint_program_states', schema.weldJointProgramStates)
  const programs = await read<typeof schema.linePrograms.$inferSelect>('line_programs', schema.linePrograms)
  const programById = new Map(programs.map(program => [program.id, program]))
  for (const row of rows) if (row.lineProgramId != null) {
    const program = programById.get(row.lineProgramId)
    if (!program || getPstoLineIdentityKey(program) !== getPstoLineIdentityKey(row)) findings.push({ code: 'WRONG_LINE_PROGRAM_RELATION', category: 'relation', ids: [row.id, row.lineProgramId] })
  }
  for (const state of chainStates) if (!['primary', 'repair', 'coil'].includes(state.kind)) findings.push({ code: 'UNKNOWN_CHAIN_KIND', category: 'review', ids: [state.weldJointId] })
  findings.push(...inspectHistoricalRelations({ rows, documents, links, preControls, cycles,
    chainStates: chainStates as Parameters<typeof inspectHistoricalRelations>[0]['chainStates'], checkUnindexedFacts: true }))

  // Calculate in memory through the real read path, but never publish it. The
  // PostgreSQL read-only transaction is the final guard against accidental writes.
  const { calculateFullDispatcherTasks, isDispatcherTaskIndexFresh } = await import('../src/server/dispatcher-task-index')
  closeDatabase = (await import('../src/db')).closeDatabase
  const taskRows: { rowId: number; taskKey: string; code: string }[] = []
  const calculation = await calculateFullDispatcherTasks(drizzle(client, { schema }) as unknown as Parameters<typeof calculateFullDispatcherTasks>[0], {
    includeWelderStampExpiryTasks: false, taskSnapshotLimit: 0,
    onTaskIndexRows: values => { taskRows.push(...values) },
  })
  const indexState = (await read<typeof schema.dispatcherTaskIndexState.$inferSelect>('dispatcher_task_index_state', schema.dispatcherTaskIndexState))[0]
  const storedTaskRows = await read<typeof schema.dispatcherRowTasks.$inferSelect>('dispatcher_row_tasks', schema.dispatcherRowTasks)
  const taskKey = (id: number, key: string, code: string) => JSON.stringify([id, key, code])
  const expected = new Set(taskRows.map(row => taskKey(row.rowId, row.taskKey, row.code)))
  const stored = new Set(storedTaskRows.map(row => taskKey(row.weldJointId, row.taskKey, row.code)))
  const missingTasks = [...expected].filter(key => !stored.has(key)), extraTasks = [...stored].filter(key => !expected.has(key))
  const fresh = isDispatcherTaskIndexFresh(indexState)
  const storedStatuses = new Map(calculation.sourceRows.map(row => [row.id, row.finalStatus]))
  const statusDifferences = calculation.preparedRows.filter(row => storedStatuses.get(row.id) !== row.finalStatus).map(row => row.id)
  if (fresh && (missingTasks.length || extraTasks.length)) findings.push({ code: 'FRESH_DISPATCHER_INDEX_MISMATCH', category: 'derived', ids: [...new Set([...missingTasks, ...extraTasks].map(key => JSON.parse(key)[0]))] })
  if (fresh && statusDifferences.length) findings.push({ code: 'FRESH_FINAL_STATUS_MISMATCH', category: 'derived', ids: statusDifferences })
  const { computeStatisticsServerResult } = await import('../src/server/statistics')
  const general = await computeStatisticsServerResult({ tab: 'general', unit: 'joints' })
  const byLine = await computeStatisticsServerResult({ tab: 'lineSummary', unit: 'joints' })
  if (general.generalProgressSummary.total !== byLine.lineSummary.total) findings.push({ code: 'STATISTICS_PHYSICAL_TOTAL_MISMATCH', category: 'derived', ids: [] })
  const sequenceChecks = []
  const serials = (await client.query(`select c.table_name,c.column_name,pg_get_serial_sequence(format('%I.%I',c.table_schema,c.table_name),c.column_name) as sequence
    from information_schema.columns c where c.table_schema='public' and (c.column_default like 'nextval(%' or c.is_identity='YES')`)).rows
  for (const serial of serials) {
    assert(/^public\.[a-z0-9_]+$/.test(serial.sequence), 'Unexpected serial sequence name')
    const state = (await client.query(`select last_value::text,is_called from ${serial.sequence}`)).rows[0]
    const increment = (await client.query('select increment_by::text from pg_sequences where schemaname=$1 and sequencename=$2', ['public', serial.sequence.slice(7)])).rows[0].increment_by
    const maximum = (await client.query(`select max(${identifier(serial.column_name)})::text as value from public.${identifier(serial.table_name)}`)).rows[0].value
    const next = BigInt(state.last_value) + (state.is_called ? BigInt(increment) : 0n)
    const safe = maximum == null || BigInt(increment) > 0n && next > BigInt(maximum)
    sequenceChecks.push({ table: serial.table_name, safe })
    if (!safe) findings.push({ code: 'SERIAL_SEQUENCE_BEHIND_ROWS', category: 'review', ids: [] })
  }
  // End the old snapshot: the second fingerprint must see independently
  // committed changes as well, including any accidentally introduced pool call.
  await client.query('rollback')
  await client.query('begin isolation level repeatable read read only')
  const after = await fingerprint()
  assert.deepEqual(after, before, 'The read-only audit changed the restored copy')
  const report = {
    database, checkedAt: new Date().toISOString(), milliseconds: Date.now() - started, readOnly: true, preserved: true,
    counts: { tables: tables.length, joints: rows.length, documents: documents.length, links: links.length, preControls: preControls.length, repeatCycles: cycles.length, chainStates: chainStates.length },
    foreignKeysChecked: foreignKeys.length, fkViolations, sequenceChecks,
    invalidConstraints: (await client.query("select conname from pg_constraint where connamespace='public'::regnamespace and not convalidated")).rows,
    invalidIndexes: (await client.query("select indexrelid::regclass::text name from pg_index where indrelid in(select oid from pg_class where relnamespace='public'::regnamespace) and (not indisvalid or not indisready)")).rows,
    dispatcher: { fresh, expectedRows: expected.size, storedRows: stored.size, missingTasks, extraTasks, statusDifferences },
    statistics: { generalPhysicalTotal: general.generalProgressSummary.total, linePhysicalTotal: byLine.lineSummary.total, generalPeriodRows: general.summary.totalRows },
    findings, fingerprints: before,
    templates: (await client.query('select id,blob_key,file_size from document_templates order by id')).rows,
  }
  await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ ...report.counts, readOnly: true, preserved: true, findings: findings.length, fkViolations: fkViolations.length, dispatcherFresh: fresh, output: resolve(output) }))
  await client.query('rollback')
} finally {
  await client.query('rollback').catch(() => {})
  await client.end()
  await closeDatabase?.()
}
