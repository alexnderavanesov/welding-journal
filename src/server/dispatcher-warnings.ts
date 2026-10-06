import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, desc, eq, getTableColumns, gte, ilike, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  dispatcherAcceptedWarnings,
  dispatcherTaskIndexState,
  dispatcherTaskPages,
  linePrograms, weldJoints, welderStamps,
  type DispatcherAcceptedWarning,
} from '@/db/schema'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'
import { ensureDispatcherTaskIndexFresh, getDispatcherScopeKey } from '@/server/dispatcher-task-index'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { lockWeldLineMemberships, lockWeldLineMembershipsForWeldIds } from './weld-line-membership-lock'
import { lockInteractiveWeldRows } from './weld-row-version'
import { acceptedWarningObjectForTask, acceptedWarningContextSql, acceptedWarningTitleSql, acceptedWarningVersionSql, lockAcceptedWarningWrites, lockAcceptedWarningOwners } from './accepted-warning-objects'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  canAcceptDispatcherTask,
  getDispatcherTaskAcceptanceContext,
  getDispatcherTaskAcceptanceTitle,
} from '@/lib/dispatcher-task-acceptance'
import { parseEarlyCoilDecisionKey } from '@/lib/early-coil-decision'
import { revokeEarlyCoilDecisionInTransaction } from '@/server/early-coil-workflow'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import {
  DISPATCHER_INDEX_LOCK_ID,
  DISPATCHER_INDEX_STATE_ID,
} from '@/server/dispatcher-task-index-constants'
import {
  isDispatcherTaskIndexPayloadCurrent,
  parseDispatcherTaskIndexPayload,
} from '@/lib/dispatcher-task-index-payload'
import type { DispatcherTask, WelderStampExpiryTask } from '@/lib/dispatcher-types'
import {
  clampDispatcherAcceptedWarningPage,
  getDispatcherAcceptedWarningPeriodStart,
  normalizeDispatcherAcceptedWarningsRequest,
  type DispatcherAcceptedWarningCategory,
  type DispatcherAcceptedWarningsRequest,
} from '@/lib/dispatcher-accepted-warning-query'

export type DispatcherAcceptedWarningPayload = {
  key: string
  kind: string
  code: string
  title: string
  context: string
  acceptedAt: string
}

export type DispatcherAcceptedWarningsPage = {
  items: DispatcherAcceptedWarningPayload[]
  total: number
  overallTotal: number
  page: number
  pageSize: number
}

type AcceptDispatcherWarningInput = {
  key: string
  scope?: { projectTitle?: string | null; subtitleCode?: string | null; line?: string | null }
}

const toPayload = (row: DispatcherAcceptedWarning): DispatcherAcceptedWarningPayload => ({
  key: row.key,
  kind: row.kind,
  code: row.code ?? '',
  title: row.title ?? '',
  context: row.context ?? '',
  acceptedAt: row.acceptedAt.toISOString(),
})

export const acceptDispatcherWarning = createServerFn({ method: 'POST' })
  .validator((data: AcceptDispatcherWarningInput) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const key = String(data.key ?? '').trim()
    if (!key) throw new Error('Не передан ключ предупреждения')
    await ensureDispatcherTaskIndexFresh()
    const db = requireDb()
    return db.transaction(async (tx) => {
      await lockAcceptedWarningWrites(tx)
      const [initialState] = await tx.select().from(dispatcherTaskIndexState).where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID)).limit(1)
      const initialTask = await findCurrentDispatcherTask(tx, key, initialState, data.scope)
      if (!initialTask) throw new Error('Эта задача уже исправлена или изменилась. Обновите диспетчер.')
      const object = await acceptedWarningObjectForTask(tx, initialTask)
      // Parent FKs must be locked before the index: owner deletion takes them
      // first too. Re-read the task after waiting, never accept a stale snapshot.
      await lockAcceptedWarningOwners(tx, object)
      await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
      const [state] = await tx
        .select()
        .from(dispatcherTaskIndexState)
        .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
        .limit(1)
      const task = await findCurrentDispatcherTask(tx, key, state, data.scope)
      if (!task) throw new Error('Эта задача уже исправлена или изменилась. Обновите диспетчер.')
      if (!canAcceptDispatcherTask(task)) {
        throw new Error('Для этой задачи нельзя создать принятое исключение.')
      }
      const kind = task.kind
      const code = getDispatcherTaskCode(task)
      const title = getDispatcherTaskAcceptanceTitle(task)
      const context = getDispatcherTaskAcceptanceContext(task)
      const inserted = await tx
        .insert(dispatcherAcceptedWarnings)
        .values({ key, kind, ...object, code: code || null, title: title || null, context: context || null })
        .onConflictDoNothing()
        .returning()
      const [row] = inserted.length > 0
        ? inserted
        : await tx
            .select()
            .from(dispatcherAcceptedWarnings)
            .where(eq(dispatcherAcceptedWarnings.key, key))
            .limit(1)
      if (!row) throw new Error('Не удалось сохранить принятое предупреждение')
      if (inserted.length > 0) {
        await markDispatcherTaskIndexDirty(tx, {
          scopes: 'row' in task ? getDispatcherDirtyScopes([task.row], new Map()) : [], fullRebuild: false,
        })
      }
      return toPayload(row)
    })
  })

