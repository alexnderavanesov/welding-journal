import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { lineSchemeAnnotations, lineSchemeDimensions } from '@/db/schema'
import { requireDb } from '@/db'
import { appSettings, linePrograms, lineSchemeBundles, lineSchemeMembers, lineSchemePhysicals, lineSchemePoints, lineSchemeRevisions, weldJoints, weldJointProgramStates } from '@/db/schema'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { normalizeSystemIndexSettings } from '@/lib/system-index-settings'
import { normalizeControlProcessSettings } from '@/lib/control-process-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildSchemePhysicalGroups, createSchemeProjectionContext, projectSchemeJoint, type SchemePhysicalGroup } from '@/lib/line-scheme-physical'
import type { ProgramChainState } from '@/lib/line-program-chain-state'
import { attachHeatTreatmentControlRelationsInPlace } from './heat-treatment-control-relations'
import { attachDuplicateControlRelations } from './duplicate-control-relations'
import { buildNumberArrayMatch } from './weld-request-utils'
import { attachSchemeAliasEvidence } from './line-scheme-identity'
import { collectSchemePointContext } from '@/lib/line-scheme-point-context'
import { DISPATCHER_SCOPE_WHITESPACE_SQL } from '@/lib/dispatcher-scope-normalization'
import { SCHEME_FILTER_FIELDS, schemeFilterLabel, schemeFilterValue, type SchemeFilterField, type SchemeRegistryRequest, SCHEME_PAGE_SIZE, schemeId, schemeToken, type SchemeBundle, type SchemeJoint, type SchemeLine, type SchemePoint } from '@/lib/line-schemes'

export type SchemeDb = Pick<SystemDocumentSequenceTransaction, 'select' | 'execute'>
export const schemeSnapshot = <T>(run: (tx: SystemDocumentSequenceTransaction) => Promise<T>) => requireDb().transaction(run, { isolationLevel: 'repeatable read', accessMode: 'read only' })
const readJson = (value?: string) => { try { return value ? JSON.parse(value) : undefined } catch { return undefined } }

export async function readSchemeSettings(db: SchemeDb) {
  const values = await db.select().from(appSettings).where(inArray(appSettings.key, [PROJECT_SETTING_KEYS.systemIndex, PROJECT_SETTING_KEYS.controlProcesses]))
  return { indexes: normalizeSystemIndexSettings(readJson(values.find(row => row.key === PROJECT_SETTING_KEYS.systemIndex)?.value)),
    controls: normalizeControlProcessSettings(readJson(values.find(row => row.key === PROJECT_SETTING_KEYS.controlProcesses)?.value)) }
}

/** One compact read for the requested registry page/line. Legacy rows with no
 * registry ID use the existing normalized registry identity, only while live.
 */
async function readCompactSchemeRows(db: SchemeDb, lineIds: number[], selector?: SQL): Promise<WeldRow[]> {
  const identity = and(isNull(weldJoints.lineProgramId),
    sql`lower(btrim(coalesce(${weldJoints.projectTitle},''))) = lower(btrim(${linePrograms.projectTitle}))`,
    sql`lower(btrim(coalesce(${weldJoints.subtitleCode},''))) = lower(btrim(${linePrograms.subtitleCode}))`,
    sql`lower(btrim(coalesce(${weldJoints.line},''))) = lower(btrim(${linePrograms.line}))`)
  const selected = await db.select({
    row: { id: weldJoints.id, lineProgramId: linePrograms.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line,
      joint: weldJoints.joint, weldDate: weldJoints.weldDate, officiality: weldJoints.officiality, revisionActuality: weldJoints.revisionActuality,
      connectionType: weldJoints.connectionType, vikResult: weldJoints.vikResult, rkResult: weldJoints.rkResult, uzkResult: weldJoints.uzkResult, pvkResult: weldJoints.pvkResult,
      hasVik: weldJoints.hasVik, hasRk: weldJoints.hasRk, hasUzk: weldJoints.hasUzk, hasPvk: weldJoints.hasPvk },
    state: weldJointProgramStates,
  }).from(weldJoints).innerJoin(linePrograms, or(eq(weldJoints.lineProgramId, linePrograms.id), identity))
    .leftJoin(weldJointProgramStates, eq(weldJointProgramStates.weldJointId, weldJoints.id))
    .where(and(buildNumberArrayMatch(linePrograms.id, lineIds), selector)).orderBy(asc(weldJoints.id))
  return selected.map(item => ({ ...item.row, ...(item.state ? { programChainState: item.state as ProgramChainState } : {}) }))
}

