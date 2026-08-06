import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  duplicateControls,
  welderStamps,
  weldJoints,
} from '@/db/schema'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
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
import { prepareReportRows } from '@/lib/use-report-rows'
import { toWelderStampPayload } from '@/server/welder-stamps'
import {
  buildDerivedCalculationCacheKey,
  getOrComputeDerivedCalculation,
} from '@/server/derived-calculation-cache'

const STATISTICS_ROW_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  groupName: weldJoints.groupName,
  category: weldJoints.category,
  weldControlPercent: weldJoints.weldControlPercent,
  joint: weldJoints.joint,
  status: weldJoints.status,
  revisionActuality: weldJoints.revisionActuality,
  wdi: weldJoints.wdi,
  materialGroup: weldJoints.materialGroup,
  stamp1K: weldJoints.stamp1K,
  stamp1Z: weldJoints.stamp1Z,
  stamp1O: weldJoints.stamp1O,
  stamp2K: weldJoints.stamp2K,
  stamp2Z: weldJoints.stamp2Z,
  stamp2O: weldJoints.stamp2O,
  stamp1KFact: weldJoints.stamp1KFact,
  stamp1ZFact: weldJoints.stamp1ZFact,
  stamp1OFact: weldJoints.stamp1OFact,
  stamp2KFact: weldJoints.stamp2KFact,
  stamp2ZFact: weldJoints.stamp2ZFact,
  stamp2OFact: weldJoints.stamp2OFact,
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
  mkkRequestDate: weldJoints.mkkRequestDate,
  vikResult: weldJoints.vikResult,
  rkResult: weldJoints.rkResult,
  pvkResult: weldJoints.pvkResult,
  uzkResult: weldJoints.uzkResult,
  tvmtResult: weldJoints.tvmtResult,
  rfaResult: weldJoints.rfaResult,
  stlsResult: weldJoints.stlsResult,
  mkkResult: weldJoints.mkkResult,
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

export const getStatisticsServerResult = createServerFn({ method: 'POST' })
  .validator((data: StatisticsServerRequest) => normalizeStatisticsServerRequest(data))
  .handler(async ({ data }): Promise<StatisticsServerResult> => {
    return getOrComputeDerivedCalculation(
      buildDerivedCalculationCacheKey('statistics:v1', data),
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
  const [sourceRows, projectRows, subtitleRows, stampRows, settingsRows] = await Promise.all([
    db
      .select(STATISTICS_ROW_SELECT)
      .from(weldJoints)
      .where(scopeWhere)
      .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint)),
    db.selectDistinct({ value: weldJoints.projectTitle }).from(weldJoints),
    db.selectDistinct({ value: weldJoints.subtitleCode }).from(weldJoints).where(projectWhere),
    data.tab === 'welders'
      ? db.select().from(welderStamps).orderBy(asc(welderStamps.id))
      : Promise.resolve([]),
    data.tab === 'percentageLines'
      ? Promise.resolve([])
      : db.select().from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.systemIndex)),
  ])
  const sourceIds = sourceRows.map((row) => row.id)
  const duplicateRows = sourceIds.length > 0
    ? (
        await Promise.all(
          Array.from({ length: Math.ceil(sourceIds.length / 1000) }, (_, index) =>
            sourceIds.slice(index * 1000, (index + 1) * 1000),
          ).map((ids) =>
            db
              .select()
              .from(duplicateControls)
              .where(inArray(duplicateControls.weldJointId, ids))
              .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id)),
          ),
        )
      ).flat()
    : []
  const rows = prepareReportRows(sourceRows, duplicateRows.map(toDuplicateControlRecord))
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

export function normalizeStatisticsServerRequest(data: StatisticsServerRequest): StatisticsServerRequest {
  const tab =
    data?.tab === 'lnk' ||
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
    periodMode: data?.periodMode === 'welded-joints' ? 'welded-joints' : 'events',
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

function toDuplicateControlRecord(row: typeof duplicateControls.$inferSelect): DuplicateControlRecord {
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