export async function findCurrentDispatcherTask(
  tx: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  key: string,
  state: typeof dispatcherTaskIndexState.$inferSelect | undefined,
  scope?: AcceptDispatcherWarningInput['scope'],
): Promise<DispatcherTask | undefined> {
  if (
    !state ||
    state.sourceRevision !== state.computedRevision ||
    state.fullRebuild ||
    !isDispatcherTaskIndexPayloadCurrent(state.repeatedTasks)
  ) return undefined

  const cached = [
    ...parseDispatcherTaskIndexPayload(state.repeatedTasks).tasks,
    ...parseJsonArray<WelderStampExpiryTask>(state.welderStampExpiryTasks),
  ].find((task) => task.key === key)
  if (cached) return cached
  // The compact snapshot is not the full registry. Lookup returns a single card;
  // current clients provide a scope hint, verified against the saved task key.
  const result = await tx.execute<{ task: DispatcherTask }>(sql`
    select entry.value as task from ${dispatcherTaskPages} pages
    cross join lateral jsonb_array_elements(pages.tasks::jsonb) entry(value)
    where ${scope ? sql`pages.scope_key = ${getDispatcherScopeKey(scope)}` : sql`true`}
      and entry.value->>'key' = ${key} limit 1
  `)
  return result.rows[0]?.task
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export function buildAcceptedWarningCategoryWhere(category: DispatcherAcceptedWarningCategory) {
  if (category === 'percentage-line-control' || category === 'line-program-control' || category === 'early-coil') {
    return eq(dispatcherAcceptedWarnings.kind, category)
  }
  if (category === 'other') return notInArray(dispatcherAcceptedWarnings.kind, ['percentage-line-control', 'line-program-control', 'early-coil'])
  return undefined
}

export const listDispatcherAcceptedWarnings = createServerFn({ method: 'GET' })
  .validator((data: DispatcherAcceptedWarningsRequest | undefined) => normalizeDispatcherAcceptedWarningsRequest(data))
  .handler(async ({ data }): Promise<DispatcherAcceptedWarningsPage> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const clauses: SQL[] = []

      if (data.search) {
        const search = `%${data.search}%`
        const searchWhere = or(
          ilike(dispatcherAcceptedWarnings.key, search),
          ilike(dispatcherAcceptedWarnings.code, search),
          ilike(acceptedWarningTitleSql, search),
          ilike(acceptedWarningContextSql, search),
        )
        if (searchWhere) clauses.push(searchWhere)
      }

      const categoryWhere = buildAcceptedWarningCategoryWhere(data.category)
      if (categoryWhere) clauses.push(categoryWhere)

      const periodStart = getDispatcherAcceptedWarningPeriodStart(data.period)
      if (periodStart) clauses.push(gte(dispatcherAcceptedWarnings.acceptedAt, periodStart))

      const where = clauses.length > 0 ? and(...clauses) : undefined
      const orderBy = data.sort === 'oldest'
        ? [asc(dispatcherAcceptedWarnings.acceptedAt), asc(dispatcherAcceptedWarnings.key)]
        : [desc(dispatcherAcceptedWarnings.acceptedAt), desc(dispatcherAcceptedWarnings.key)]
      const [countRow] = await tx
        .select({
          overallTotal: count(),
          total: where ? sql<number>`count(*) filter (where ${where})` : count(),
        })
        .from(dispatcherAcceptedWarnings)
        .leftJoin(weldJoints, eq(weldJoints.id, dispatcherAcceptedWarnings.weldJointId))
        .leftJoin(linePrograms, eq(linePrograms.id, dispatcherAcceptedWarnings.lineProgramId))
        .leftJoin(welderStamps, eq(welderStamps.id, dispatcherAcceptedWarnings.welderStampId))
      const total = Number(countRow?.total) || 0
      const page = clampDispatcherAcceptedWarningPage(data.page, total, data.pageSize)
      const rows = await tx
        .select({ ...getTableColumns(dispatcherAcceptedWarnings), context: acceptedWarningContextSql, title: acceptedWarningTitleSql })
        .from(dispatcherAcceptedWarnings)
        .leftJoin(weldJoints, eq(weldJoints.id, dispatcherAcceptedWarnings.weldJointId))
        .leftJoin(linePrograms, eq(linePrograms.id, dispatcherAcceptedWarnings.lineProgramId))
        .leftJoin(welderStamps, eq(welderStamps.id, dispatcherAcceptedWarnings.welderStampId))
        .where(where)
        .orderBy(...orderBy)
        .limit(data.pageSize)
        .offset((page - 1) * data.pageSize)

      return {
        items: rows.map(toPayload),
        total,
        overallTotal: Number(countRow?.overallTotal) || 0,
        page,
        pageSize: data.pageSize,
      }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  })

