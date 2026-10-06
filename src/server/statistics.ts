import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  duplicateControls,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  welderStamps,
  weldJoints,
} from '@/db/schema'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  buildStatisticsServerResult,
  type StatisticsServerRequest,
  type StatisticsServerResult,
} from '@/lib/statistics-server-summary'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  normalizeSystemIndexSettings,
} from '@/lib/system-index-settings'
import { DEFAULT_OTHER_SETTINGS, normalizeOtherSettings } from '@/lib/other-settings'
import { prepareReportRows } from '@/lib/use-report-rows'
import { prepareStatisticsHeatTreatmentRows } from '@/lib/statistics-psto-cycle'
import { normalizeControlProcessSettings } from '@/lib/control-process-settings'
import { toWelderStampPayload } from '@/server/welder-stamps'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import { getOrComputeDerivedCalculation } from '@/server/derived-calculation-cache'
import { assertSecurityScope } from '@/server/security-functions'
import { WELD_EFFECTIVE_OFFICIALITY } from '@/server/weld-server-shared'
import { attachProgramChainStates } from '@/server/line-program-chain-state'
import { isSystemWdiMode, withSystemWdi } from '@/lib/wdi'

const STATISTICS_STATUS_ROW_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  joint: weldJoints.joint,
  officiality: WELD_EFFECTIVE_OFFICIALITY,
  wdi: weldJoints.wdi,
  connectionType: weldJoints.connectionType,
  d1: weldJoints.d1,
  d2: weldJoints.d2,
  t1: weldJoints.t1,
  t2: weldJoints.t2,
  hasVik: weldJoints.hasVik,
  hasRk: weldJoints.hasRk,
  hasPvk: weldJoints.hasPvk,
  hasUzk: weldJoints.hasUzk,
  hasTvmt: weldJoints.hasTvmt,
  layeredControlAssigned: weldJoints.layeredControlAssigned,
  pvkControlPercent: weldJoints.pvkControlPercent,
  pstoRequired: weldJoints.pstoRequired,
  pstoRequest: weldJoints.pstoRequest,
  pstoRequestDate: weldJoints.pstoRequestDate,
  pstoResult: weldJoints.pstoResult,
  pstoDate: weldJoints.pstoDate,
  vikRequest: weldJoints.vikRequest,
  vikRequestDate: weldJoints.vikRequestDate,
  rkRequest: weldJoints.rkRequest,
  rkRequestDate: weldJoints.rkRequestDate,
  pvkRequest: weldJoints.pvkRequest,
  pvkRequestDate: weldJoints.pvkRequestDate,
  uzkRequest: weldJoints.uzkRequest,
  uzkRequestDate: weldJoints.uzkRequestDate,
  tvmtRequest: weldJoints.tvmtRequest,
  tvmtRequestDate: weldJoints.tvmtRequestDate,
  vikResult: weldJoints.vikResult,
  rkResult: weldJoints.rkResult,
  pvkResult: weldJoints.pvkResult,
  uzkResult: weldJoints.uzkResult,
  tvmtResult: weldJoints.tvmtResult,
}

const STATISTICS_GENERAL_ROW_SELECT = {
  ...STATISTICS_STATUS_ROW_SELECT,
  groupName: weldJoints.groupName,
  category: weldJoints.category,
  weldControlPercent: weldJoints.weldControlPercent,
  revisionActuality: weldJoints.revisionActuality,
  materialGroup: weldJoints.materialGroup,
  stamp1KFact: weldJoints.stamp1KFact,
  stamp1ZFact: weldJoints.stamp1ZFact,
  stamp1OFact: weldJoints.stamp1OFact,
  stamp2KFact: weldJoints.stamp2KFact,
  stamp2ZFact: weldJoints.stamp2ZFact,
  stamp2OFact: weldJoints.stamp2OFact,
  vikConclusion: weldJoints.vikConclusion,
  vikConclusionDate: weldJoints.vikConclusionDate,
  rkConclusion: weldJoints.rkConclusion,
  rkConclusionDate: weldJoints.rkConclusionDate,
  pvkConclusion: weldJoints.pvkConclusion,
  pvkConclusionDate: weldJoints.pvkConclusionDate,
  uzkConclusion: weldJoints.uzkConclusion,
  uzkConclusionDate: weldJoints.uzkConclusionDate,
  tvmtConclusion: weldJoints.tvmtConclusion,
  tvmtConclusionDate: weldJoints.tvmtConclusionDate,
  pstoCreatedAt: weldJoints.pstoCreatedAt,
  lnkCreatedAt: weldJoints.lnkCreatedAt,
}

