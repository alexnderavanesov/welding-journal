import { createServerFn } from '@tanstack/react-start'
import { packProgramRows } from '@/lib/line-program-row-payload'
import { and, asc, eq, exists, ilike, or, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { appSettings, duplicateControls, preHeatTreatmentControls, pstoRepeatCycles, dispatcherAcceptedWarnings, linePrograms, weldJoints, type LineProgram } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { calculateLineProgram, getLineProgramOfficialStamps } from '@/lib/line-program-calculation'
import { compactLineProgramDemand, summarizeLineProgram, isProgramControlComplete } from '@/lib/line-program-overview'
import { projectProgramExcess, getProgramRemovalHints } from '@/lib/line-program-excess'
import { programExcessEntries } from '@/lib/line-program-workspace'
export { compactLineProgramDemand } from '@/lib/line-program-overview'
import { getLineProgramConfigurationIssue, getLineProgramIdentityKey, hasLineProgramIdentityChanges, normalizeLineProgramSaveRequest, type LineProgramSaveRequest, type LineProgramListRequest, type LineProgramRecord, type LineProgramIdentity } from '@/lib/line-program'
import { buildNumberArrayMatch, buildTextArrayMatch } from '@/server/weld-request-utils'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { lockWeldLineMemberships } from '@/server/weld-line-membership-lock'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'
import { WELD_TABLE_SELECT } from '@/server/weld-server-shared'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { loadLineProgramsForIdentities } from '@/server/line-program-registry'
import { assertWeldImportRowLimit } from '@/lib/weld-import-limits'
import { getNextTimestampVersion } from '@/server/timestamp-version'
import { normalizeControlProcessSettings } from '@/lib/control-process-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { lineProgramWeldWhere, renameLineProgramDecisions } from '@/server/line-program-rename'
import { loadLineProgramWelderNames } from './line-program-welder-names'
import { buildLineProgramDisplay } from '@/lib/line-program-display'
import { applyGeneratedDocumentFields, loadGeneratedDocumentAssignments } from './generated-document-row-fields'
import { loadProgramApprovals } from './program-approval-lifecycle'
import { attachProgramRepairRequirements } from '@/lib/line-program-repair-requirements'
import { attachProgramChainStates } from './line-program-chain-state'
import { normalizeSystemIndexSettings } from '@/lib/system-index-settings'
import { explainLineProgram, PROGRAM_EXPLANATION_LISTS, type ProgramExplanationList } from '@/lib/line-program-explanation'
export { lineProgramWeldWhere } from '@/server/line-program-rename'

// Full journal records are fetched only for one opened line or locked mutation targets.
const LINE_PROGRAM_CALCULATION_COLUMNS = {
  id: weldJoints.id, lineProgramId: weldJoints.lineProgramId,
  updatedAt: weldJoints.updatedAt,
  projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line, joint: weldJoints.joint,
  weldDate: weldJoints.weldDate, connectionType: weldJoints.connectionType, officiality: weldJoints.officiality,
  revisionActuality: weldJoints.revisionActuality, category: weldJoints.category, groupName: weldJoints.groupName,
  weldControlPercent: weldJoints.weldControlPercent, pvkControlPercent: weldJoints.pvkControlPercent,
  layeredControlAssigned: weldJoints.layeredControlAssigned,
  stamp1K: weldJoints.stamp1K, stamp1Z: weldJoints.stamp1Z, stamp1O: weldJoints.stamp1O,
  stamp2K: weldJoints.stamp2K, stamp2Z: weldJoints.stamp2Z, stamp2O: weldJoints.stamp2O,
  hasVik: weldJoints.hasVik, hasRk: weldJoints.hasRk, hasUzk: weldJoints.hasUzk, hasPvk: weldJoints.hasPvk,
  vikResult: weldJoints.vikResult, rkResult: weldJoints.rkResult, uzkResult: weldJoints.uzkResult, pvkResult: weldJoints.pvkResult,
  pstoRequired: weldJoints.pstoRequired, pstoRequest: weldJoints.pstoRequest, pstoResult: weldJoints.pstoResult,
  pstoDate: weldJoints.pstoDate, tvmtResult: weldJoints.tvmtResult,
  pstoRequestDate: weldJoints.pstoRequestDate, heatTreatmentDiagram: weldJoints.heatTreatmentDiagram,
  tvmtRequest: weldJoints.tvmtRequest, tvmtRequestDate: weldJoints.tvmtRequestDate,
  tvmtConclusion: weldJoints.tvmtConclusion, tvmtConclusionDate: weldJoints.tvmtConclusionDate,
  hasTvmt: weldJoints.hasTvmt, vikRequest: weldJoints.vikRequest,
  rkRequest: weldJoints.rkRequest, rkRequestDate: weldJoints.rkRequestDate, rkConclusion: weldJoints.rkConclusion, rkConclusionDate: weldJoints.rkConclusionDate,
  uzkRequest: weldJoints.uzkRequest, uzkRequestDate: weldJoints.uzkRequestDate, uzkConclusion: weldJoints.uzkConclusion, uzkConclusionDate: weldJoints.uzkConclusionDate,
  pvkRequest: weldJoints.pvkRequest, pvkRequestDate: weldJoints.pvkRequestDate, pvkConclusion: weldJoints.pvkConclusion, pvkConclusionDate: weldJoints.pvkConclusionDate,
}

export function toLineProgramRecord(row: LineProgram): LineProgramRecord {
  return { id: row.id, projectTitle: row.projectTitle, subtitleCode: row.subtitleCode, line: row.line,
    category: row.category, groupName: row.groupName, weldControlPercent: row.weldControlPercent,
    pvkControlPercent: row.pvkControlPercent, configurationIssue: row.configurationIssue ?? getLineProgramConfigurationIssue(row),
    version: row.updatedAt.toISOString() }
}
export async function loadLineProgramRows(db: Pick<SystemDocumentSequenceTransaction, 'select'>, line: LineProgramIdentity) {
  const rows = await db.select(LINE_PROGRAM_CALCULATION_COLUMNS).from(weldJoints).where(lineProgramWeldWhere(line)).orderBy(asc(weldJoints.id))
  return attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(rows as WeldRow[], db), db)
}
export async function loadProgramSystemIndexSettings(db: Pick<SystemDocumentSequenceTransaction, 'select'>) {
  const [stored] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.systemIndex))
  let value: unknown
  try { value = stored ? JSON.parse(stored.value) : undefined } catch { value = undefined }
  return normalizeSystemIndexSettings(value)
}
/** One batch for the visible registry page, not one set of queries for every card. */
export async function loadLineProgramOverviews(db: Pick<SystemDocumentSequenceTransaction, 'select'>, programs: LineProgramRecord[]) {
  const { calculations, accepted, systemIndexSettings } = await loadLineProgramCalculations(db, programs)
  return calculations.map(({ line, rows, calculations }) => ({ ...line, searchStamps: [...new Set(rows.flatMap(getLineProgramOfficialStamps))], overview: summarizeLineProgram(rows, line, accepted, calculations, systemIndexSettings) }))
}