export async function readSchemeTopology(db: SchemeDb, lineIds: number[]) {
  const settings = await readSchemeSettings(db)
  if (!lineIds.length) return { settings, rows: [] as WeldRow[], states: new Map<number, ProgramChainState>(), membership: new Map<number, number>(), groups: new Map<number, SchemePhysicalGroup[]>() }
  const rows = await attachSchemeAliasEvidence(db, await readCompactSchemeRows(db, lineIds))
  const rootIds = [...new Set(rows.map(row => row.programChainState?.physicalRootId ?? row.id))]
  const history = rootIds.length ? await db.select().from(weldJointProgramStates)
    .where(or(buildNumberArrayMatch(weldJointProgramStates.physicalRootId, rootIds), buildNumberArrayMatch(weldJointProgramStates.weldJointId, rootIds))) : []
  const states = new Map(history.map(state => [state.weldJointId, state as ProgramChainState]))
  const ids = [...new Set([...rows.map(row => row.id), ...rootIds, ...history.map(state => state.weldJointId)])]
  const memberRows = ids.length ? await db.select().from(lineSchemeMembers).where(buildNumberArrayMatch(lineSchemeMembers.weldJointId, ids)) : []
  const membership = new Map(memberRows.map(row => [row.weldJointId, row.physicalId]))
  const byLine = new Map<number, WeldRow[]>()
  for (const row of rows) { const bucket = byLine.get(row.lineProgramId!) ?? []; bucket.push(row); byLine.set(row.lineProgramId!, bucket) }
  const historyByRoot = new Map<number, ProgramChainState[]>()
  for (const state of states.values()) { const root = state.physicalRootId ?? state.weldJointId, bucket = historyByRoot.get(root) ?? []; bucket.push(state); historyByRoot.set(root, bucket) }
  const groups = new Map<number, SchemePhysicalGroup[]>()
  for (const id of lineIds) {
    const lineRows = byLine.get(id) ?? [], lineStates = new Map<number, ProgramChainState>()
    for (const root of new Set(lineRows.map(row => row.programChainState?.physicalRootId ?? row.id))) {
      for (const state of historyByRoot.get(root) ?? []) lineStates.set(state.weldJointId, state)
      const rootState = states.get(root); if (rootState) lineStates.set(root, rootState)
    }
    groups.set(id, buildSchemePhysicalGroups(lineRows, settings.indexes, membership, lineStates))
  }
  return { settings, rows, states, membership, groups }
}

/** A saved point already has durable members. Resolve just those complete
 * physical components and live conflict/alias neighbours. All calls remain in
 * the caller's repeatable-read snapshot; no dispatcher rebuild or write occurs.
 */
export async function readSchemePointTopology(db: SchemeDb, lineId: number, physicalIds: number[]) {
  const settings = await readSchemeSettings(db)
  const context = await collectSchemePointContext(physicalIds, settings.indexes, {
    members: async query => db.select().from(lineSchemeMembers).where(or(
      query.physicalIds?.length ? buildNumberArrayMatch(lineSchemeMembers.physicalId, query.physicalIds) : undefined,
      query.nodeIds?.length ? buildNumberArrayMatch(lineSchemeMembers.weldJointId, query.nodeIds) : undefined,
    )),
    states: async query => (await db.select().from(weldJointProgramStates).where(or(
      query.nodeIds?.length ? buildNumberArrayMatch(weldJointProgramStates.weldJointId, query.nodeIds) : undefined,
      query.rootIds?.length ? buildNumberArrayMatch(weldJointProgramStates.physicalRootId, query.rootIds) : undefined,
      query.coilParentIds?.length ? buildNumberArrayMatch(weldJointProgramStates.coilParentId, query.coilParentIds) : undefined,
    ))) as ProgramChainState[],
    rows: query => readCompactSchemeRows(db, [lineId], or(
      query.ids?.length ? buildNumberArrayMatch(weldJoints.id, query.ids) : undefined,
      // Keep exactly the indexed expression and the canonical whitespace set.
      query.names?.length ? sql`lower(translate(coalesce(${weldJoints.joint}, ''), ${sql.raw(DISPATCHER_SCOPE_WHITESPACE_SQL)}, '')) = any(${sql.param(query.names)}::text[])` : undefined,
    )),
  })
  if (context.requiresFullLine) return readSchemeTopology(db, [lineId])
  const rows = await attachSchemeAliasEvidence(db, context.rows)
  return { settings, rows, states: context.states, membership: context.membership,
    groups: new Map([[lineId, buildSchemePhysicalGroups(rows, settings.indexes, context.membership, context.states)]]) }
}