const STATISTICS_WELDER_ROW_SELECT = {
  ...STATISTICS_STATUS_ROW_SELECT,
  materialGroup: weldJoints.materialGroup,
  stamp1KFact: weldJoints.stamp1KFact,
  stamp1ZFact: weldJoints.stamp1ZFact,
  stamp1OFact: weldJoints.stamp1OFact,
  stamp2KFact: weldJoints.stamp2KFact,
  stamp2ZFact: weldJoints.stamp2ZFact,
  stamp2OFact: weldJoints.stamp2OFact,
}

const STATISTICS_LINE_ROW_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  joint: weldJoints.joint,
  officiality: WELD_EFFECTIVE_OFFICIALITY,
  wdi: weldJoints.wdi,
  connectionType: weldJoints.connectionType,
  d1: weldJoints.d1,
  d2: weldJoints.d2,
  t1: weldJoints.t1,
  t2: weldJoints.t2,
  groupName: weldJoints.groupName,
  category: weldJoints.category,
  weldControlPercent: weldJoints.weldControlPercent,
  revisionActuality: weldJoints.revisionActuality,
}

export const getStatisticsServerResult = createServerFn({ method: 'POST' })
  .validator((data: StatisticsServerRequest) => normalizeStatisticsServerRequest(data))
  .handler(async ({ data }): Promise<StatisticsServerResult> => {
    await assertSecurityScope('entry')
    return getOrComputeDerivedCalculation(
      buildDerivedCalculationCacheKey('statistics:v31', data),
      () => computeStatisticsServerResult(data),
    )
  })

