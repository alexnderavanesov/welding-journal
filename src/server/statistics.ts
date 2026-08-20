import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, like, sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  dispatcherAcceptedWarnings,
  duplicateControls,
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
import { PERCENTAGE_LINE_NEW_WELDER_WARNING_KEY_PREFIX } from '@/lib/percentage-line-summary'
import { toWelderStampPayload } from '@/server/welder-stamps'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import { getOrComputeDerivedCalculation } from '@/server/derived-calculation-cache'
import { assertSecurityScope } from '@/server/security-functions'

const STATISTICS_STATUS_ROW_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  joint: weldJoints.joint,
  status: weldJoints.status,
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
  hasRfa: weldJoints.hasRfa,
  hasStls: weldJoints.hasStls,
  hasMkk: weldJoints.hasMkk,
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
  rfaRequest: weldJoints.rfaRequest,
  rfaRequestDate: weldJoints.rfaRequestDate,
  stlsRequest: weldJoints.stlsRequest,
  stlsRequestDate: weldJoints.stlsRequestDate,
  mkkRequest: weldJoints.mkkRequest,
  vikResult: weldJoints.vikResult,
  rkResult: weldJoints.rkResult,
  pvkResult: weldJoints.pvkResult,
  uzkResult: weldJoints.uzkResult,
  tvmtResult: weldJoints.tvmtResult,
  rfaResult: weldJoints.rfaResult,
  stlsResult: weldJoints.stlsResult,
  mkkResult: weldJoints.mkkResult,
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
  mkkRequestDate: weldJoints.mkkRequestDate,
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
  rfaConclusion: weldJoints.rfaConclusion,
  rfaConclusionDate: weldJoints.rfaConclusionDate,
  stlsConclusion: weldJoints.stlsConclusion,
  stlsConclusionDate: weldJoints.stlsConclusionDate,
  mkkConclusion: weldJoints.mkkConclusion,
  mkkConclusionDate: weldJoints.mkkConclusionDate,
  pstoRequired: weldJoints.pstoRequired,
  pstoRequest: weldJoints.pstoRequest,
  pstoRequestDate: weldJoints.pstoRequestDate,
  pstoResult: weldJoints.pstoResult,
  pstoDate: weldJoints.pstoDate,
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
  ...STATISTICS_STATUS_ROW_SELECT,
  groupName: weldJoints.groupName,
  category: weldJoints.category,
  weldControlPercent: weldJoints.weldControlPercent,
  revisionActuality: weldJoints.revisionActuality,
}

const STATISTICS_PERCENTAGE_LINE_ROW_SELECT = {
  ...STATISTICS_STATUS_ROW_SELECT,
  weldControlPercent: weldJoints.weldControlPercent,
  revisionActuality: weldJoints.revisionActuality,
  stamp1K: weldJoints.stamp1K,
  stamp1Z: weldJoints.stamp1Z,
  stamp1O: weldJoints.stamp1O,
  stamp2K: weldJoints.stamp2K,
  stamp2Z: weldJoints.stamp2Z,
  stamp2O: weldJoints.stamp2O,
}

export const getStatisticsServerResult = createServerFn({ method: 'POST' })
  .validator((data: StatisticsServerRequest) => normalizeStatisticsServerRequest(data))
  .handler(async ({ data }): Promise<StatisticsServerResult> => {
    await assertSecurityScope('entry')
    return getOrComputeDerivedCalculation(
      buildDerivedCalculationCacheKey('statistics:v17', data),
      () => computeStatisticsServerResult(data),
    )
  })

async function computeStatisticsServerResult(
  data: StatisticsServerRequest,
): Promise<StatisticsServerResult> {
  const db = requireDb()
  const scopeWhere = buildStatisticsScopeWhere(data)
  const projectWhere = data.projectFilter
    ? sql`lower(trim(coalesce(${weldJoints.projectTitle}, ''))) = ${data.projectFilter}`
    : undefined
  const rowSelect = getStatisticsRowSelect(data.tab)
  const [sourceRows, duplicateRows, projectRows, subtitleRows, stampRows, settingsRows, acceptedWarningRows] = await Promise.all([
    db
      .select(rowSelect)
      .from(weldJoints)
      .where(scopeWhere)
      .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint)),
    db
      .select({
        id: duplicateControls.id,
        weldJointId: duplicateControls.weldJointId,
        method: duplicateControls.method,
        result: duplicateControls.result,
        controlDate: duplicateControls.controlDate,
        conclusion: duplicateControls.conclusion,
        conclusionDate: duplicateControls.conclusionDate,
      })
      .from(duplicateControls)
      .innerJoin(weldJoints, eq(weldJoints.id, duplicateControls.weldJointId))
      .where(scopeWhere)
      .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id)),
    db.selectDistinct({ value: weldJoints.projectTitle }).from(weldJoints),
    db.selectDistinct({ value: weldJoints.subtitleCode }).from(weldJoints).where(projectWhere),
    data.tab === 'welders'
      ? db.select().from(welderStamps).orderBy(asc(welderStamps.id))
      : Promise.resolve([]),
    db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, [PROJECT_SETTING_KEYS.systemIndex, PROJECT_SETTING_KEYS.other])),
    data.tab === 'percentageLines'
      ? db
          .select({ key: dispatcherAcceptedWarnings.key })
          .from(dispatcherAcceptedWarnings)
          .where(like(dispatcherAcceptedWarnings.key, `${PERCENTAGE_LINE_NEW_WELDER_WARNING_KEY_PREFIX}%`))
      : Promise.resolve([]),
  ])
  const otherSettings = normalizeOtherSettings(
    getStoredSetting(settingsRows, PROJECT_SETTING_KEYS.other) ?? DEFAULT_OTHER_SETTINGS,
  )
  const rows = prepareReportRows(
    sourceRows as WeldRow[],
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
    acceptedDispatcherWarningKeys: new Set(acceptedWarningRows.map((row) => row.key)),
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
  if (tab === 'percentageLines') return STATISTICS_PERCENTAGE_LINE_ROW_SELECT
  return STATISTICS_GENERAL_ROW_SELECT
}

export function normalizeStatisticsServerRequest(data: StatisticsServerRequest): StatisticsServerRequest {
  const tab =
    data?.tab === 'lnk' ||
    data?.tab === 'psto' ||
    data?.tab === 'welders' ||
    data?.tab === 'lineSummary' ||
    data?.tab === 'percentageLines'
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
    'id' | 'weldJointId' | 'method' | 'result' | 'controlDate' | 'conclusion' | 'conclusionDate'
  >,
): DuplicateControlRecord {
  return {
    id: row.id,
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlRecord['method'],
    result: row.result as DuplicateControlRecord['result'],
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
  }
}
