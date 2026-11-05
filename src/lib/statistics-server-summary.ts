import { normalizeFinalStatus } from './weld-status'
import { isTConnectionType } from './connection-type'
import { buildSupportStatistics, type SupportStatisticsSummary } from './support-statistics'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isUnofficialJoint } from '@/lib/joint-display'
import { parseJointChainName } from '@/lib/joint-chain'
import { buildLineSummary, getActualLineRows, summarizePhysicalLineRows, type LineSummary } from '@/lib/line-summary'
import {
  buildStatisticsSummary,
  buildStatisticsStateRowIds,
  createStatisticsFinalStatusReader,
  type StatisticsStateRowIds,
  type StatisticsSummary,
  type StatisticsUnit,
  type StatisticsControlDynamicsScaleSetting,
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
import {
  buildWeldingDynamics,
  type WeldingDynamicsScaleSetting,
  type WeldingDynamicsSummary,
} from '@/lib/welding-dynamics'

export type StatisticsTab = 'general' | 'supports' | 'lnk' | 'psto' | 'welders' | 'lineSummary'

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
  controlDynamicsScale?: StatisticsControlDynamicsScaleSetting
  weldingDynamicsScale?: WeldingDynamicsScaleSetting
}

export type StatisticsServerResult = {
  supportSummary?: SupportStatisticsSummary
  projectOptions: StatisticsFilterOption[]
  subtitleOptions: StatisticsFilterOption[]
  summary: StatisticsSummary
  weldingDynamics: WeldingDynamicsSummary
  welderSummary: WelderStatisticsSummary
  lineSummary: LineSummary
  generalProgressSummary: LineSummary
  generalStateRowIds: StatisticsStateRowIds
  unofficialCount: number
  unofficialRowIds: number[]
  unofficialValue: number
}

const EMPTY_STATISTICS_SUMMARY: StatisticsSummary = {
  periodRows: [],
  backlogTotal: 0,
  backlogWaitingWeld: 0,
  backlogWaitingRepair: 0,
  totalRows: 0,
  welded: 0,
  weldedShare: 0,
  good: 0,
  rejected: 0,
  rejectedJointCount: 0,
  duplicateGood: 0,
  duplicateRejected: 0,
  waitingWeld: 0,
  waitingRequest: 0,
  waitingControl: 0,
  waitingRepair: 0,
  completedRepairs: 0,
  qualityPercent: 0,
  lnkRequiredRequests: 0,
  lnkCreatedRequests: 0,
  lnkRequestCoveragePercent: 0,
  lnkRequests: 0,
  lnkClosed: 0,
  lnkTotalClosed: 0,
  lnkClosurePercent: 0,
  pstoRequiredRequests: 0,
  pstoCreatedRequests: 0,
  pstoRequestCoveragePercent: 0,
  pstoRequests: 0,
  pstoClosed: 0,
  pstoTotalClosed: 0,
  pstoClosurePercent: 0,
  methods: [],
  pstoMethod: {
    code: 'ПСТО',
    requiredRequests: 0,
    createdRequests: 0,
    requestCoveragePercent: 0,
    requests: 0,
    closed: 0,
    totalClosed: 0,
    closedWithoutRequest: 0,
    pending: 0,
    waitingRequest: 0,
    waitingControl: 0,
    good: 0,
    rejected: 0,
    goodFromClosedRequests: 0,
    rejectedFromClosedRequests: 0,
    closurePercent: 0,
    rowIds: {
      requiredRequests: [],
      createdRequests: [],
      requests: [],
      closed: [],
      totalClosed: [],
      closedWithoutRequest: [],
      waitingRequest: [],
      waitingControl: [],
      good: [],
      rejected: [],
    },
  },
  tvmtMethod: {
    code: 'ТВМТ',
    requiredRequests: 0,
    createdRequests: 0,
    requestCoveragePercent: 0,
    requests: 0,
    closed: 0,
    totalClosed: 0,
    closedWithoutRequest: 0,
    pending: 0,
    waitingRequest: 0,
    waitingControl: 0,
    good: 0,
    rejected: 0,
    goodFromClosedRequests: 0,
    rejectedFromClosedRequests: 0,
    closurePercent: 0,
    rowIds: {
      requiredRequests: [],
      createdRequests: [],
      requests: [],
      closed: [],
      totalClosed: [],
      closedWithoutRequest: [],
      waitingRequest: [],
      waitingControl: [],
      good: [],
      rejected: [],
    },
  },
  controlDynamicsScale: 'day',
  controlDynamics: [],
}

