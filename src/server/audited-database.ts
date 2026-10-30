import type { AuditValue } from '@/lib/audit-value'
import { createHash } from 'node:crypto'
import { and, eq, getTableColumns, getTableName, or, sql, type SQL } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import type { requireDb } from '@/db'
import { assertPermission } from '@/lib/access-permissions'
import { accessContext, type AccessContext } from './access-store'

type Database = ReturnType<typeof requireDb>
type Row = Record<string, any>
type Executor = any // The wrapper preserves each public Drizzle builder's original type.
const LOCK = 84192703
const auditedTables: PgTable[] = [schema.weldJoints, schema.preHeatTreatmentControls, schema.pstoRepeatCycles,
  schema.duplicateControls, schema.linePrograms, schema.pstoChainExceptions, schema.welderStamps,
  schema.welderStampSuspensions, schema.specialists, schema.technologyCards, schema.technologyCardNames,
  schema.generatedDocuments, schema.generatedDocumentWeldJoints, schema.documentTemplates,
  schema.dispatcherAcceptedWarnings, schema.appSettings]
const auditedSet = new Set(auditedTables)
const technicalFields = new Set(['updatedAt', 'createdAt', 'weldingUpdatedAt', 'lnkUpdatedAt', 'pstoUpdatedAt',
  'lnkCreatedAt', 'pstoCreatedAt', 'revision', 'documentVersion', 'specialistsRevision', 'firstUsedAt'])
