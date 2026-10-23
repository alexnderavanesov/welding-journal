import { getReportTaskPublicationCacheIdentity } from './report-task-publication-cache-key'
import { journalControlValueSql } from './journal-display-sql'
import { createJournalCountCache } from './journal-count-cache'
import { readCacheSnapshotCoalesced } from './derived-calculation-cache'
import { DERIVED_CALCULATION_REVISION_FLOOR } from '@/lib/derived-calculation-cache-version'
import { createHash, randomUUID } from 'node:crypto'
import { createJournalSnapshotCache } from './journal-snapshot-cache'
import type { JournalSelectionCountRequest, JournalSelectionCountResult } from '@/lib/journal-selection-counts'
import { and, count, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { requireDb } from '@/db'
import { derivedCalculationState, weldJoints, weldJointProgramStates } from '@/db/schema'
import { FIELD_BY_KEY, isVirtualWeldField, type WeldFieldKey } from '@/lib/weld-fields'
import { type JournalGridRequest, type JournalGridQuery, type JournalGridResult, type JournalGridRow, type JournalRevision, isJournalRevision, journalReport } from '@/lib/journal-server-grid'
import { LNK_METHODS } from '@/lib/report-config'
import { buildPstoCurrentReportValueSql } from './psto-report-current-values'
import { attachHeatTreatmentControlRelations } from './heat-treatment-control-relations'
import { createWeldGroupSummarizer } from '@/lib/weld-group-summary'
import type { WeldRow } from '@/lib/dispatcher-types'
import { parseDispatcherTaskIndexPayload } from '@/lib/dispatcher-task-index-payload'
import { parseRepeatedJointName } from '@/lib/joint-chain'
import { calculateWdi, isSystemWdiMode } from '@/lib/wdi'
import { journalNumericValue } from '@/lib/welding-journal-grid-state'
import { splitReportQuickSearch } from '@/lib/report-quick-search'
import { prepareJournalPageRows } from '@/lib/use-report-rows'
import { assertSecurityScope } from './security-functions'
import { ensureDispatcherTaskIndexFresh, isDispatcherTaskIndexFresh } from './dispatcher-task-index'
import { buildCalculatedReportValueSql } from './report-calculated-values-sql'
import { applyCurrentSystemWdi, getWeldColumn, loadServerOtherSettings, WELD_TABLE_SELECT } from './weld-server-shared'
import { attachDuplicateControlsToPage, attachReportPageMetadata, buildServerReportRows, buildReportQueryWhere, getReportOrderBy, normalizeWeldPageRequest } from './weld-read'
import { compactWeldRowsForTransport, buildNumberArrayMatch } from './weld-request-utils'
import { loadProgramSystemIndexSettings } from './line-program'

const changed = () => new Error('Данные журнала изменились. Обновите таблицу и повторите действие.')
export function normalizeJournalGridRequest(input: JournalGridRequest): JournalGridRequest {
  journalReport(input?.report)
  if (!input || !Array.isArray(input.groupBy) || !Array.isArray(input.route)
    || input.route.length > input.groupBy.length || input.route.some(value => typeof value !== 'string')
    || new Set(input.groupBy).size !== input.groupBy.length
    || input.groupBy.some(key => !FIELD_BY_KEY.has(key) || isVirtualWeldField(FIELD_BY_KEY.get(key)!))
    || !Number.isSafeInteger(input.start) || !Number.isSafeInteger(input.end) || input.start < 0
    || input.end <= input.start || input.end - input.start > 1000
    || input.revision !== undefined && !isJournalRevision(input.revision)) {
    throw new Error('Некорректная выборка сварочного журнала.')
  }
  const filters = normalizeWeldPageRequest({ columnFilters: input.columnFilters, sort: input.sort ?? undefined })
  return { ...input, columnFilters: filters.columnFilters, sort: filters.sort, groupBy: [...input.groupBy], route: [...input.route] }
}
export async function journalRevision(columnFilters: Record<string, string> = {}, publicationField?: string) {
  const [row] = await requireDb().select({ revision: derivedCalculationState.sourceRevision }).from(derivedCalculationState).where(eq(derivedCalculationState.id, 1))
  let revision = Number(row?.revision ?? 0)
  // The first summary read initializes the shared cache generation. Do that
  // before pinning journal rows, or a cold database invalidates its own first
  // block when the asynchronous summary arrives. Warm reads stay read-only.
  if (revision < DERIVED_CALCULATION_REVISION_FLOOR) {
    revision = (await readCacheSnapshotCoalesced('journal-grid:revision')).sourceRevision
  }
  const publication = await getReportTaskPublicationCacheIdentity(columnFilters, publicationField)
  return publication.taskPublication
    ? createHash('sha256').update(JSON.stringify([revision, publication])).digest('hex') : revision
}
export async function assertJournalRevision(revision: JournalRevision, columnFilters: Record<string, string> = {}, publicationField?: string) {
  if (await journalRevision(columnFilters, publicationField) !== revision) throw changed()
}
export type JournalReadIdentity = {
  request: JournalGridRequest
  revision: JournalRevision
  publicationField?: string
  dispatcher: Awaited<ReturnType<typeof ensureDispatcherTaskIndexFresh>>
}
export type JournalReadContext = JournalReadIdentity & {
  settings: Awaited<ReturnType<typeof loadServerOtherSettings>>
  systemSettings: Awaited<ReturnType<typeof loadProgramSystemIndexSettings>>
  base: SQL
  where: SQL
}
// Cached value lists need the same access/freshness barriers as grid rows, but
// do not use row-query settings or SQL predicates.
export async function journalReadIdentity(input: JournalGridRequest, publicationField?: string): Promise<JournalReadIdentity> {
  await assertSecurityScope('entry')
  const request = normalizeJournalGridRequest(input)
  // Reject an already stale selection before any potentially expensive index refresh.
  if (request.revision !== undefined) await assertJournalRevision(request.revision, request.columnFilters, publicationField)
  const dispatcher = await ensureDispatcherTaskIndexFresh()
  if (!isDispatcherTaskIndexFresh(dispatcher)) throw changed()
  const revision = await journalRevision(request.columnFilters, publicationField)
  if (request.revision !== undefined && request.revision !== revision) throw changed()
  return { request, revision, publicationField, dispatcher }
}
export async function journalReadContext(input: JournalGridRequest, publicationField?: string): Promise<JournalReadContext> {
  const identity = await journalReadIdentity(input, publicationField)
  const { request } = identity
  const [settings, systemSettings] = await Promise.all([loadServerOtherSettings(), loadProgramSystemIndexSettings(requireDb())])
  const base = buildReportQueryWhere(journalReport(request.report), splitReportQuickSearch(request.columnFilters), settings)
  const context = { ...identity, settings, systemSettings, base }
  return { ...context, where: journalRouteWhere(context, request.route) }
}
export async function assertJournalContextRevision(context: JournalReadIdentity) {
  await assertJournalRevision(context.revision, context.request.columnFilters, context.publicationField)
}
type ValueContext = Pick<JournalReadContext, 'settings' | 'request' | 'base'>
export function journalValueSql(key: WeldFieldKey, context: Pick<JournalReadContext, 'settings'> & Partial<Pick<JournalReadContext, 'request'>>): SQLWrapper {
  const report = journalReport(context.request?.report)
  // Current PSTO cycle values take precedence over primary-cycle journal labels.
  return (report === 'heatTreatment' ? buildPstoCurrentReportValueSql(key) : undefined)
    ?? journalControlValueSql(key) ?? buildCalculatedReportValueSql(report, key, context.settings) ?? getWeldColumn(key) ?? sql`null`
}
export function journalGroupSql(key: WeldFieldKey, context: Pick<JournalReadContext, 'settings'> & Partial<Pick<JournalReadContext, 'request'>>): SQL {
  const value = journalValueSql(key, context)
  return FIELD_BY_KEY.get(key)?.kind === 'number' ? sql`coalesce((${value})::double precision::text, '')` : sql`coalesce(${value}::text, '')`
}
export function journalRouteWhere(context: ValueContext, route: string[]) {
  return and(context.base, ...route.map((key, index) => sql`${journalGroupSql(context.request.groupBy[index], context)} = ${key}`))!
}

// Only small group pages are retained. Full cards and the full matching set never
// enter this cache. Every hit still checks the database revision and access.
const groupPages = new Map<string, Promise<JournalGridResult>>()
const journalCounts = createJournalCountCache()
export async function readJournalGrid(input: JournalGridRequest): Promise<JournalGridResult> {
  const context = await journalReadContext(input)
  const { request, revision } = context
  const key = createHash('sha256').update(JSON.stringify([revision, request])).digest('hex')
  let pending = request.route.length < request.groupBy.length ? groupPages.get(key) : undefined
  if (!pending) {
    pending = readJournalPage(context)
    if (request.route.length < request.groupBy.length) {
      groupPages.set(key, pending)
      while (groupPages.size > 32) groupPages.delete(groupPages.keys().next().value!)
      void pending.catch(() => { if (groupPages.get(key) === pending) groupPages.delete(key) })
    }
  }
  const result = await pending
  await assertJournalContextRevision(context)
  return result
}
export async function readJournalPage(context: JournalReadContext): Promise<JournalGridResult> {
  const { request, revision, where } = context
  if (request.route.length < request.groupBy.length) return readGroups(context)
  // Sorting and the requested block do not change membership. A new database
  // revision always gets a new count; the caller still checks it after reading.
  // A filter may contain thousands of exact values. Keep retained keys bounded
  // too, rather than retaining another large filter string for every route.
  const countKey = createHash('sha256').update(JSON.stringify([revision, journalReport(request.report),
    Object.entries(request.columnFilters).sort(([a], [b]) => a.localeCompare(b)), request.groupBy, request.route])).digest('hex')
  const [total, rows] = await Promise.all([
    journalCounts(countKey, async () => {
      const [row] = await requireDb().select({ total: count() }).from(weldJoints).where(where)
      return Number(row?.total ?? 0)
    }),
    readJournalLeafRows(context),
  ])
  return { rows, rowCount: total, revision }
}
export async function readJournalLeafRows(context: JournalReadContext, ids?: number[]): Promise<JournalGridRow[]> {
  const { request, where } = context
  const query = requireDb().select(WELD_TABLE_SELECT).from(weldJoints)
    .where(ids ? and(where, buildNumberArrayMatch(weldJoints.id, ids)) : where)
    .orderBy(...(ids ? [sql`array_position(${sql.param(ids)}::int[], ${weldJoints.id})`]
      : getReportOrderBy(journalReport(request.report), request.sort ?? undefined, context.settings)))
  const rows = await (ids ? query : query.limit(request.end - request.start).offset(request.start))
  const hydrated = await attachReportPageMetadata(applyCurrentSystemWdi(rows, context.settings), { dispatcherState: context.dispatcher })
  const report = journalReport(request.report)
  const prepared = prepareJournalPageRows(report === 'weldingJournal' ? hydrated
    : buildServerReportRows(hydrated, report, { preserveSourceOrder: true }), report)
  return compactWeldRowsForTransport(prepared)
}

async function readGroups(context: JournalReadContext): Promise<JournalGridResult> {
  const { request, where, revision } = context
  const field = request.groupBy[request.route.length]
  const value = journalGroupSql(field, context)
  const nextField = request.groupBy[request.route.length + 1]
  const children = nextField ? sql`count(distinct ${journalGroupSql(nextField, context)})` : sql`count(*)`
  const orderValue = FIELD_BY_KEY.get(field)?.kind === 'number' ? sql`nullif(${value}, '')::double precision` : value
  const order = request.sort?.fieldKey === field && request.sort.direction === 'desc' ? sql`${orderValue} desc nulls last` : sql`${orderValue} asc nulls last`
  const groups = await requireDb().select({ key: sql<string>`${value}`, childCount: sql<number>`${children}::int`,
    recordCount: sql<number>`count(*)::int`, total: sql<number>`count(*) over()::int` })
    .from(weldJoints).where(where).groupBy(value).orderBy(order).limit(request.end - request.start).offset(request.start)
  if (!groups.length) {
    const [row] = await requireDb().select({ total: sql<number>`count(distinct ${value})::int` }).from(weldJoints).where(where)
    return { rows: [], rowCount: Number(row?.total ?? 0), revision }
  }
  const members = await readSummaryRows(context, and(where, sql`${value} = any(${sql.param(groups.map(group => group.key))}::text[])`)!)
  // Bring in only the identity context used by the old physical summarizer.
  // In particular, a namesake or legacy root can be outside this group/page.
  const memberIds = new Set(members.map(row => row.id))
  const continuations = parseDispatcherTaskIndexPayload(context.dispatcher.repeatedTasks).chainContinuations
  const links = new Map(continuations.map(link => [link.sourceRowId, link]))
  const contextIds = new Set<number>()
  for (const row of members) {
    let link = links.get(row.id)
    const seen = new Set<number>()
    while (link?.kind === 'official-joint' && link.targetRowIds.length === 1) {
      const id = link.targetRowIds[0]
      if (seen.has(id)) break
      seen.add(id); if (!memberIds.has(id)) contextIds.add(id); link = links.get(id)
    }
  }
  const legacyRoots = members.filter(row => !row.programChainState && parseRepeatedJointName(String(row.joint ?? ''), context.systemSettings).segments.length)
  const legacyKeys = [...new Set(legacyRoots.map(row => JSON.stringify([row.projectTitle ?? '', row.subtitleCode ?? '', row.line ?? '', parseRepeatedJointName(String(row.joint ?? ''), context.systemSettings).base])))]
  const extraWhere = contextIds.size || legacyKeys.length ? and(context.base, sql`(
    ${contextIds.size ? buildNumberArrayMatch(weldJoints.id, [...contextIds]) : sql`false`}
    or ${legacyKeys.length ? sql`jsonb_build_array(coalesce(${weldJoints.projectTitle}, ''), coalesce(${weldJoints.subtitleCode}, ''), coalesce(${weldJoints.line}, ''), coalesce(${weldJoints.joint}, '')) in (select value from jsonb_array_elements(${JSON.stringify(legacyKeys.map(key => JSON.parse(key)))}::jsonb))` : sql`false`}
  )`) : undefined
  const extras = extraWhere ? await readSummaryRows(context, extraWhere) : []
  const summarize = createWeldGroupSummarizer([...members, ...extras], context.systemSettings,
    { lnk: request.report === 'lnk', heatTreatment: request.report === 'heatTreatment' })
  const byGroup = new Map<string, WeldRow[]>()
  for (const row of members) {
    const key = String((row as WeldRow & { groupKey: string }).groupKey)
    const rows = byGroup.get(key) ?? []; rows.push(row); byGroup.set(key, rows)
  }
  return { revision, rowCount: Number(groups[0].total), rows: groups.map((group, index) => {
    const { rows: _rows, ...summary } = summarize(byGroup.get(group.key) ?? [])
    return { id: 0, journalGroup: { key: group.key, route: [...request.route, group.key], ordinal: request.start + index,
      childCount: Number(group.childCount), recordCount: Number(group.recordCount), summary } } as JournalGridRow
  }) }
}

// Narrow stage facts, rather than full cards/document attachments, are enough
// for the existing independent LNK/PSTO physical-connection summarizers.
const stageFields = [...new Set([
  ...LNK_METHODS.flatMap(method => [method.enabledKey, method.resultKey, method.requestKey, method.requestDateKey]),
  'pstoRequired', 'pstoRequest', 'pstoRequestDate', 'pstoDate', 'pstoResult', 'heatTreatmentDiagram',
  'tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'tvmtConclusion', 'tvmtConclusionDate',
] as const)]
const stageProjection = Object.fromEntries(stageFields.map(key => [key, weldJoints[key]]))
async function readSummaryRows(context: JournalReadContext, where: SQL): Promise<WeldRow[]> {
  const report = journalReport(context.request.report)
  const root = alias(weldJoints, 'journal_root')
  const rootState = alias(weldJointProgramStates, 'journal_root_state')
  const key = context.request.groupBy[context.request.route.length]
  const records = await requireDb().select({
    row: { ...(report === 'weldingJournal' ? {} : stageProjection), id: weldJoints.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode,
      line: weldJoints.line, joint: weldJoints.joint, officiality: weldJoints.officiality,
      weldDate: weldJoints.weldDate, finalStatus: weldJoints.finalStatus, wdi: sql<number>`${journalValueSql('wdi', context)}`,
      groupKey: journalGroupSql(key, context) },
    state: weldJointProgramStates,
    root: { id: root.id, wdi: root.wdi, connectionType: root.connectionType, d1: root.d1, d2: root.d2, t1: root.t1, t2: root.t2 },
    replaced: rootState.replacedByCoil,
  }).from(weldJoints).leftJoin(weldJointProgramStates, eq(weldJointProgramStates.weldJointId, weldJoints.id))
    .leftJoin(root, eq(root.id, weldJointProgramStates.physicalRootId))
    .leftJoin(rootState, eq(rootState.weldJointId, root.id)).where(where)
  const links = new Map(parseDispatcherTaskIndexPayload(context.dispatcher.repeatedTasks).chainContinuations.map(link => [link.sourceRowId, link]))
  const rows = records.map(({ row, state, root: source, replaced }) => ({ ...row,
    ...(state ? { programChainState: state } : {}),
    ...(state?.physicalRootId == null ? {} : { groupPhysicalRoot: { id: state.physicalRootId, exists: Boolean(source), replaced: Boolean(replaced),
      wdi: source ? isSystemWdiMode(context.settings) ? calculateWdi(source, context.settings) : journalNumericValue(source.wdi) : null } }),
    ...(links.has(row.id) ? { chainContinuation: links.get(row.id) } : {}),
  })) as unknown as WeldRow[]
  if (report === 'weldingJournal') return rows
  const hydrated = await attachHeatTreatmentControlRelations(await attachDuplicateControlsToPage(rows))
  return prepareJournalPageRows(hydrated, report)
}
export async function selectJournalGridRows(input: JournalGridQuery & { route: string[]; revision: JournalRevision }) {
  const context = await journalReadContext({ ...input, start: 0, end: 100 })
  const rows = await requireDb().select({ id: weldJoints.id }).from(weldJoints).where(context.where).orderBy(weldJoints.id)
  await assertJournalContextRevision(context)
  return { ids: rows.map(row => row.id), revision: context.revision }
}

type SelectionSnapshot = { scope: string; revision: JournalRevision; total: number; counts: Record<string, number>; complete: boolean; bytes: number }
const selectionSnapshots = createJournalSnapshotCache<SelectionSnapshot>({ bytes: 16 * 1024 * 1024, ttlMs: 60000,
  weigh: value => value.bytes })

export async function countJournalGridSelection(input: JournalSelectionCountRequest): Promise<JournalSelectionCountResult> {
  if (!input || !Array.isArray(input.groupBy) || input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.some(id => !Number.isSafeInteger(id) || id <= 0))
    || input.snapshot !== undefined && typeof input.snapshot !== 'string'
    || !Array.isArray(input.routes) || input.routes.some(route => !Array.isArray(route) || route.length > input.groupBy.length || route.some(key => typeof key !== 'string'))) throw new Error('Некорректный выбор стыков.')
  const context = await journalReadContext({ ...input, route: [], start: 0, end: 100 })
  const scope = JSON.stringify([journalReport(context.request.report), context.request.groupBy, Object.entries(context.request.columnFilters).sort(([a], [b]) => a.localeCompare(b))])
  let snapshot = input.snapshot
  let value = snapshot ? selectionSnapshots.get(snapshot) : undefined
  if (value && (value.scope !== scope || value.revision !== context.revision)) value = undefined
  if (!value) {
    // Never interpret a missing/evicted token as an empty selection. The client
    // resends its exact IDs once; no session or persistent selection is created.
    if (!input.ids) return { total: 0, counts: {}, expired: true }
    const counts: Record<string, number> = {}
    let total = 0
    if (input.ids.length) {
      const path = sql`jsonb_build_array(${sql.join(input.groupBy.map(key => journalGroupSql(key, context)), sql`, `)})`
      const records = await requireDb().select({ path: sql<string[]>`${path}`, count: sql<number>`count(*)::int` })
        .from(weldJoints).where(and(context.base, buildNumberArrayMatch(weldJoints.id, input.ids))).groupBy(path)
      for (const row of records) {
        total += row.count
        for (let depth = 1; depth <= row.path.length; depth++) {
          const key = JSON.stringify(row.path.slice(0, depth))
          counts[key] = (counts[key] ?? 0) + row.count
        }
      }
    }
    // Compute metadata once, not on every token request for another viewport.
    const keys = Object.keys(counts), countBytes = keys.reduce((size, key) => size + key.length * 2 + 64, 0)
    value = { scope, revision: context.revision, total, counts, bytes: 128 + scope.length * 2 + countBytes,
      complete: keys.length <= 2048 && countBytes <= 256 * 1024 }
    snapshot = randomUUID()
    await assertJournalContextRevision(context)
    selectionSnapshots.put(snapshot, value)
  }
  const counts: Record<string, number> = value.complete ? { ...value.counts } : {}
  for (const route of input.routes) { const key = JSON.stringify(route); counts[key] = value.counts[key] ?? 0 }
  await assertJournalContextRevision(context)
  return { total: value.total, counts, snapshot, complete: value.complete }
}