/** Shared batched source for the registry and explicit printed reports. */
export async function loadLineProgramCalculations(db: Pick<SystemDocumentSequenceTransaction, 'select'>, programs: LineProgramRecord[]) {
  if (!programs.length) return { calculations: [], accepted: new Set<string>() }
  const rows = await db.select(LINE_PROGRAM_CALCULATION_COLUMNS).from(weldJoints)
    .innerJoin(linePrograms, sql`lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = lower(btrim(${linePrograms.projectTitle})) and lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = lower(btrim(${linePrograms.subtitleCode})) and lower(btrim(coalesce(${weldJoints.line}, ''))) = lower(btrim(${linePrograms.line}))`)
    .where(buildNumberArrayMatch(linePrograms.id, programs.map(line => line.id)))
  const attached = await attachCalculationRelations(rows as WeldRow[], db)
  const systemIndexSettings = await loadProgramSystemIndexSettings(db)
  const accepted = new Set((await loadProgramApprovals(db, attached.map(row => row.id), { includeEarlyCoil: true })).map(item => item.key))
  const groups = new Map<string, WeldRow[]>()
  for (const row of attached) {
    const key = getLineProgramIdentityKey(row)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const calculations = programs.map(line => ({ line, rows: attachProgramRepairRequirements(groups.get(getLineProgramIdentityKey(line)) ?? [], accepted, systemIndexSettings) })).map(item => ({ ...item,
    calculations: item.line.configurationIssue || item.line.weldControlPercent == null || item.line.pvkControlPercent == null ? [] : calculateLineProgram(item.rows, item.line.weldControlPercent, item.line.pvkControlPercent, systemIndexSettings, accepted) }))
  return { calculations, accepted, systemIndexSettings }
}

/** Summary removal hints need request/conclusion presence, loaded in batches, never per joint. */
async function attachCalculationRelations(rows: WeldRow[], db: Pick<SystemDocumentSequenceTransaction, 'select'>) {
  if (!rows.length) return rows
  await attachProgramChainStates(rows, db)
  const ids = rows.map(row => row.id)
  const pre = await db.select({ id: preHeatTreatmentControls.id, weldJointId: preHeatTreatmentControls.weldJointId, method: preHeatTreatmentControls.method, result: preHeatTreatmentControls.result, requestName: preHeatTreatmentControls.requestName, requestDate: preHeatTreatmentControls.requestDate, conclusionName: preHeatTreatmentControls.conclusionName, conclusionDate: preHeatTreatmentControls.conclusionDate }).from(preHeatTreatmentControls).where(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, ids))
  const duplicates = await db.select({ id: duplicateControls.id, weldJointId: duplicateControls.weldJointId, method: duplicateControls.method, result: duplicateControls.result, conclusion: duplicateControls.conclusion, conclusionDate: duplicateControls.conclusionDate, controlDate: duplicateControls.controlDate }).from(duplicateControls).where(buildNumberArrayMatch(duplicateControls.weldJointId, ids))
  const repeats = await db.select().from(pstoRepeatCycles).where(buildNumberArrayMatch(pstoRepeatCycles.weldJointId, ids))
  const [stored] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses))
  let value: unknown
  try { value = stored ? JSON.parse(stored.value) : undefined } catch { value = undefined }
  const settings = normalizeControlProcessSettings(value)
  const byId = new Map(rows.map(row => { row.preHeatTreatmentLnkEnabled = settings.preHeatTreatmentLnkEnabled; return [row.id, row] as const }))
  for (const control of pre) { const row = byId.get(control.weldJointId); if (row) (row.preHeatTreatmentControls ??= []).push(control) }
  for (const control of duplicates) { const row = byId.get(control.weldJointId); if (row) (row.duplicateControls ??= []).push({ ...control, method: control.method as 'ВИК' | 'РК' | 'УЗК' | 'ПВК', result: control.result as 'годен' | 'ремонт' | 'вырез', conclusion: control.conclusion ?? '', conclusionDate: control.conclusionDate ?? '', controlDate: control.controlDate ?? '' }) }
  for (const cycle of repeats) { const row = byId.get(cycle.weldJointId); if (row) (row.pstoRepeatCycles ??= []).push(cycle) }
  return rows
}
export const findLineProgram = createServerFn({ method: 'GET' })
  .validator((data: LineProgramIdentity) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const [line] = await requireDb().select().from(linePrograms).where(sql`
      lower(btrim(${linePrograms.projectTitle})) = ${String(data.projectTitle ?? '').trim().toLocaleLowerCase('ru')}
      and lower(btrim(${linePrograms.subtitleCode})) = ${String(data.subtitleCode ?? '').trim().toLocaleLowerCase('ru')}
      and lower(btrim(${linePrograms.line})) = ${String(data.line ?? '').trim().toLocaleLowerCase('ru')}`).limit(1)
    return line ? toLineProgramRecord(line) : null
  })