type Change = { table: PgTable; before?: Row; after?: Row }
type State = { changes: Map<string, Change>; context: AccessContext; checked: boolean }
const states = new WeakMap<object, State>()
type TableMetadata = { columns: Record<string, any>; keys: any[]; names: Map<any, string>; keyNames: string[] }
const tableMetadata = new WeakMap<PgTable, TableMetadata>()
function metadata(table: PgTable): TableMetadata {
  const cached = tableMetadata.get(table)
  if (cached) return cached
  const columns = getTableColumns(table) as Record<string, any>
  const config = getTableConfig(table)
  const primary = config.primaryKeys.flatMap(key => key.columns)
  const keys = Object.values(columns).filter(column => column.primary || primary.includes(column))
  const names = new Map(Object.entries(columns).map(([name, column]) => [column, name]))
  const value = { columns, keys, names, keyNames: keys.map(column => names.get(column)!) }
  tableMetadata.set(table, value)
  return value
}
function columns(table: PgTable) { return metadata(table).columns }
function keyColumns(table: PgTable) { return metadata(table).keys }
function columnKey(table: PgTable, column: any) {
  const key = metadata(table).names.get(column)
  if (!key) throw new Error('Неизвестный ключ записи истории.')
  return key
}
function identity(table: PgTable, row: Row) {
  return metadata(table).keyNames.map(key => String(row[key])).join(':')
}
function addChange(state: State, table: PgTable, before: Row | undefined, after: Row | undefined) {
  const row = after ?? before
  if (!row) return
  // Service counters/initialization are not user setting changes.
  if (table === schema.appSettings && !['control-processes', 'data-list', 'dispatcher', 'dispatcher-background',
    'dispatcher-reminders', 'other', 'request-conclusion', 'save-check', 'system-index', 'specialist-defaults'].includes(row.key) && !/^reset.*Sequence$/.test(state.context.operation)) return
  const key = `${getTableName(table)}:${identity(table, row)}`
  const previous = state.changes.get(key)
  state.changes.set(key, { table, before: previous ? previous.before : before, after })
}
async function checkActor(tx: Executor, state: State) {
  if (state.checked) return
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${LOCK})`)
  const [user] = await tx.select().from(schema.authUsers).where(eq(schema.authUsers.id, state.context.identity.id)).for('share')
  if (!user || user.status !== 'active' || !user.emailVerified) throw new Error('AUTH_REQUIRED: Доступ отозван.')
  for (const permission of state.context.permissions) assertPermission(user, permission)
  state.context.identity = { ...state.context.identity, ...user }
  state.checked = true
}
function keyCondition(table: PgTable, row: Row, keys = keyColumns(table)) {
  return and(...keys.map(column => eq(column, row[columnKey(table, column)])))
}
async function readBefore(tx: Executor, table: PgTable, where?: SQL) {
  return await tx.select().from(table).where(where).orderBy(...keyColumns(table)).for('update') as Row[]
}
function wrapMutation(tx: Executor, state: State, table: PgTable, kind: string, builder: Executor,
  metadata: { where?: SQL; values?: Row[]; returning?: Row; conflictKeys?: any[] } = {}): Executor {
  let execution: Promise<any> | undefined
  const execute = () => execution ??= (async () => {
    await checkActor(tx, state)
    let before: Row[] = []
    if (kind !== 'insert') before = await readBefore(tx, table, metadata.where)
    else {
      const keys = metadata.conflictKeys?.length ? metadata.conflictKeys : keyColumns(table)
      const existing = (metadata.values ?? []).filter(row => keys.every(column => row[columnKey(table, column)] != null))
      // Bounded by the existing mutation batch, never scan the table for a new serial ID.
      if (existing.length) before = await readBefore(tx, table, or(...existing.map(row => keyCondition(table, row, keys))))
    }
    if (kind === 'delete' && table === schema.weldJoints && before.length) {
      const ids = before.map(row => row.id)
      for (const child of [schema.preHeatTreatmentControls, schema.pstoRepeatCycles, schema.duplicateControls, schema.generatedDocumentWeldJoints]) {
        const rows = await readBefore(tx, child, sql`${child.weldJointId} = any(${sql.param(ids)}::integer[])`)
        for (const row of rows) addChange(state, child, row, undefined)
      }
    }
    if (kind === 'delete' && table === schema.generatedDocuments && before.length) {
      const rows = await readBefore(tx, schema.generatedDocumentWeldJoints, sql`${schema.generatedDocumentWeldJoints.documentId} = any(${sql.param(before.map(row => row.id))}::integer[])`)
      for (const row of rows) addChange(state, schema.generatedDocumentWeldJoints, row, undefined)
    }
    if (kind === 'delete' && table === schema.welderStamps && before.length) {
      const rows = await readBefore(tx, schema.dispatcherAcceptedWarnings, sql`${schema.dispatcherAcceptedWarnings.welderStampId} = any(${sql.param(before.map(row => row.id))}::integer[])`)
      for (const row of rows) addChange(state, schema.dispatcherAcceptedWarnings, row, undefined)
    }
    const selected = metadata.returning
    const capture = Object.fromEntries(Object.entries(columns(table)).map(([key, column]) => [`__audit_${key}`, column]))
    const result: Row[] = await builder.returning({ ...selected, ...capture })
    const previous = new Map(before.map(row => [identity(table, row), row]))
    for (const row of result) {
      const saved = Object.fromEntries(Object.keys(columns(table)).map(key => [key, row[`__audit_${key}`]]))
      addChange(state, table, previous.get(identity(table, saved)) ?? (kind === 'delete' ? saved : undefined), kind === 'delete' ? undefined : saved)
    }
    if (!selected) return { rows: [], rowCount: result.length }
    return result.map(row => Object.fromEntries(Object.keys(selected).map(key => [key, row[key]])))
  })()
  return new Proxy(builder, { get(target, property) {
    if (property === 'then') return (resolve: any, reject: any) => execute().then(resolve, reject)
    if (property === 'catch') return (reject: any) => execute().catch(reject)
    if (property === 'finally') return (callback: any) => execute().finally(callback)
    if (property === 'execute') return execute
    if (property === 'prepare') return () => { throw new Error('Подготовленная изменяющая операция требует явной поддержки истории.') }
    const value = Reflect.get(target, property, target)
    if (typeof value !== 'function') return value
    if (['getSQL', 'toSQL'].includes(String(property))) return value.bind(target)
    return (...args: any[]) => {
      if (property === 'where') metadata.where = args[0]
      if (property === 'values') metadata.values = Array.isArray(args[0]) ? args[0] : [args[0]]
      if (property === 'returning') metadata.returning = args[0] ?? columns(table)
      if (property === 'onConflictDoUpdate' || property === 'onConflictDoNothing') {
        const target = args[0]?.target
        if (target) metadata.conflictKeys = Array.isArray(target) ? target : [target]
      }
      return wrapMutation(tx, state, table, kind, value.apply(target, args), metadata)
    }
  } })
}
function wrapTransaction(tx: Executor, state: State): Executor {
  const wrapped = new Proxy(tx, { get(target, property) {
    if (property === 'transaction') return async (run: (tx: Executor) => Promise<unknown>, ...args: any[]) => {
      const previous = new Map(state.changes), checked = state.checked
      try { return await target.transaction((nested: Executor) => run(wrapTransaction(nested, state)), ...args) }
      catch (error) { state.changes = previous; state.checked = checked; throw error }
    }
    const value = Reflect.get(target, property, target)
    if (['insert', 'update', 'delete'].includes(String(property))) return (table: PgTable) => {
      const builder = value.call(target, table)
      return auditedSet.has(table) ? wrapMutation(target, state, table, String(property), builder) : builder
    }
    return typeof value === 'function' ? value.bind(target) : value
  } })
  states.set(wrapped, state)
  return wrapped
}
export function businessFieldChanges(before: Row | undefined, after: Row | undefined) {
  const changed: Record<string, { before?: AuditValue; after?: AuditValue }> = {}
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (technicalFields.has(key)) continue
    if (Object.is(before?.[key], after?.[key])) continue
    const compact = (value: unknown): AuditValue | undefined => ['fileData', 'fileDataBase64', 'blobKey', 'constructorConfig', 'metadata'].includes(key) && value != null ? { sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') } : value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    const oldValue = compact(before?.[key]), newValue = compact(after?.[key])
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changed[key] = { ...(before ? { before: oldValue } : {}), ...(after ? { after: newValue } : {}) }
  }
  return changed
}
function areaForTable(table: PgTable, row: Row, fallback: string) {
  if ([schema.preHeatTreatmentControls, schema.duplicateControls].includes(table as any)) return 'lnk'
  if (table === schema.pstoRepeatCycles || table === schema.pstoChainExceptions) return 'psto'
  if (table === schema.weldJoints) return 'welding'
  if ([schema.generatedDocuments, schema.generatedDocumentWeldJoints].includes(table as any)) return 'documents'
  if (table === schema.documentTemplates) return 'templates'
  if (table === schema.linePrograms) return 'lines'
  if (table === schema.dispatcherAcceptedWarnings) return 'exceptions'
  return table === schema.appSettings ? fallback : 'references'
}
async function flush(tx: Executor, state: State) {
  let recorded = false
  let details: Array<typeof schema.auditChanges.$inferInsert> = []
  const writeBatch = async () => {
    if (!details.length) return
    if (!recorded) {
      await tx.insert(schema.auditOperations).values({ id: state.context.operationId, actorId: state.context.identity.id,
        actorName: state.context.identity.name, action: state.context.operation, area: state.context.area,
        source: /import|replace|massFill/i.test(state.context.operation) ? 'import' : 'application' }).onConflictDoNothing()
      recorded = true
    }
    await tx.insert(schema.auditChanges).values(details)
    details = []
  }
  // Keep one insertion batch, not a second complete copy of a mass operation.
  // All batches remain inside the same business transaction.
  for (const [key, { table, before, after }] of state.changes) {
    const changes = businessFieldChanges(before, after)
    state.changes.delete(key)
    if (!Object.keys(changes).length) continue
    const row = after ?? before!
    details.push({ operationId: state.context.operationId, entity: getTableName(table), entityId: identity(table, row),
      jointId: table === schema.weldJoints ? row.id : row.weldJointId ?? null,
      label: table === schema.weldJoints ? [row.projectTitle, row.subtitleCode, row.line, row.joint].filter(Boolean).join(' · ') || identity(table, row)
        : String(row.title ?? row.name ?? row.key ?? identity(table, row)),
      area: areaForTable(table, row, state.context.area), kind: !before ? 'create' : !after ? 'delete' : 'update', changes })
    if (details.length === 500) await writeBatch()
  }
  await writeBatch()
}
/** Raw bulk SQL explicitly declares its bounded affected scope. */
export async function auditSql<T>(tx: Executor, scopes: Array<{ table: PgTable; where: SQL }>, run: () => PromiseLike<T>): Promise<T> {
  const state = states.get(tx)
  if (!state) return run()
  await checkActor(tx, state)
  const before = await Promise.all(scopes.map(scope => readBefore(tx, scope.table, scope.where)))
  const result = await run()
  for (let i = 0; i < scopes.length; i++) {
    const { table, where } = scopes[i]
    const after = await tx.select().from(table).where(where) as Row[]
    const previous = new Map(before[i].map(row => [identity(table, row), row]))
    for (const row of after) { const key = identity(table, row); addChange(state, table, previous.get(key), row); previous.delete(key) }
    for (const row of previous.values()) addChange(state, table, row, undefined)
  }
  return result
}
/** A plain INSERT returns its generated IDs; it cannot update existing rows. */
export async function auditInsertedSql<T extends { rows: any[] }>(tx: Executor, table: PgTable, run: () => PromiseLike<T>): Promise<T> {
  const state = states.get(tx)
  if (!state) return run()
  await checkActor(tx, state)
  const result = await run()
  const ids = result.rows.map(row => row.id)
  if (ids.some(id => !Number.isInteger(id))) throw new Error('Создание записи требует ID для истории.')
  if (ids.length) {
    const rows = await tx.select().from(table).where(sql`${columns(table).id} = any(${sql.param(ids)}::integer[])`)
    if (rows.length !== ids.length) throw new Error('Не удалось записать полную историю создания.')
    for (const row of rows) addChange(state, table, undefined, row)
  }
  return result
}
export function withAuditedTransactions(database: Database): Database {
  return new Proxy(database, { get(target, property) {
    if (property === 'transaction') return (run: (tx: Executor) => Promise<unknown>, ...args: any[]) => {
      const context = accessContext.getStore()
      if (!context || context.area === 'access' || !context.permissions.some(permission => /\.(edit|import|delete|generate)$/.test(permission)) || /^(get|list|read|preview|copy|select|summarize|count|check|find|load|search|plan)[A-Z]/.test(context.operation)) return (target.transaction as any)(run, ...args)
      return (target.transaction as any)(async (tx: Executor) => {
        const state: State = { changes: new Map(), context, checked: false }
        const result = await run(wrapTransaction(tx, state))
        await flush(tx, state)
        return result
      }, ...args)
    }
    const value = Reflect.get(target, property, target)
    // Business writes outside a transaction are forbidden once a user request
    // is established. Caches and Better Auth keep their own explicit paths.
    if (['insert', 'update', 'delete'].includes(String(property))) return (table: PgTable) => {
      if (accessContext.getStore() && auditedSet.has(table)) throw new Error('Рабочее изменение требует транзакции с историей.')
      return value.call(target, table)
    }
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
