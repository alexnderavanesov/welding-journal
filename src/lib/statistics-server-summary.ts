import type { WeldRow } from '@/lib/dispatcher-types'
import { isUnofficialJoint } from '@/lib/joint-display'
import { parseJointChainName } from '@/lib/joint-chain'
import { buildLineSummary, type LineSummary } from '@/lib/line-summary'
import { buildPercentageLineSummaries, type PercentageLineSummary } from '@/lib/percentage-line-summary'
import {
  buildStatisticsSummary,
  type StatisticsPeriodMode,
  type StatisticsSummary,
  type StatisticsUnit,
} from '@/lib/statistics-summary'
import {
  getConfiguredBaseJointType,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import {
  buildWelderStatisticsSummary,
  type WelderStatisticsJointFilter,
  type WelderStatisticsSummary,
} from '@/lib/welder-statistics-summary'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import { buildWeldingDynamics, type WeldingDynamicsSummary } from '@/lib/welding-dynamics'

export type StatisticsTab = 'general' | 'lnk' | 'welders' | 'lineSummary' | 'percentageLines'

export type StatisticsFilterOption = {
  value: string
  label: string
}

export type StatisticsServerRequest = {
  tab: StatisticsTab
  projectFilter?: string
  selectedSubtitles?: string[]
  from?: string
  to?: string
  unit?: StatisticsUnit
  jointFilter?: WelderStatisticsJointFilter
  periodMode?: StatisticsPeriodMode
}

export type StatisticsServerResult = {
  projectOptions: StatisticsFilterOption[]
  subtitleOptions: StatisticsFilterOption[]
  summary: StatisticsSummary
  weldingDynamics: WeldingDynamicsSummary
  welderSummary: WelderStatisticsSummary
  lineSummary: LineSummary
  percentageLineSummary: PercentageLineSummary[]
  generalProgressSummary: LineSummary
  unofficialCount: number
  unofficialValue: number
}

const EMPTY_STATISTICS_SUMMARY: StatisticsSummary = {
  periodRows: [],
  totalRows: 0,
  welded: 0,
  weldedShare: 0,
  good: 0,
  rejected: 0,
  waitingWeld: 0,
  waitingRequest: 0,
  waitingControl: 0,
  waitingRepair: 0,
  completedRepairs: 0,
  qualityPercent: 0,
  lnkRequests: 0,
  lnkClosed: 0,
  lnkTotalClosed: 0,
  lnkClosurePercent: 0,
  pstoRequests: 0,
  pstoClosed: 0,
  pstoTotalClosed: 0,
  pstoClosurePercent: 0,
  methods: [],
  pstoMethod: {
    code: 'ПСТО',
    requests: 0,
    closed: 0,
    totalClosed: 0,
    closedWithoutRequest: 0,
    pending: 0,
    waitingRequest: 0,
    waitingControl: 0,
    good: 0,
    rejected: 0,
    closurePercent: 0,
  },
}

const EMPTY_WELDING_DYNAMICS: WeldingDynamicsSummary = {
  bucketUnit: 'day',
  bucketUnitLabel: 'день',
  buckets: [],
  periodDays: 0,
  totalValue: 0,
  totalWelders: 0,
  peakValue: 0,
  peakWelders: 0,
}

const EMPTY_WELDER_SUMMARY: WelderStatisticsSummary = {
  rows: [],
  totalWelders: 0,
  total: 0,
  good: 0,
  waitingRequest: 0,
  waitingControl: 0,
  rejected: 0,
  defectPercent: 0,
  fTotal: 0,
  sTotal: 0,
  fGood: 0,
  sGood: 0,
  fWaitingRequest: 0,
  sWaitingRequest: 0,
  fWaitingControl: 0,
  sWaitingControl: 0,
  fRejected: 0,
  sRejected: 0,
}

const EMPTY_LINE_SUMMARY: LineSummary = {
  rows: [],
  total: 0,
  completed: 0,
  remaining: 0,
}

export function buildStatisticsServerResult({
  rows,
  welderStamps,
  systemIndexSettings,
  request,
}: {
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  systemIndexSettings: SystemIndexSettings
  request: StatisticsServerRequest
}): StatisticsServerResult {
  const tab = request.tab
  const projectFilter = normalizeFilterValue(request.projectFilter)
  const selectedSubtitles = (request.selectedSubtitles ?? []).map(normalizeFilterValue).filter(Boolean)
  const from = String(request.from ?? '').trim()
  const to = String(request.to ?? '').trim()
  const unit = request.unit === 'wdi' ? 'wdi' : 'joints'
  const jointFilter = normalizeJointFilter(request.jointFilter)
  const periodMode = request.periodMode === 'welded-joints' ? 'welded-joints' : 'events'

  const projectOptions = getUniqueSortedValues(rows.map((row) => row.projectTitle))
  const subtitleOptions = getUniqueSortedValues(
    rows
      .filter((row) => !projectFilter || normalizeFilterValue(row.projectTitle) === projectFilter)
      .map((row) => row.subtitleCode),
  )
  const scopedRows = rows.filter((row) => {
    const projectMatches = !projectFilter || normalizeFilterValue(row.projectTitle) === projectFilter
    const subtitleMatches =
      selectedSubtitles.length === 0 || selectedSubtitles.includes(normalizeFilterValue(row.subtitleCode))
    return projectMatches && subtitleMatches
  })
  const generalRows = scopedRows.filter((row) => matchesJointFilter(row, jointFilter, systemIndexSettings))
  const isGeneralLikeTab = tab === 'general' || tab === 'lnk'
  const calculatedSummary = isGeneralLikeTab
    ? buildStatisticsSummary(generalRows, from, to, unit, periodMode)
    : EMPTY_STATISTICS_SUMMARY
  const unofficialRows = isGeneralLikeTab ? calculatedSummary.periodRows.filter(isUnofficialJoint) : []

  return {
    projectOptions,
    subtitleOptions,
    summary: isGeneralLikeTab ? { ...calculatedSummary, periodRows: [] } : EMPTY_STATISTICS_SUMMARY,
    weldingDynamics:
      tab === 'general'
        ? buildWeldingDynamics(calculatedSummary.periodRows, from, to, unit)
        : EMPTY_WELDING_DYNAMICS,
    welderSummary:
      tab === 'welders'
        ? buildWelderStatisticsSummary(
            scopedRows,
            welderStamps,
            from,
            to,
            unit,
            jointFilter,
            systemIndexSettings,
          )
        : EMPTY_WELDER_SUMMARY,
    lineSummary:
      tab === 'lineSummary'
        ? buildLineSummary(scopedRows, unit, systemIndexSettings)
        : EMPTY_LINE_SUMMARY,
    percentageLineSummary:
      tab === 'percentageLines'
        ? buildPercentageLineSummaries(scopedRows).map((line) => ({ ...line, rows: [] }))
        : [],
    generalProgressSummary:
      tab === 'general'
        ? buildLineSummary(generalRows, unit, systemIndexSettings)
        : EMPTY_LINE_SUMMARY,
    unofficialCount: unofficialRows.length,
    unofficialValue: sumRows(unofficialRows, unit),
  }
}

function normalizeJointFilter(value: unknown): WelderStatisticsJointFilter {
  return value === 'f' || value === 's' ? value : 'all'
}

function matchesJointFilter(
  row: WeldRow,
  filter: WelderStatisticsJointFilter,
  systemIndexSettings: SystemIndexSettings,
) {
  if (filter === 'all') return true
  const baseJoint = parseJointChainName(String(row.joint ?? '')).base.trim().toUpperCase()
  return getConfiguredBaseJointType(baseJoint, systemIndexSettings) === filter
}

function sumRows(rows: readonly WeldRow[], unit: StatisticsUnit) {
  if (unit === 'joints') return rows.length
  return rows.reduce((total, row) => {
    const value = Number(String(row.wdi ?? '').trim().replace(',', '.'))
    return total + (Number.isFinite(value) && value > 0 ? value : 0)
  }, 0)
}

function getUniqueSortedValues(values: unknown[]): StatisticsFilterOption[] {
  const uniqueValues = values.reduce<Map<string, string>>((map, value) => {
    const normalized = normalizeFilterValue(value)
    if (normalized && !map.has(normalized)) map.set(normalized, String(value ?? '').trim())
    return map
  }, new Map())

  return [...uniqueValues.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ru', { numeric: true }))
}

function normalizeFilterValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}