const EMPTY_WELDING_DYNAMICS: WeldingDynamicsSummary = {
  bucketUnit: 'day',
  bucketUnitLabel: 'день',
  buckets: [],
  periodDays: 0,
  totalValue: 0,
  totalWelders: 0,
  welderShiftCount: 0,
  averageWeldersPerShift: 0,
  averageValuePerWelderShift: 0,
  peakValue: 0,
  peakWelders: 0,
  materialGroups: [],
  projectGroups: [],
  jointTypes: [],
  materialJointTypes: [],
  projectJointTypes: [],
  projectMaterialHierarchy: [],
  materialProjectHierarchy: [],
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

const EMPTY_STATISTICS_STATE_ROW_IDS: StatisticsStateRowIds = {
  good: [],
  rejected: [],
  duplicateGood: [],
  duplicateRejected: [],
  waitingWeld: [],
  waitingRequest: [],
  waitingControl: [],
  waitingRepair: [],
  backlog: [],
  backlogWaitingWeld: [],
  backlogWaitingRepair: [],
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
  // Control reports retain permitted T work. Production counters stay separate.
  if (tab === 'supports' || tab === 'general' || tab === 'welders' || tab === 'lineSummary') rows = rows.filter(row => isTConnectionType(row.connectionType) === (tab === 'supports'))
  const projectFilter = normalizeFilterValue(request.projectFilter)
  const selectedSubtitles = (request.selectedSubtitles ?? []).map(normalizeFilterValue).filter(Boolean)
  const from = String(request.from ?? '').trim()
  const to = String(request.to ?? '').trim()
  const unit = request.unit === 'wdi' ? 'wdi' : 'joints'
  const jointFilter = normalizeJointFilter(request.jointFilter)

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
  const physicalRows = tab === 'general' ? getActualLineRows(scopedRows, systemIndexSettings) : scopedRows
  const generalRows = physicalRows.filter((row) => matchesJointFilter(row, jointFilter, systemIndexSettings))
  const isGeneralLikeTab = tab === 'general' || tab === 'lnk' || tab === 'psto'
  // General production resolves physical representatives with the complete
  // scoped history. LNK/PSTO retain their existing joint-filtered status scope.
  const statusRows = tab === 'general' ? scopedRows : generalRows
  const readFinalStatus = isGeneralLikeTab ? createStatisticsFinalStatusReader(statusRows) : undefined
  const calculatedSummary = isGeneralLikeTab
    ? buildStatisticsSummary(
        generalRows,
        from,
        to,
        unit,
        systemIndexSettings,
        request.controlDynamicsScale ?? 'auto',
        statusRows,
        readFinalStatus,
      )
    : EMPTY_STATISTICS_SUMMARY
  // Resolve the chain before filtering the month/type; rejected history must
  // neither create extra volume nor erase a successful current continuation.
  const isCounted = (row: WeldRow) => normalizeFinalStatus(readFinalStatus!(row)) !== 'не годен'
  const productionRows = tab === 'general' ? calculatedSummary.periodRows.filter(isCounted) : []
  if (tab === 'general') {
    calculatedSummary.welded = sumRows(productionRows, unit)
    calculatedSummary.weldedShare = calculatedSummary.totalRows > 0 ? calculatedSummary.welded / calculatedSummary.totalRows * 100 : 0
    calculatedSummary.completedRepairs = sumRows(productionRows.filter(row => parseJointChainName(String(row.joint ?? ''), systemIndexSettings).segments.length > 0), unit)
  }
  const unofficialRows = isGeneralLikeTab ? calculatedSummary.periodRows.filter(isUnofficialJoint) : []

  return {
    ...(tab === 'supports' ? { supportSummary: buildSupportStatistics(scopedRows, from, to, systemIndexSettings, welderStamps) } : {}),
    projectOptions,
    subtitleOptions,
    summary: isGeneralLikeTab ? { ...calculatedSummary, periodRows: [] } : EMPTY_STATISTICS_SUMMARY,
    weldingDynamics:
      tab === 'general'
        ? buildWeldingDynamics(
            productionRows,
            from,
            to,
            unit,
            systemIndexSettings,
            request.weldingDynamicsScale ?? 'auto',
          )
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
    generalProgressSummary:
      tab === 'general'
        ? summarizePhysicalLineRows(generalRows, unit, systemIndexSettings, undefined, row => Boolean(String(row.weldDate ?? '').trim()) && isCounted(row))
        : EMPTY_LINE_SUMMARY,
    generalStateRowIds:
      isGeneralLikeTab
        ? buildStatisticsStateRowIds(generalRows, from, to, unit, statusRows, readFinalStatus)
        : EMPTY_STATISTICS_STATE_ROW_IDS,
    unofficialCount: unofficialRows.length,
    unofficialRowIds: unofficialRows
      .map((row) => Number(row.id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((left, right) => left - right),
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
  const baseJoint = parseJointChainName(String(row.joint ?? ''), systemIndexSettings).base.trim().toUpperCase()
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