export async function computeStatisticsServerResult(
  data: StatisticsServerRequest,
): Promise<StatisticsServerResult> {
  const db = requireDb()
  const scopeWhere = buildStatisticsScopeWhere(data)
  const projectWhere = data.projectFilter
    ? sql`lower(trim(coalesce(${weldJoints.projectTitle}, ''))) = ${data.projectFilter}`
    : undefined
  const rowSelect = getStatisticsRowSelect(data.tab)
  const needsControlHistory = data.tab !== 'lineSummary'
  const [sourceRows, duplicateRows, preControlRows, repeatCycleRows, projectRows, subtitleRows, stampRows, settingsRows] = await Promise.all([
    db
      .select(rowSelect)
      .from(weldJoints)
      .where(scopeWhere)
      .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint)),
    needsControlHistory ? db
      .select({
        id: duplicateControls.id,
        weldJointId: duplicateControls.weldJointId,
        method: duplicateControls.method,
        result: duplicateControls.result,
        controlDate: duplicateControls.controlDate,
        conclusion: duplicateControls.conclusion,
        conclusionDate: duplicateControls.conclusionDate,
        updatedAt: duplicateControls.updatedAt,
      })
      .from(duplicateControls)
      .innerJoin(weldJoints, eq(weldJoints.id, duplicateControls.weldJointId))
      .where(scopeWhere)
      .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id)) : Promise.resolve([]),
    needsControlHistory ? db
      .select({
        id: preHeatTreatmentControls.id,
        weldJointId: preHeatTreatmentControls.weldJointId,
        method: preHeatTreatmentControls.method,
        requestName: preHeatTreatmentControls.requestName,
        requestDate: preHeatTreatmentControls.requestDate,
        result: preHeatTreatmentControls.result,
        conclusionDate: preHeatTreatmentControls.conclusionDate,
        conclusionName: preHeatTreatmentControls.conclusionName,
        defectDescription: preHeatTreatmentControls.defectDescription,
        rkExposureConfirmedDiameter: preHeatTreatmentControls.rkExposureConfirmedDiameter,
      })
      .from(preHeatTreatmentControls)
      .innerJoin(weldJoints, eq(weldJoints.id, preHeatTreatmentControls.weldJointId))
      .where(scopeWhere)
      .orderBy(asc(preHeatTreatmentControls.weldJointId), asc(preHeatTreatmentControls.id)) : Promise.resolve([]),
    needsControlHistory ? db
      .select({
        id: pstoRepeatCycles.id,
        weldJointId: pstoRepeatCycles.weldJointId,
        sequence: pstoRepeatCycles.sequence,
        pstoRequest: pstoRepeatCycles.pstoRequest,
        pstoRequestDate: pstoRepeatCycles.pstoRequestDate,
        pstoDate: pstoRepeatCycles.pstoDate,
        heatTreatmentDiagram: pstoRepeatCycles.heatTreatmentDiagram,
        pstoResult: pstoRepeatCycles.pstoResult,
        pstoNote: pstoRepeatCycles.pstoNote,
        tvmtRequest: pstoRepeatCycles.tvmtRequest,
        tvmtRequestDate: pstoRepeatCycles.tvmtRequestDate,
        tvmtResult: pstoRepeatCycles.tvmtResult,
        tvmtConclusionDate: pstoRepeatCycles.tvmtConclusionDate,
        tvmtConclusion: pstoRepeatCycles.tvmtConclusion,
      })
      .from(pstoRepeatCycles)
      .innerJoin(weldJoints, eq(weldJoints.id, pstoRepeatCycles.weldJointId))
      .where(scopeWhere)
      .orderBy(asc(pstoRepeatCycles.weldJointId), asc(pstoRepeatCycles.sequence)) : Promise.resolve([]),
    db.selectDistinct({ value: weldJoints.projectTitle }).from(weldJoints),
    db.selectDistinct({ value: weldJoints.subtitleCode }).from(weldJoints).where(projectWhere),
    data.tab === 'welders'
      ? db.select().from(welderStamps).orderBy(asc(welderStamps.id))
      : Promise.resolve([]),
    db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, [PROJECT_SETTING_KEYS.systemIndex, PROJECT_SETTING_KEYS.other, PROJECT_SETTING_KEYS.controlProcesses])),
  ])
  if (data.tab === 'general' || data.tab === 'lineSummary') await attachProgramChainStates(sourceRows, db)
  const otherSettings = normalizeOtherSettings(
    getStoredSetting(settingsRows, PROJECT_SETTING_KEYS.other) ?? DEFAULT_OTHER_SETTINGS,
  )
  const rows = !needsControlHistory
    ? (sourceRows as WeldRow[]).map(row => isSystemWdiMode(otherSettings) ? withSystemWdi(row, otherSettings) : row)
    : prepareReportRows(
    prepareStatisticsHeatTreatmentRows(
      sourceRows as WeldRow[],
      repeatCycleRows,
      preControlRows,
      normalizeControlProcessSettings(getStoredSetting(settingsRows, PROJECT_SETTING_KEYS.controlProcesses)),
    ),
    duplicateRows.map(toDuplicateControlRecord),
    undefined,
    undefined,
    otherSettings,
  )
  const systemIndexSettings = normalizeSystemIndexSettings(
    getStoredSetting(settingsRows, PROJECT_SETTING_KEYS.systemIndex) ?? DEFAULT_SYSTEM_INDEX_SETTINGS,
  )

  const result = buildStatisticsServerResult({
    rows,
    welderStamps: stampRows.map(toWelderStampPayload),
    systemIndexSettings,
    request: data,
  })
  return {
    ...result,
    projectOptions: toFilterOptions(projectRows.map((row) => row.value)),
    subtitleOptions: toFilterOptions(subtitleRows.map((row) => row.value)),
  }
}

