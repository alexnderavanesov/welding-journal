import { execFileSync } from 'node:child_process'
import pg, { type PoolClient } from 'pg'

import { getDatabaseConnectionConfig } from '../src/db/ssl.ts'
import { assertLocalMigrationDatabaseUrl } from '../src/lib/migration-branch-guard.ts'
import { loadServerEnv } from '../src/server-env.ts'
import {
  CONTROL_ASSIGNMENT_CLEANUP_FIELDS,
  assertControlAssignmentCleanupSchema,
  assertControlAssignmentCleanupPreconditions,
  assertControlAssignmentPlanCanApply,
  assertRemoteControlAssignmentCleanupPublishedCommit,
  assertRemoteControlAssignmentCleanupWorkspace,
  buildControlAssignmentAuditSql,
  buildControlAssignmentCleanupConfirmation,
  buildControlAssignmentCleanupPlan,
  buildControlAssignmentFingerprintSql,
  buildControlAssignmentUpdateExplainSql,
  buildControlAssignmentUpdateSql,
  getControlAssignmentUpdateParams,
  parseControlAssignmentCleanupArgs,
  type ControlAssignmentAuditRow,
  type ControlAssignmentCleanupOptions,
  type ControlAssignmentCleanupPlan,
  type ControlAssignmentDatabaseIdentity,
  type ControlAssignmentSchemaInspection,
} from './control-assignment-cleanup.ts'

loadServerEnv()

main().catch((error) => {
  console.error(formatCleanupError(error))
  process.exitCode = 1
})

async function main() {
  const options = parseControlAssignmentCleanupArgs(process.argv.slice(2))
  assertControlAssignmentCleanupPreconditions(options)
  if (options.remote) assertRemoteReleaseWorkspaceBeforeConnection()

  const connectionString = options.remote
    ? process.env.DATABASE_URL_REMOTE_FOR_MIGRATIONS
    : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(options.remote
      ? 'DATABASE_URL_REMOTE_FOR_MIGRATIONS is not configured'
      : 'DATABASE_URL is not configured')
  }
  if (!options.remote) assertLocalMigrationDatabaseUrl(connectionString)

  const pool = new pg.Pool({
    ...getDatabaseConnectionConfig(connectionString, process.env.DATABASE_SSL_CA),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  })
  let client: PoolClient | null = null

  try {
    client = await pool.connect()
    if (options.apply) await applyCleanup(client, options)
    else await inspectCleanup(client, options)
  } finally {
    client?.release()
    await pool.end()
  }
}

async function inspectCleanup(client: PoolClient, options: ControlAssignmentCleanupOptions) {
  await client.query('begin transaction isolation level repeatable read read only')
  try {
    await client.query("set local statement_timeout = '60s'")
    await assertExpectedSchema(client)
    await client.query(
      buildControlAssignmentUpdateExplainSql(),
      getControlAssignmentUpdateParams(),
    )
    const snapshot = await loadSnapshot(client, options)
    await client.query('rollback')

    const canApply = snapshot.plan.changedCells > 0 && snapshot.plan.unknownCells === 0
    console.log(JSON.stringify({
      mode: 'dry-run',
      database: snapshot.database,
      rowCount: snapshot.rowCount,
      changedCells: snapshot.plan.changedCells,
      unknownCells: snapshot.plan.unknownCells,
      fields: snapshot.plan.fields,
      updatePlanVerified: true,
      canApply,
      ...(canApply ? {
        confirmationToken: snapshot.confirmation,
        applyCommand: buildApplyCommand(options.remote, snapshot.confirmation),
      } : {}),
      note: canApply
        ? 'Данные не изменены. Код действует только для показанного состояния базы.'
        : snapshot.plan.unknownCells > 0
          ? 'Данные не изменены. Неизвестные значения нужно разобрать вручную до применения.'
          : 'Данные не изменены. Очистка не требуется.',
    }, null, 2))

    if (snapshot.plan.unknownCells > 0) process.exitCode = 2
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  }
}

async function applyCleanup(client: PoolClient, options: ControlAssignmentCleanupOptions) {
  await client.query('begin transaction isolation level serializable')
  try {
    await client.query("set local lock_timeout = '5s'")
    await client.query("set local statement_timeout = '120s'")
    const lockResult = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
      ['maintenance:normalize-control-assignment-values:v1'],
    )
    if (!lockResult.rows[0]?.locked) {
      throw new Error('Очистка не запущена: другая операция нормализации уже выполняется.')
    }

    await assertExpectedSchema(client)
    const before = await loadSnapshot(client, options)
    assertControlAssignmentPlanCanApply(before.plan)
    if (options.confirmation !== before.confirmation) {
      throw new Error(
        'Очистка не запущена: код подтверждения не соответствует этой базе или ее текущее состояние изменилось. '
        + 'Повторите dry-run.',
      )
    }

    const updateResult = await client.query(
      buildControlAssignmentUpdateSql(),
      getControlAssignmentUpdateParams(),
    )
    const afterPlan = await loadAuditPlan(client)
    if (afterPlan.changedCells > 0 || afterPlan.unknownCells > 0) {
      throw new Error(
        'Проверка после очистки не пройдена. Транзакция будет полностью отменена, данные не изменены.',
      )
    }

    await client.query('commit')
    console.log(JSON.stringify({
      mode: 'apply',
      database: before.database,
      rowCount: before.rowCount,
      updatedRows: updateResult.rowCount ?? 0,
      normalizedCells: before.plan.changedCells,
      verification: 'passed',
    }, null, 2))
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  }
}