/** Compact section summary, cached separately from line details. No full journal payload or per-line RPC. */
export const getLineProgramSection = createServerFn({ method: 'GET' })
  .validator((data: LineProgramListRequest) => ({ tab: data?.tab ?? 'lines', search: String(data?.search ?? '').trim().slice(0, 200) }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return requireDb().transaction(async db => {
      const search = `%${data.search.replace(/[\\%_]/g, '\\$&')}%`
      const where = and(data.tab !== 'lines' ? sql`${linePrograms.configurationIssue} is null` : undefined,
        data.tab === 'full' ? eq(linePrograms.weldControlPercent, 100) : data.tab === 'percentage' ? sql`${linePrograms.weldControlPercent} < 100` : undefined,
        data.search ? or(ilike(linePrograms.projectTitle, search), ilike(linePrograms.subtitleCode, search), ilike(linePrograms.line, search), exists(db.select({ id: weldJoints.id }).from(weldJoints).where(and(eq(weldJoints.lineProgramId, linePrograms.id), or(...OFFICIAL_WELDER_STAMP_FIELD_KEYS.map(key => ilike(weldJoints[key], search))))))) : undefined)
      const lines = await db.select().from(linePrograms).where(where).orderBy(asc(linePrograms.projectTitle), asc(linePrograms.subtitleCode), asc(linePrograms.line), asc(linePrograms.id))
      return { rows: await loadLineProgramOverviews(db, lines.map(toLineProgramRecord)) }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  })

/** One preview request, batched identities; never initializes or changes a program. */
export const getLineProgramsForImport = createServerFn({ method: 'POST' })
  .validator((data: { identities: LineProgramIdentity[] }) => {
    if (!Array.isArray(data?.identities)) throw new Error('Не переданы линии импорта.')
    assertWeldImportRowLimit(data.identities.length)
    return data
  })
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return [...(await loadLineProgramsForIdentities(requireDb(), data.identities)).values()].map(toLineProgramRecord)
  })

