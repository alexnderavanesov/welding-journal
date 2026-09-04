import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

import { getDatabaseConnectionConfig } from '../src/db/ssl.ts'
import {
  assertLegacyControlColumnsEmpty,
  assertLegacyWeldSchemaMatchesMigrationState,
  assertNoOfficialityConflicts,
  getLegacyStatusPreparationMode,
  getLegacyWeldMigrationState,
  getPresentLegacyControlColumns,
  type LegacyWeldControlColumn,
  type LegacyWeldMigrationMilestones,
} from '../src/lib/legacy-weld-column-cleanup.ts'
import { assertLocalMigrationDatabaseUrl } from '../src/lib/migration-branch-guard.ts'
import { loadServerEnv } from '../src/server-env.ts'

loadServerEnv()

const useRemoteDatabase = process.argv.includes('--remote')
const connectionString = useRemoteDatabase
  ? process.env.DATABASE_URL_REMOTE_FOR_MIGRATIONS
  : process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(useRemoteDatabase
    ? 'DATABASE_URL_REMOTE_FOR_MIGRATIONS is not configured'
    : 'DATABASE_URL is not configured')
}
if (!useRemoteDatabase) {
  assertLocalMigrationDatabaseUrl(connectionString)
}

const migrationMilestones = loadMigrationMilestones()

const pool = new pg.Pool({
  ...getDatabaseConnectionConfig(connectionString, process.env.DATABASE_SSL_CA),
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  allowExitOnIdle: true,
})
const client = await pool.connect()

try {
  await client.query('begin')
  await client.query("set local lock_timeout = '10s'")
  await client.query(
    'select pg_advisory_xact_lock(hashtext($1))',
    ['maintenance:legacy-weld-column-cleanup:v1'],
  )

  const tableResult = await client.query<{ table_name: string | null }>(`
    select to_regclass('public.weld_joints')::text as table_name
  `)

  if (!tableResult.rows[0]?.table_name) {
    await client.query('commit')
    console.log(JSON.stringify({
      database: useRemoteDatabase ? 'remote' : 'local',
      skipped: true,
      reason: 'weld_joints does not exist yet',
    }, null, 2))
  } else {
    await client.query('lock table public.weld_joints in share row exclusive mode')
    const columnsResult = await client.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'weld_joints'
    `)
    const columnNames = columnsResult.rows.map(({ column_name }) => column_name)
    const latestMigrationWhen = await loadLatestMigrationWhen()
    const migrationState = getLegacyWeldMigrationState(latestMigrationWhen, migrationMilestones)
    assertLegacyWeldSchemaMatchesMigrationState(columnNames, migrationState)

    const presentLegacyColumns = getPresentLegacyControlColumns(columnNames)
    const populatedCounts = await loadPopulatedCounts(presentLegacyColumns)
    assertLegacyControlColumnsEmpty(populatedCounts)

    const statusMode = getLegacyStatusPreparationMode(columnNames)
    if (statusMode === 'none' && !columnNames.includes('officiality')) {
      throw new Error(
        'Миграция остановлена: в weld_joints нет ни status, ни officiality. Данные не изменены.',
      )
    }

    let synchronizedOfficialityRows = 0
    let conflictingOfficialityRows = 0
    if (statusMode === 'synchronize') {
      const conflictResult = await client.query<{ count: number }>(`
        select count(*)::int as count
        from public.weld_joints
        where nullif(btrim(status), '') is not null
          and nullif(btrim(officiality), '') is not null
          and lower(btrim(status)) <> lower(btrim(officiality))
      `)
      conflictingOfficialityRows = Number(conflictResult.rows[0]?.count ?? 0)
      assertNoOfficialityConflicts(conflictingOfficialityRows)

      const synchronizationResult = await client.query(`
        update public.weld_joints
        set officiality = status
        where nullif(btrim(status), '') is not null
          and nullif(btrim(officiality), '') is null
      `)
      synchronizedOfficialityRows = synchronizationResult.rowCount ?? 0
    }

    await client.query('commit')
    console.log(JSON.stringify({
      database: useRemoteDatabase ? 'remote' : 'local',
      skipped: false,
      checkedLegacyControlColumns: presentLegacyColumns.length,
      latestMigrationWhen,
      statusMode,
      conflictingOfficialityRows,
      synchronizedOfficialityRows,
    }, null, 2))
  }
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}

async function loadPopulatedCounts(
  columnNames: readonly LegacyWeldControlColumn[],
): Promise<Partial<Record<LegacyWeldControlColumn, number>>> {
  if (columnNames.length === 0) return {}

  // Every identifier comes from the fixed allowlist above, never from user input.
  const selections = columnNames
    .map((columnName) => (
      `count(*) filter (where nullif(btrim("${columnName}"::text), '') is not null)::int as "${columnName}"`
    ))
    .join(', ')
  const result = await client.query<Record<string, number>>(
    `select ${selections} from public.weld_joints`,
  )
  const row = result.rows[0] ?? {}
  return Object.fromEntries(
    columnNames.map((columnName) => [columnName, Number(row[columnName] ?? 0)]),
  )
}

async function loadLatestMigrationWhen(): Promise<number | null> {
  const migrationTableResult = await client.query<{ table_name: string | null }>(`
    select to_regclass('drizzle.__drizzle_migrations')::text as table_name
  `)
  if (!migrationTableResult.rows[0]?.table_name) return null

  const latestMigrationResult = await client.query<{ created_at: string | number | null }>(`
    select max(created_at) as created_at
    from drizzle.__drizzle_migrations
  `)
  const rawValue = latestMigrationResult.rows[0]?.created_at
  if (rawValue === null || rawValue === undefined) return null

  const latestMigrationWhen = Number(rawValue)
  if (!Number.isSafeInteger(latestMigrationWhen)) {
    throw new Error('Миграция остановлена: история Drizzle содержит некорректную дату миграции.')
  }
  return latestMigrationWhen
}

function loadMigrationMilestones(): LegacyWeldMigrationMilestones {
  const journalPath = resolve(process.cwd(), 'drizzle/meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries?: Array<{ tag?: unknown; when?: unknown }>
  }
  const entriesByTag = new Map(
    (journal.entries ?? []).map((entry) => [String(entry.tag ?? ''), Number(entry.when)]),
  )

  return {
    officialityRename: requireMigrationTimestamp(entriesByTag, '0029_brave_microbe'),
    legacyControlRemoval: requireMigrationTimestamp(entriesByTag, '0031_slimy_terrax'),
    compatibilityRestore: requireMigrationTimestamp(entriesByTag, '0035_natural_princess_powerful'),
    finalCleanup: requireMigrationTimestamp(entriesByTag, '0036_careful_jack_murdock'),
  }
}

function requireMigrationTimestamp(entriesByTag: ReadonlyMap<string, number>, tag: string): number {
  const timestamp = entriesByTag.get(tag)
  if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)) {
    throw new Error(`В журнале Drizzle отсутствует контрольная миграция ${tag}.`)
  }
  return timestamp
}