async function loadSnapshot(client: PoolClient, options: ControlAssignmentCleanupOptions) {
  const identityResult = await client.query<{
    database: string
    user: string
    server_address: string | null
    server_port: number | null
  }>(`
    select
      current_database() as database,
      current_user as "user",
      inet_server_addr()::text as server_address,
      inet_server_port()::int as server_port
  `)
  const fingerprintResult = await client.query<{ row_count: number; fingerprint: string }>(
    buildControlAssignmentFingerprintSql(),
  )

  const identityRow = identityResult.rows[0]
  const fingerprintRow = fingerprintResult.rows[0]
  if (!identityRow || !fingerprintRow) throw new Error('Не удалось получить состояние базы для проверки.')

  const database: ControlAssignmentDatabaseIdentity & { scope: 'local' | 'remote' } = {
    scope: options.remote ? 'remote' : 'local',
    database: identityRow.database,
    user: identityRow.user,
    serverAddress: identityRow.server_address ?? 'local-socket',
    serverPort: identityRow.server_port === null ? null : Number(identityRow.server_port),
  }
  const rowCount = Number(fingerprintRow.row_count)
  const fingerprint = fingerprintRow.fingerprint
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || !fingerprint) {
    throw new Error('База вернула некорректный контрольный снимок. Данные не изменены.')
  }
  const plan = await loadAuditPlan(client)
  const confirmation = buildControlAssignmentCleanupConfirmation({
    scope: database.scope,
    identity: database,
    fingerprint,
    rowCount,
    plan,
  })

  return { database, rowCount, fingerprint, plan, confirmation }
}

async function loadAuditPlan(client: PoolClient): Promise<ControlAssignmentCleanupPlan> {
  const auditResult = await client.query<ControlAssignmentAuditRow>(buildControlAssignmentAuditSql())
  return buildControlAssignmentCleanupPlan(auditResult.rows)
}

async function assertExpectedSchema(client: PoolClient) {
  const tableResult = await client.query<{ table_name: string | null }>(`
    select to_regclass('public.weld_joints')::text as table_name
  `)
  const tableName = tableResult.rows[0]?.table_name ?? null
  if (!tableName) assertControlAssignmentCleanupSchema(emptySchemaInspection())

  const tableMetadataResult = await client.query<{
    relkind: string
    relrowsecurity: boolean
    relforcerowsecurity: boolean
  }>(`
    select relkind, relrowsecurity, relforcerowsecurity
    from pg_class
    where oid = 'public.weld_joints'::regclass
  `)

  const columnsResult = await client.query<{
    column_name: string
    data_type: string
    is_generated: string
  }>(`
    select column_name, data_type, is_generated
    from information_schema.columns
    where table_schema = 'public' and table_name = 'weld_joints'
  `)
  const triggerResult = await client.query<{ name: string }>(`
    select tgname as name
    from pg_trigger
    where tgrelid = 'public.weld_joints'::regclass and not tgisinternal
    order by tgname
  `)
  const ruleResult = await client.query<{ name: string }>(`
    select rulename as name
    from pg_rewrite
    where ev_class = 'public.weld_joints'::regclass and rulename <> '_RETURN'
    order by rulename
  `)
  const tableMetadata = tableMetadataResult.rows[0]

  assertControlAssignmentCleanupSchema({
    tableName,
    tableKind: tableMetadata?.relkind ?? null,
    rowSecurityEnabled: Boolean(tableMetadata?.relrowsecurity),
    rowSecurityForced: Boolean(tableMetadata?.relforcerowsecurity),
    columns: columnsResult.rows.map((row) => ({
      columnName: row.column_name,
      dataType: row.data_type,
      isGenerated: row.is_generated,
    })),
    triggerNames: triggerResult.rows.map((row) => row.name),
    ruleNames: ruleResult.rows.map((row) => row.name),
  })
}

function emptySchemaInspection(): ControlAssignmentSchemaInspection {
  return {
    tableName: null,
    tableKind: null,
    rowSecurityEnabled: false,
    rowSecurityForced: false,
    columns: [],
    triggerNames: [],
    ruleNames: [],
  }
}

function assertRemoteReleaseWorkspaceBeforeConnection() {
  const branch = runGit(['branch', '--show-current'])
  const gitStatus = runGit(['status', '--porcelain', '--untracked-files=normal'])
  assertRemoteControlAssignmentCleanupWorkspace(branch, gitStatus)

  const localHead = runGit(['rev-parse', 'HEAD'])
  const remoteMain = runGit(['ls-remote', '--exit-code', 'origin', 'refs/heads/main'])
    .trim()
    .split(/\s+/)[0]
  assertRemoteControlAssignmentCleanupPublishedCommit(localHead, remoteMain)
}

function buildApplyCommand(remote: boolean, confirmation: string) {
  const script = remote
    ? 'pnpm maintenance:normalize-control-assignments:remote'
    : 'pnpm maintenance:normalize-control-assignments'
  const remoteConfirmations = remote
    ? ' --backup-confirmed --maintenance-window-confirmed --release-deployed-confirmed'
    : ''
  return `${script} --apply --confirm=${confirmation}${remoteConfirmations}`
}

function runGit(args: string[]) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function rollbackQuietly(client: PoolClient) {
  try {
    await client.query('rollback')
  } catch {
    // Preserve the original error; a broken connection may make rollback unavailable.
  }
}

function formatCleanupError(error: unknown): string {
  if (error instanceof AggregateError) {
    const messages = error.errors
      .map((item) => formatCleanupError(item))
      .filter(Boolean)
    if (messages.length > 0) return [...new Set(messages)].join('; ')
  }
  if (error instanceof Error) {
    if (error.message.trim()) return error.message
    if (error.cause) return formatCleanupError(error.cause)
  }
  const text = String(error ?? '').trim()
  return text || 'Не удалось выполнить проверку назначений: неизвестная ошибка подключения.'
}