export const getLineProgramCalculation = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => ({ id: Number(data.id) }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return requireDb().transaction(async (tx) => {
    const [line] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.id)).limit(1)
    if (!line) throw new Error('Линия больше не существует.')
    const issue = line.configurationIssue ?? getLineProgramConfigurationIssue(line)
    if (issue || line.weldControlPercent == null || line.pvkControlPercent == null) return { line: toLineProgramRecord(line), stamps: [], stampRows: [], unassigned: null, summary: null, issue }
    const loadedRows = await loadLineProgramRows(tx, line)
    const settings = await loadProgramSystemIndexSettings(tx)
    const accepted = await loadProgramApprovals(tx, loadedRows.map(row => row.id))
    const approvedKeys = new Set(accepted.map(warning => warning.key))
    const rows = attachProgramRepairRequirements(loadedRows, approvedKeys, settings)
    const calculations = calculateLineProgram(rows, line.weldControlPercent, line.pvkControlPercent, settings, approvedKeys)
    const goodIds = new Set(rows.filter(row => isProgramControlComplete(row)).map(row => row.id))
    const displayedCalculations = projectProgramExcess(line.id, rows, calculations, approvedKeys)
    const display = buildLineProgramDisplay(rows, displayedCalculations, line.weldControlPercent, line.pvkControlPercent, getProgramRemovalHints(line.id, rows, calculations, approvedKeys))
    const welderNames = await loadLineProgramWelderNames(tx, display.stampRows.map(group => group.stamp))
    const stamps = displayedCalculations.map((stamp) => ({
      scope: stamp.scope ?? 'stamp', stamp: stamp.stamp, count: stamp.rowIds.length, rejected: stamp.rejectedRowIds.length,
      welderName: welderNames.get(stamp.stamp.trim().toUpperCase()) ?? '',
      good: stamp.rowIds.filter(id => goodIds.has(id)).length,
      fullControlRequired: stamp.fullControlRequired,
      common: compactLineProgramDemand(stamp.common), pvk: compactLineProgramDemand(stamp.pvk),
    }))
    return { line: toLineProgramRecord(line), stamps, ...display, stampRows: display.stampRows.map(stamp => ({ ...stamp, welderName: welderNames.get(stamp.stamp.trim().toUpperCase()) ?? '' })), issue: null }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  })

export const getLineProgramJointPage = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => ({ id: Number(data.id) }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return requireDb().transaction(async (db) => {
    const [line] = await db.select().from(linePrograms).where(eq(linePrograms.id, data.id)).limit(1)
    if (!line) throw new Error('Линия больше не существует.')
    const rows = await db.select(WELD_TABLE_SELECT).from(weldJoints).where(lineProgramWeldWhere(line)).orderBy(asc(weldJoints.id))
    const attached = await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(rows as WeldRow[], db), db)
    const approvals = await loadProgramApprovals(db, attached.map(row => row.id))
    // One bounded document-metadata query for the opened line, never one query per joint.
    const withRequirements = attachProgramRepairRequirements(attached, new Set(approvals.map(item => item.key)), await loadProgramSystemIndexSettings(db))
    const detailed = applyGeneratedDocumentFields(withRequirements, await loadGeneratedDocumentAssignments(attached, db))
    return { total: detailed.length, ...packProgramRows(detailed), approvals, approvedKeys: approvals.map(row => row.key) }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  })

/** Detail is loaded only when requested and transfers at most 50 explanatory rows. */
export const getLineProgramExplanation = createServerFn({ method: 'GET' })
  .validator((data: { id: number; stamp?: string; kind: 'common' | 'pvk'; list: ProgramExplanationList; page: number }) => {
    if (!Number.isSafeInteger(data.id) || data.id <= 0 || !['common', 'pvk'].includes(data.kind) || !Object.hasOwn(PROGRAM_EXPLANATION_LISTS, data.list) || !Number.isSafeInteger(data.page) || data.page < 0) throw new Error('Некорректный запрос состава расчёта.')
    return { ...data, stamp: data.stamp?.trim().slice(0, 100) }
  })
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return requireDb().transaction(async tx => {
      const [line] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.id)).limit(1)
      if (!line || line.configurationIssue || line.weldControlPercent == null || line.pvkControlPercent == null) throw new Error('Обновите программу линии: расчёт недоступен.')
      const rows = await loadLineProgramRows(tx, line)
      const approved = new Set((await loadProgramApprovals(tx, rows.map(row => row.id))).map(item => item.key))
      return explainLineProgram(rows, line.weldControlPercent, line.pvkControlPercent, { ...data, lineId: line.id, approved, settings: await loadProgramSystemIndexSettings(tx) })
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  })

