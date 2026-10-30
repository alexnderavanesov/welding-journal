import { getTableColumns } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { canViewWeldField } from '@/lib/weld-field-access'
import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
import { auditChanges, auditOperations } from '@/db/schema'
import { hasPermission, type AccessIdentity, type Permission } from '@/lib/access-permissions'
import { requireIdentity } from './access-context'

export type HistoryRequest = {
  jointId?: number; from?: string; until?: string; actorId?: string; action?: string;
  cursor?: { time: string; id: string }
}
function date(value: string | undefined) {
  if (!value) return undefined
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error('Некорректная дата истории.')
  return parsed
}
export function visibleHistoryFields(identity: AccessIdentity) {
  return Object.keys(getTableColumns(weldJoints)).filter(key => canViewWeldField(identity, key))
}

function visibleDetails(identity: AccessIdentity, jointId?: number, kind?: string): SQL {
  const areas = ['welding', 'lnk', 'psto', 'lines', 'references', 'documents', 'templates', 'dispatcher', 'exceptions', 'checks', 'data', 'wdi', 'processes', 'indexes', 'numbering']
    .filter(area => hasPermission(identity, `${area}.view` as Permission))
  if (hasPermission(identity, 'lnk.view') || hasPermission(identity, 'psto.view')) areas.push('welding')
  if (identity.role !== 'user') areas.push('access')
  const fields = visibleHistoryFields(identity)
  return and(kind ? eq(auditChanges.kind, kind as 'create' | 'update' | 'delete') : undefined, inArray(auditChanges.area, areas), jointId ? eq(auditChanges.jointId, jointId) : undefined,
    or(sql`${auditChanges.entity} <> 'weld_joints'`, sql`${auditChanges.changes} ?| ${sql.param(fields)}::text[]`))!
}
async function historyIdentity(jointId?: number) {
  const identity = await requireIdentity()
  if (jointId !== undefined && (!Number.isSafeInteger(jointId) || jointId <= 0)) throw new Error('Некорректный стык.')
  if (!hasPermission(identity, jointId ? 'history.joint' : 'history.view') || jointId && !hasPermission(identity, 'welding.view')) throw new Error('Недостаточно прав для просмотра истории.')
  return identity
}
export async function listActivityHistory(input: HistoryRequest) {
  const identity = await historyIdentity(input.jointId)
  const until = date(input.until) ?? new Date(), from = date(input.from), cursorTime = date(input.cursor?.time)
  // Validate the timestamp as a date, but bind its original database precision.
  // JS Date truncates microseconds and can skip the remainder of an equal-time group.
  const cursorTimestamp = cursorTime && input.cursor ? sql`${input.cursor.time}::timestamptz` : undefined
  if (from && from > until) throw new Error('Начало периода позже окончания.')
  const rows = await requireDb().select({ ...getTableColumns(auditOperations), cursorTime: sql<string>`${auditOperations.createdAt}::text` }).from(auditOperations).where(and(
    lte(auditOperations.createdAt, until), from ? sql`${auditOperations.createdAt} >= ${from}` : undefined,
    input.actorId === '@operator' ? isNull(auditOperations.actorId) : input.actorId ? eq(auditOperations.actorId, String(input.actorId).slice(0, 200)) : undefined,
    input.action?.startsWith('source:') ? eq(auditOperations.source, input.action.slice(7)) : input.action && !input.action.startsWith('kind:') ? eq(auditOperations.action, String(input.action).slice(0, 200)) : undefined,
    cursorTimestamp && input.cursor ? or(lt(auditOperations.createdAt, cursorTimestamp), and(eq(auditOperations.createdAt, cursorTimestamp), lt(auditOperations.id, input.cursor.id))) : undefined,
    sql`exists (select 1 from ${auditChanges} where ${auditChanges.operationId} = ${auditOperations.id} and ${visibleDetails(identity, input.jointId, input.action?.startsWith('kind:') ? input.action.slice(5) : undefined)})`,
  )).orderBy(desc(auditOperations.createdAt), desc(auditOperations.id)).limit(51)
  const page = rows.slice(0, 50), last = page.at(-1)
  return { rows: page.map(({ cursorTime: _cursorTime, ...row }) => row), until: until.toISOString(), nextCursor: rows.length > 50 && last ? { time: last.cursorTime, id: last.id } : null }
}
export async function getActivityDetails(input: { operationId: string; jointId?: number; afterId?: number }) {
  const identity = await historyIdentity(input.jointId)
  const rows = await requireDb().select().from(auditChanges).where(and(eq(auditChanges.operationId, String(input.operationId)),
    visibleDetails(identity, input.jointId), gt(auditChanges.id, Math.max(0, Number(input.afterId) || 0))))
    .orderBy(auditChanges.id).limit(51)
  const allowed = new Set<string>(visibleHistoryFields(identity))
  const page = rows.slice(0, 50).map(row => ({ ...row, changes: row.entity === 'weld_joints'
    ? Object.fromEntries(Object.entries(row.changes).filter(([key]) => allowed.has(key))) : row.changes }))
  return { rows: page, nextCursor: rows.length > 50 ? page.at(-1)!.id : null }
}
export async function getActivityFilters(input: { jointId?: number; search?: string }) {
  const identity = await historyIdentity(input.jointId)
  const visible = sql`exists (select 1 from ${auditChanges} where ${auditChanges.operationId} = ${auditOperations.id} and ${visibleDetails(identity, input.jointId)})`
  const db = requireDb()
  const search = input.search ? ilike(auditOperations.actorName, `%${String(input.search).slice(0, 100).replaceAll('%', '\\%').replaceAll('_', '\\_')}%`) : undefined
  // Enumerate historical identities, then seek one visible event per identity.
  // Checking visibility before DISTINCT examined every detail of every event.
  // Deleted authors stay searchable, and an invisible latest event cannot hide
  // an older visible one. The null operator identity has its own indexed seek.
  const identities = db.selectDistinct({ id: auditOperations.actorId }).from(auditOperations).where(isNotNull(auditOperations.actorId)).as('history_actor_ids')
  const latest = db.select({ id: auditOperations.actorId, name: auditOperations.actorName }).from(auditOperations)
    .where(and(eq(auditOperations.actorId, identities.id), visible, search))
    .orderBy(desc(auditOperations.createdAt), desc(auditOperations.id)).limit(1).as('visible_author')
  const operator = db.select({ id: auditOperations.actorId, name: auditOperations.actorName }).from(auditOperations)
    .where(and(isNull(auditOperations.actorId), visible, search)).orderBy(desc(auditOperations.createdAt), desc(auditOperations.id)).limit(1)
  const matchingAuthors = db.select({ id: latest.id, name: latest.name }).from(identities).innerJoinLateral(latest, sql`true`).unionAll(operator).as('matching_authors')
  const authors = await requireDb().select().from(matchingAuthors).orderBy(matchingAuthors.name, matchingAuthors.id).limit(50)
  return { authors, actions: ['kind:create', 'kind:update', 'kind:delete', 'source:import', ...(identity.role !== 'user' ? ['source:access'] : [])] }
}