export const revokeDispatcherAcceptedWarning = createServerFn({ method: 'POST' })
  .validator((data: { key: string }) => ({ key: String(data?.key ?? '').trim() }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const earlyCoilDecision = parseEarlyCoilDecisionKey(data.key)
    if (earlyCoilDecision) await assertSecurityScope('delete')
    if (!data.key) throw new Error('Не передан ключ принятого исключения')
    const db = requireDb()
    const result = await db.transaction(async (tx) => {
      if (earlyCoilDecision) await loadControlProcessSettingsFromTransaction(tx)
      const earlyCoilResult = await revokeEarlyCoilDecisionInTransaction(tx, data.key)
      if (earlyCoilResult.handled) return { ok: true, deletedRowIds: earlyCoilResult.deletedRowIds }
      await lockAcceptedWarningWrites(tx)
      const [warning] = await tx.select({ ...getTableColumns(dispatcherAcceptedWarnings), decisionVersion: acceptedWarningVersionSql }).from(dispatcherAcceptedWarnings).where(eq(dispatcherAcceptedWarnings.key, data.key)).limit(1)
      if (!warning) return { ok: true, deletedRowIds: [] }
      let scopes: ReturnType<typeof getDispatcherDirtyScopes> = []
      if (warning.weldJointId) {
        await lockWeldLineMembershipsForWeldIds(tx, [warning.weldJointId])
        scopes = getDispatcherDirtyScopes(await lockInteractiveWeldRows(tx, [warning.weldJointId]), new Map())
      } else if (warning.lineProgramId) {
        const lines = await tx.select().from(linePrograms).where(eq(linePrograms.id, warning.lineProgramId))
        await lockWeldLineMemberships(tx, lines)
        scopes = getDispatcherDirtyScopes(lines, new Map())
      }
      // Compare the saved decision too: a concurrent revoke/re-approve must not
      // remove the newer decision while this transaction waits for its owner.
      const deleted = await tx.delete(dispatcherAcceptedWarnings).where(and(eq(dispatcherAcceptedWarnings.key, data.key), eq(acceptedWarningVersionSql, warning.decisionVersion))).returning({ key: dispatcherAcceptedWarnings.key })
      if (deleted.length) await markDispatcherTaskIndexDirty(tx, { scopes, fullRebuild: !warning.weldJointId && !warning.lineProgramId && !warning.welderStampId })
      return { ok: true, deletedRowIds: [] }
    })
    return result
  })