function getStatisticsRowSelect(tab: StatisticsServerRequest['tab']) {
  if (tab === 'welders') return STATISTICS_WELDER_ROW_SELECT
  if (tab === 'lineSummary') return STATISTICS_LINE_ROW_SELECT
  return STATISTICS_GENERAL_ROW_SELECT
}

export function normalizeStatisticsServerRequest(data: StatisticsServerRequest): StatisticsServerRequest {
  if (String(data?.tab) === 'percentageLines') {
    throw new Error('Откройте «Программу линий»: прежний процентный расчёт статистики больше не используется. Обновите страницу.')
  }
  const tab =
    data?.tab === 'lnk' ||
    data?.tab === 'psto' ||
    data?.tab === 'welders' ||
    data?.tab === 'lineSummary'
      ? data.tab
      : 'general'

  return {
    tab,
    projectFilter: String(data?.projectFilter ?? '').trim().toLowerCase(),
    selectedSubtitles: Array.from(
      new Set(
        (data?.selectedSubtitles ?? [])
          .map((value) => String(value ?? '').trim().toLowerCase())
          .filter(Boolean),
      ),
    ).sort(),
    from: String(data?.from ?? '').trim(),
    to: String(data?.to ?? '').trim(),
    unit: data?.unit === 'wdi' ? 'wdi' : 'joints',
    jointFilter: data?.jointFilter === 'f' || data?.jointFilter === 's' ? data.jointFilter : 'all',
    controlDynamicsScale:
      data?.controlDynamicsScale === 'day' ||
      data?.controlDynamicsScale === 'week' ||
      data?.controlDynamicsScale === 'month' ||
      data?.controlDynamicsScale === 'quarter' ||
      data?.controlDynamicsScale === 'year'
        ? data.controlDynamicsScale
        : 'auto',
    weldingDynamicsScale:
      data?.weldingDynamicsScale === 'day' ||
      data?.weldingDynamicsScale === 'week' ||
      data?.weldingDynamicsScale === 'month' ||
      data?.weldingDynamicsScale === 'quarter' ||
      data?.weldingDynamicsScale === 'year'
        ? data.weldingDynamicsScale
        : 'auto',
  }
}

function getStoredSetting(rows: Array<{ key: string; value: string }>, key: string) {
  const row = rows.find((candidate) => candidate.key === key)
  if (!row) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

function buildStatisticsScopeWhere(data: StatisticsServerRequest) {
  const clauses: SQL[] = []
  if (data.projectFilter) {
    clauses.push(sql`lower(trim(coalesce(${weldJoints.projectTitle}, ''))) = ${data.projectFilter}`)
  }
  if (data.selectedSubtitles && data.selectedSubtitles.length > 0) {
    clauses.push(
      inArray(
        sql<string>`lower(trim(coalesce(${weldJoints.subtitleCode}, '')))`,
        data.selectedSubtitles,
      ),
    )
  }
  return clauses.length > 0 ? and(...clauses) : undefined
}

function toFilterOptions(values: unknown[]) {
  const unique = new Map<string, string>()
  for (const value of values) {
    const label = String(value ?? '').trim()
    const normalized = label.toLowerCase()
    if (normalized && !unique.has(normalized)) unique.set(normalized, label)
  }
  return Array.from(unique, ([value, label]) => ({ value, label })).sort((left, right) =>
    left.label.localeCompare(right.label, 'ru', { numeric: true }),
  )
}

function toDuplicateControlRecord(
  row: Pick<
    typeof duplicateControls.$inferSelect,
    'id' | 'weldJointId' | 'method' | 'result' | 'controlDate' | 'conclusion' | 'conclusionDate' | 'updatedAt'
  >,
): DuplicateControlRecord {
  return {
    id: row.id,
    version: row.updatedAt?.toISOString?.() ?? '',
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlRecord['method'],
    result: row.result as DuplicateControlRecord['result'],
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
  }
}