export async function hydrateSchemeGroups(db: SchemeDb, groups: SchemePhysicalGroup[], topology: Awaited<ReturnType<typeof readSchemeTopology>>) {
  const ids = [...new Set(groups.flatMap(group => group.rows.map(row => row.id)))]
  if (!ids.length) return new Map<string, SchemeJoint>()
  const compact = new Map(groups.flatMap(group => group.rows).map(row => [row.id, row]))
  let rows: WeldRow[] = (await db.select().from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, ids)))
    .map(row => ({ ...row, programChainState: compact.get(row.id)?.programChainState ?? topology.states.get(row.id) }))
  await attachHeatTreatmentControlRelationsInPlace(rows, db, topology.settings.controls, { programChainStatesLoaded: true })
  rows = await attachDuplicateControlRelations(rows, db)
  const byId = new Map(rows.map(row => [row.id, row])), prepared = createSchemeProjectionContext(rows, topology.settings.indexes)
  return new Map(groups.map(group => {
    const hydrated = { ...group, rows: group.rows.map(row => byId.get(row.id) ?? row), displayRow: byId.get(group.displayRow.id) ?? group.displayRow,
      representative: group.representative ? byId.get(group.representative.id) ?? null : null }
    return [group.key, projectSchemeJoint(hydrated, rows, topology.settings.indexes, prepared)]
  }))
}