export const saveLineProgram = createServerFn({ method: 'POST' })
  .validator(normalizeLineProgramSaveRequest)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    return requireDb().transaction((tx) => saveLineProgramInTransaction(tx, data))
  })

/** Whole-line edit: no result/state revalidation or document regeneration as no joint is moved alone. */
export async function saveLineProgramInTransaction(tx: SystemDocumentSequenceTransaction, input: LineProgramSaveRequest) {
  const data = normalizeLineProgramSaveRequest(input)
  const [snapshot] = data.id ? await tx.select().from(linePrograms).where(eq(linePrograms.id, data.id)).limit(1) : []
  // Read the source before taking locks, then recheck its version under lock. Always lock
  // both memberships in the shared order used by imports, joint moves and PSTO operations.
  await lockWeldLineMemberships(tx, snapshot ? [snapshot, data] : [data])
  let updatedAt = new Date()
  let previous: LineProgram | undefined
  if (data.id) {
    const [locked] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.id)).for('update')
    previous = locked
    if (!previous || previous.updatedAt.toISOString() !== data.version) throw new Error('Программа линии изменена другим пользователем. Обновите её.')
    updatedAt = getNextTimestampVersion(previous.updatedAt)
  }
  const target = (await loadLineProgramsForIdentities(tx, [data])).get(getLineProgramIdentityKey(data))
  if (target && target.id !== data.id) throw new Error('Линия с таким проектом, шифром и названием уже существует. Объединение линий здесь недоступно.')
  const renamed = previous && hasLineProgramIdentityChanges(previous, data)
  if (previous && getLineProgramIdentityKey(previous) !== getLineProgramIdentityKey(data)) {
    const occupied = await tx.select({ id: weldJoints.id }).from(weldJoints).where(lineProgramWeldWhere(data)).limit(1)
    if (occupied.length) throw new Error('На целевой линии уже есть стыки. Выберите свободную связку проекта, шифра и линии.')
  }
  if (previous) {
    const inconsistent = await tx.select({ id: weldJoints.id }).from(weldJoints).where(sql`
      (${weldJoints.lineProgramId} = ${previous.id} and not (${lineProgramWeldWhere(previous)})) or
      ((${lineProgramWeldWhere(previous)}) and ${weldJoints.lineProgramId} <> ${previous.id})`).limit(1)
    if (inconsistent.length) throw new Error('Связь стыков с программой линии противоречит их названиям. Сначала исправьте данные линии.')
  }
  const source = previous ?? data
  // Lock narrowly, in ID order, before touching decisions; no full journal records are loaded.
  await tx.execute(sql`select ${weldJoints.id} from ${weldJoints} where ${lineProgramWeldWhere(source)} order by ${weldJoints.id} for update`)
  const values = { projectTitle: data.projectTitle, subtitleCode: data.subtitleCode, line: data.line,
    category: data.category, groupName: data.groupName, weldControlPercent: data.weldControlPercent,
    pvkControlPercent: data.pvkControlPercent, configurationIssue: getLineProgramConfigurationIssue(data), updatedAt }
  const [saved] = data.id ? await tx.update(linePrograms).set(values).where(eq(linePrograms.id, data.id)).returning() :
    await tx.insert(linePrograms).values(values).returning()
  await tx.update(weldJoints).set({ projectTitle: saved.projectTitle, subtitleCode: saved.subtitleCode, line: saved.line,
    lineProgramId: saved.id, category: saved.category, groupName: saved.groupName,
    weldControlPercent: saved.weldControlPercent, pvkControlPercent: saved.pvkControlPercent, hasVik: 'да',
    ...(renamed ? { weldingUpdatedAt: new Date() } : {}),
    updatedAt: sql`greatest(clock_timestamp(), ${weldJoints.updatedAt} + interval '1 millisecond')` })
    .where(lineProgramWeldWhere(source))
  if (previous && renamed) await renameLineProgramDecisions(tx, previous, data)
  await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(previous ? [previous, saved] : [saved], new Map()) })
  return toLineProgramRecord(saved)
}