// Metadata filters stay in SQL. Physical metrics use the same batched topology
// as the visible rows, only when a metric filter/value list requires it.
const registryCte = sql`with registry_lines as (
  select l.id as line_id, b.id as bundle_id, l.project_title, l.subtitle_code, l.line, false as deleted
  from ${linePrograms} l left join ${lineSchemeBundles} b on b.line_program_id=l.id
  union all
  select b.line_program_id,b.id,b.project_title,b.subtitle_code,b.line,true from ${lineSchemeBundles} b
  where not exists(select 1 from ${linePrograms} l where l.id=b.line_program_id)
    and exists(select 1 from ${lineSchemeRevisions} r where r.bundle_id=b.id)
), registry as (
  select l.*, main.file_name, regexp_replace(coalesce(main.file_name,''), '[.]pdf$', '', 'i') as pdf_name,
    coalesce(files.count,0)::integer as revision_count
  from registry_lines l
  left join ${lineSchemeBundles} b on b.id=l.bundle_id
  left join ${lineSchemeRevisions} main on main.id=b.active_revision_id and main.bundle_id=b.id
  left join (select bundle_id,count(*)::integer as count from ${lineSchemeRevisions} group by bundle_id) files on files.bundle_id=b.id
)`
const registryColumns: Partial<Record<SchemeFilterField, SQL>> = {
  projectTitle: sql`project_title`, subtitleCode: sql`subtitle_code`, line: sql`line`, pdf: sql`pdf_name`, files: sql`revision_count`,
}
const metricFields: SchemeFilterField[] = ['total', 'welded', 'placedCount', 'placedPercent']
const hasMetricFilters = (data: SchemeRegistryRequest, except?: SchemeFilterField) => metricFields.some(field => field !== except && data.filters?.[field]?.length)
const registrySearch = (value: unknown) => String(value ?? '').trim().slice(0, 200)
const containsPattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`
function registryWhere(data: SchemeRegistryRequest, except?: SchemeFilterField) {
  const conditions: SQL[] = [], search = registrySearch(data.search)
  if (search) conditions.push(sql`concat_ws(' ', project_title, subtitle_code, line) ilike ${containsPattern(search)}`)
  for (const field of SCHEME_FILTER_FIELDS) {
    const values = data.filters?.[field]
    if (values === undefined) continue
    if (!Array.isArray(values) || values.length > 1000 || values.some(value => typeof value !== 'string' || value.length > 2000)) throw new Error('Недопустимые значения фильтра схем.')
    const column = registryColumns[field]
    if (field !== except && values.length && column) conditions.push(sql`${column}::text = any(${sql.param([...new Set(values)])}::text[])`)
  }
  return conditions.length ? and(...conditions)! : sql`true`
}
function filterMetricRows(rows: SchemeLine[], data: SchemeRegistryRequest, except?: SchemeFilterField) {
  const filters = metricFields.filter(field => field !== except && data.filters?.[field]?.length)
    .map(field => ({ field, values: new Set(data.filters![field]) }))
  return rows.filter(row => filters.every(({ field, values }) => values.has(schemeFilterValue(row, field))))
}
type RegistryRow = { line_id: number; bundle_id: number | null; project_title: string; subtitle_code: string; line: string; deleted: boolean; file_name: string | null; revision_count: number; matching: number }
async function registryRowsWithMetrics(db: SchemeDb, selected: RegistryRow[]): Promise<SchemeLine[]> {
  const metrics = await readSchemeLineMetrics(db, selected)
  return selected.map(row => {
    const counts = metrics.get(row.line_id)!
    return { lineId: row.line_id, bundleId: row.bundle_id, projectTitle: row.project_title, subtitleCode: row.subtitle_code, line: row.line,
      deleted: row.deleted, total: counts.total, welded: counts.welded, placedCount: counts.placedCount,
      placedPercent: counts.total ? 100 * counts.activePlacedCount / counts.total : null, revisionCount: row.revision_count, fileName: row.file_name }
  })
}
export async function readSchemeFilterOptions(data: SchemeRegistryRequest & { field: SchemeFilterField; valueSearch?: string }) {
  if (!SCHEME_FILTER_FIELDS.includes(data.field)) throw new Error('Недопустимый столбец фильтра схем.')
  const where = registryWhere(data, data.field), column = registryColumns[data.field], search = registrySearch(data.valueSearch)
  return schemeSnapshot(async db => {
    if (!column || hasMetricFilters(data, data.field)) {
      const result = await db.execute(sql`${registryCte} select * from registry where ${where}`)
      const lines = filterMetricRows(await registryRowsWithMetrics(db, result.rows as unknown as RegistryRow[]), data, data.field)
      const counts = new Map<string, number>()
      for (const row of lines) { const value = schemeFilterValue(row, data.field); counts.set(value, (counts.get(value) ?? 0) + 1) }
      const numeric = metricFields.includes(data.field) || data.field === 'files'
      const options = [...counts].map(([value, count]) => ({ value, count, label: schemeFilterLabel(data.field, value) }))
        .filter(option => !search || option.label.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
        .sort((a, b) => numeric ? (a.value === '' ? -1 : b.value === '' ? 1 : Number(a.value) - Number(b.value)) : a.value.localeCompare(b.value, 'ru'))
      return { options: options.slice(0, 100), hasMore: options.length > 100 }
    }
    const label = sql`coalesce(nullif(${column}::text,''), ${schemeFilterLabel(data.field, '')})`
    const result = await db.execute(sql`${registryCte}
      select ${column} as value, count(*)::integer as count from registry
      where ${where} ${search ? sql`and ${label} ilike ${containsPattern(search)}` : sql``}
      group by ${column} order by ${column} limit 101`)
    const rows = result.rows as unknown as { value: string | number; count: number }[]
    return { options: rows.slice(0, 100).map(row => ({ value: String(row.value), count: row.count, label: schemeFilterLabel(data.field, String(row.value)) })), hasMore: rows.length > 100 }
  })
}
/** Shared by the scheme registry and line statistics, in the caller's snapshot. */
export async function readSchemeLineMetrics(db: SchemeDb, selected: { line_id: number; bundle_id: number | null; deleted?: boolean }[]) {
  const topology = await readSchemeTopology(db, selected.filter(row => !row.deleted).map(row => row.line_id))
  const bundleIds = selected.flatMap(row => row.bundle_id ? [row.bundle_id] : [])
  // Count only saved points in the current main PDF, across all its sheets.
  // One grouped query for all requested lines; no per-line requests.
  // Eligibility is a (bundle, physical) pair: a moved joint on another
  // visible line must not make its historical point count for the old line.
  const activePairs = selected.flatMap(row => row.bundle_id ? (topology.groups.get(row.line_id) ?? []).flatMap(group =>
    !row.deleted && !group.inactive && group.representative && group.physicalId ? [{ bundleId: row.bundle_id, physicalId: group.physicalId }] : []) : [])
  const placed = bundleIds.length ? await db.select({ bundleId: lineSchemeBundles.id, count: sql<number>`count(*)::integer`, activeCount: sql<number>`count(active.physical_id)::integer` })
    .from(lineSchemeBundles).innerJoin(lineSchemePoints, eq(lineSchemePoints.revisionId, lineSchemeBundles.activeRevisionId))
    .leftJoin(sql`unnest(${sql.param(activePairs.map(item => item.bundleId))}::integer[], ${sql.param(activePairs.map(item => item.physicalId))}::integer[]) as active(bundle_id, physical_id)`,
      sql`active.bundle_id = ${lineSchemeBundles.id} and active.physical_id = ${lineSchemePoints.physicalId}`)
    .where(buildNumberArrayMatch(lineSchemeBundles.id, bundleIds)).groupBy(lineSchemeBundles.id) : []
  const placedByBundle = new Map(placed.map(row => [row.bundleId, row]))
  return new Map(selected.map(row => {
    const groups = (topology.groups.get(row.line_id) ?? []).filter(group => !group.inactive && group.representative)
    const placed = placedByBundle.get(row.bundle_id ?? -1)
    return [row.line_id, { total: groups.length, welded: groups.filter(group => group.welded).length,
      placedCount: placed?.count ?? 0, activePlacedCount: placed?.activeCount ?? 0 }]
  }))
}

export async function readSchemeLines(data: SchemeRegistryRequest) {
  const page = Math.max(0, Math.trunc(Number(data?.page) || 0)), filter = registryWhere(data ?? {})
  const metricFilters = hasMetricFilters(data ?? {})
  return schemeSnapshot(async db => {
    const result = await db.execute(sql`${registryCte}
      select *, count(*) over()::integer as matching from registry where ${filter}
      order by project_title,subtitle_code,line,line_id
      ${metricFilters ? sql`` : sql`limit ${SCHEME_PAGE_SIZE} offset ${page * SCHEME_PAGE_SIZE}`}`)
    const selected = result.rows as unknown as RegistryRow[]
    const lines = filterMetricRows(await registryRowsWithMetrics(db, selected), data ?? {})
    return metricFilters ? { rows: lines.slice(page * SCHEME_PAGE_SIZE, (page + 1) * SCHEME_PAGE_SIZE), total: lines.length }
      : { rows: lines, total: selected[0]?.matching ?? 0 }
  })
}

export async function readSchemeBundle(db: SchemeDb, bundleId: number): Promise<SchemeBundle> {
  schemeId(bundleId)
  const [entry] = await db.select({ bundle: lineSchemeBundles, line: linePrograms }).from(lineSchemeBundles)
    .leftJoin(linePrograms, eq(linePrograms.id, lineSchemeBundles.lineProgramId)).where(eq(lineSchemeBundles.id, bundleId))
  if (!entry) throw new Error('Схема не найдена. Обновите список линий.')
  const revisions = await db.select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.bundleId, bundleId)).orderBy(asc(lineSchemeRevisions.createdAt))
  const name = entry.line ?? entry.bundle
  return { id: bundleId, lineId: entry.bundle.lineProgramId, projectTitle: name.projectTitle, subtitleCode: name.subtitleCode, line: name.line,
    deleted: !entry.line, activeRevisionId: entry.bundle.activeRevisionId, version: entry.bundle.version,
    revisions: revisions.map(row => ({ id: row.id, fileName: row.fileName, changeNumber: row.changeNumber, size: row.size, pageCount: row.pageCount, version: row.version, authorName: row.authorName, createdAt: row.createdAt.toISOString() })) }
}

export async function readSchemeJoints(data: { bundleId: number; revisionId?: string; page?: number; search?: string; unplaced?: boolean }) {
  schemeId(data.bundleId)
  if (data.revisionId) schemeToken(data.revisionId)
  return schemeSnapshot(async db => {
    const bundle = await readSchemeBundle(db, data.bundleId)
    if (data.revisionId && !bundle.revisions.some(row => row.id === data.revisionId)) throw new Error('Редакция не принадлежит этой линии.')
    const topology = await readSchemeTopology(db, bundle.deleted ? [] : [bundle.lineId])
    const placed = data.revisionId ? await db.select({ physicalId: lineSchemePoints.physicalId, page: lineSchemePoints.page }).from(lineSchemePoints).where(eq(lineSchemePoints.revisionId, data.revisionId)) : []
    const placedById = new Map(placed.map(row => [row.physicalId, row.page]))
    const search = String(data.search ?? '').trim().toLocaleLowerCase('ru').slice(0, 200)
    const filtered = (topology.groups.get(bundle.lineId) ?? []).filter(group => !group.inactive && (!data.unplaced || !group.physicalId || !placedById.has(group.physicalId)) && (!search || group.label.toLocaleLowerCase('ru').includes(search)))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }) || a.rootId - b.rootId)
    const page = Math.max(0, Math.trunc(Number(data.page) || 0)), selected = filtered.slice(page * SCHEME_PAGE_SIZE, (page + 1) * SCHEME_PAGE_SIZE)
    const states = await hydrateSchemeGroups(db, selected, topology)
    return { rows: selected.map(group => ({ ...states.get(group.key)!, placedPage: placedById.get(group.physicalId ?? -1) ?? null })), total: filtered.length, updatedAt: new Date().toISOString() }
  })
}

/** New unsaved points are refreshed in bounded batches. Keep the requested
 * rootId in each DTO so callers can update statuses without moving coordinates
 * or rebinding a missing root to a reused name.
 */
export async function readSchemeDraftStates(data: { bundleId: number; roots: number[] }): Promise<SchemeJoint[]> {
  schemeId(data.bundleId)
  if (!Array.isArray(data.roots) || data.roots.length > 500) throw new Error('Передайте не более 500 исходных стыков для обновления состояний.')
  const roots = [...new Set(data.roots.map(id => schemeId(id, 'Исходный стык')))]
  if (!roots.length) return []
  return schemeSnapshot(async db => {
    const bundle = await readSchemeBundle(db, data.bundleId)
    const topology = await readSchemeTopology(db, bundle.deleted ? [] : [bundle.lineId])
    const rootRows = await db.select({ id: weldJoints.id, joint: weldJoints.joint }).from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, roots))
    const byId = new Map(rootRows.map(row => [row.id, row]))
    const groupByNode = new Map<number, SchemePhysicalGroup>()
    for (const group of topology.groups.get(bundle.lineId) ?? []) for (const row of group.rows) groupByNode.set(row.id, group)
    const selected = [...new Map(roots.flatMap(id => { const group = groupByNode.get(id); return group ? [[group.key, group] as const] : [] })).values()]
    const projected = await hydrateSchemeGroups(db, selected, topology)
    return roots.map(rootId => {
      const group = groupByNode.get(rootId), root = byId.get(rootId)
      if (!bundle.deleted && root && group) {
        if (group.rootId === rootId || group.physicalId && topology.membership.get(rootId) === group.physicalId) return { ...projected.get(group.key)!, rootId }
        return { key: `r:${rootId}`, rootId, physicalId: null, rowId: null, label: String(root.joint ?? `#${rootId}`), color: 'error',
          reason: 'Исходная физическая связь изменилась. Уберите новую точку и выберите актуальный стык.', welded: false, placedPage: null }
      }
      return { key: `r:${rootId}`, rootId, physicalId: null, rowId: null, label: String(root?.joint ?? `#${rootId}`), color: 'inactive',
        reason: bundle.deleted ? 'Линия удалена.' : root ? 'Исходный стык перенесён в другую линию.' : 'Исходный стык удалён.', welded: false, placedPage: null }
    })
  })
}

export async function readSchemePointPage(data: { revisionId: string; page: number; after?: string }) {
  schemeToken(data.revisionId); schemeId(data.page, 'Лист')
  if (data.after) schemeToken(data.after)
  return schemeSnapshot(async db => {
    const [revision] = await db.select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, data.revisionId))
    if (!revision || data.page > revision.pageCount) throw new Error('Лист или редакция больше не существуют.')
    const bundle = await readSchemeBundle(db, revision.bundleId)
    const points = await db.select({ point: lineSchemePoints, physical: lineSchemePhysicals }).from(lineSchemePoints)
      .innerJoin(lineSchemePhysicals, eq(lineSchemePhysicals.id, lineSchemePoints.physicalId))
      .where(and(eq(lineSchemePoints.revisionId, revision.id), eq(lineSchemePoints.page, data.page), data.after ? sql`${lineSchemePoints.id} > ${data.after}` : undefined))
      .orderBy(asc(lineSchemePoints.id)).limit(501)
    const selected = points.slice(0, 500), physicalIds = new Set(selected.map(row => row.point.physicalId))
    const topology = selected.length && !bundle.deleted ? await readSchemePointTopology(db, bundle.lineId, [...physicalIds]) : null
    const groups = (topology?.groups.get(bundle.lineId) ?? []).filter(group => group.physicalId && physicalIds.has(group.physicalId))
    const states = topology ? await hydrateSchemeGroups(db, groups, topology) : new Map<string, SchemeJoint>()
    const live = physicalIds.size ? await db.select({ physicalId: lineSchemeMembers.physicalId, lineId: weldJoints.lineProgramId }).from(lineSchemeMembers)
      .innerJoin(weldJoints, eq(weldJoints.id, lineSchemeMembers.weldJointId)).where(buildNumberArrayMatch(lineSchemeMembers.physicalId, [...physicalIds])) : []
    const existing = new Set(live.map(row => row.physicalId))
    const result: SchemePoint[] = selected.map(({ point, physical }) => ({ id: point.id, physicalId: point.physicalId, page: point.page, x: point.x, y: point.y,
      joint: states.get(`p:${point.physicalId}`) ?? { key: `p:${point.physicalId}`, rootId: 0, physicalId: point.physicalId, rowId: null, label: physical.lastLabel,
        color: 'inactive', reason: bundle.deleted ? 'Линия удалена.' : existing.has(point.physicalId) ? 'Стык перенесён в другую линию.' : 'Стык удалён.', welded: false, placedPage: point.page } }))
    const dimensions = data.after ? [] : await db.select({ id: lineSchemeDimensions.id, fromPointId: lineSchemeDimensions.fromPointId, toPointId: lineSchemeDimensions.toPointId,
      fromAnnotationId: lineSchemeDimensions.fromAnnotationId, toAnnotationId: lineSchemeDimensions.toAnnotationId,
      color: lineSchemeDimensions.color, strokeWidth: lineSchemeDimensions.strokeWidth, page: lineSchemeDimensions.page, distanceMm: lineSchemeDimensions.distanceMm, offsetX: lineSchemeDimensions.offsetX, offsetY: lineSchemeDimensions.offsetY }).from(lineSchemeDimensions)
      .where(and(eq(lineSchemeDimensions.revisionId, revision.id), eq(lineSchemeDimensions.page, data.page))).orderBy(asc(lineSchemeDimensions.id))
    const annotations = data.after ? [] : await db.select({ id: lineSchemeAnnotations.id, page: lineSchemeAnnotations.page, x: lineSchemeAnnotations.x, y: lineSchemeAnnotations.y,
      note: lineSchemeAnnotations.note, shape: lineSchemeAnnotations.shape, label: lineSchemeAnnotations.label, color: lineSchemeAnnotations.color, size: lineSchemeAnnotations.size, strokeWidth: lineSchemeAnnotations.strokeWidth, rotation: lineSchemeAnnotations.rotation }).from(lineSchemeAnnotations)
      .where(and(eq(lineSchemeAnnotations.revisionId, revision.id), eq(lineSchemeAnnotations.page, data.page))).orderBy(asc(lineSchemeAnnotations.id))
    return { points: result, annotations, dimensions, next: points.length > 500 ? selected.at(-1)!.point.id : null, version: revision.version, updatedAt: new Date().toISOString() }
  })
}
