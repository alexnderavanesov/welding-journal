import { parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { parseJointChainName } from '@/lib/joint-chain'
import { getLnkDisplayValue, getPstoDisplayValue } from '@/lib/lnk-status'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  hasRealLnkResultValue,
  hasText,
  isCancelledControlValue,
  isEnabledControlValue,
} from '@/lib/report-value-utils'
import { calculateFinalStatusInRows, normalizeResultStatus } from '@/lib/weld-status'

export type StatisticsUnit = 'joints' | 'wdi'
export type StatisticsPeriodMode = 'events' | 'welded-joints'

export type StatisticsMethodSummary = {
  code: string
  requests: number
  closed: number
  totalClosed: number
  closedWithoutRequest: number
  pending: number
  waitingRequest: number
  waitingControl: number
  good: number
  rejected: number
  closurePercent: number
}

export type StatisticsSummary = {
  periodRows: WeldRow[]
  totalRows: number
  welded: number
  weldedShare: number
  good: number
  rejected: number
  waitingWeld: number
  waitingRequest: number
  waitingControl: number
  waitingRepair: number
  completedRepairs: number
  qualityPercent: number
  lnkRequests: number
  lnkClosed: number
  lnkTotalClosed: number
  lnkClosurePercent: number
  pstoRequests: number
  pstoClosed: number
  pstoTotalClosed: number
  pstoClosurePercent: number
  methods: StatisticsMethodSummary[]
  pstoMethod: StatisticsMethodSummary
}

export function getDefaultStatisticsPeriod(today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  return {
    from: formatDateInputValue(start),
    to: formatDateInputValue(today),
  }
}

export function buildStatisticsSummary(
  rows: WeldRow[],
  from: string,
  to: string,
  unit: StatisticsUnit,
  mode: StatisticsPeriodMode = 'events',
): StatisticsSummary {
  const periodRows = rows.filter((row) => isDateInRange(row.weldDate, from, to))
  const pendingWithoutWeldRows = rows.filter((row) => {
    if (hasText(row.weldDate)) return false
    const status = String(calculateFinalStatusInRows(row, rows)).trim().toLowerCase()
    return status === 'ожидает сварку' || status === 'ожидает ремонт'
  })
  const statusRows = [...periodRows, ...pendingWithoutWeldRows]
  const weightedRows = getWeightedRows(periodRows, unit)
  const weightedStatusRows = getWeightedRows(statusRows, unit)
  const totalRows = sumRows(weightedStatusRows, unit)
  const welded = sumRows(weightedRows.filter((row) => hasText(row.weldDate)), unit)

  const statuses = weightedStatusRows.map((row) => String(calculateFinalStatusInRows(row, rows)).trim().toLowerCase())
  const good = sumRowsByStatus(weightedStatusRows, statuses, unit, 'годен')
  const rejected = sumRowsByStatus(weightedStatusRows, statuses, unit, 'не годен')
  const waitingWeld = sumRowsByStatus(weightedStatusRows, statuses, unit, 'ожидает сварку')
  const waitingRequest = sumRowsByStatus(weightedStatusRows, statuses, unit, 'ожидает заявку')
  const waitingControl = sumRowsByStatus(weightedStatusRows, statuses, unit, 'ожидает нк')
  const waitingRepair = sumRowsByStatus(weightedStatusRows, statuses, unit, 'ожидает ремонт')
  const completedRepairs = sumRows(weightedRows.filter(isCompletedRepeatedJoint), unit)

  const methods = LNK_METHODS.map((method) => {
    const activeRows = weightedRows.filter((row) => isStatisticsLnkActive(row, method))
    const requestSourceRows =
      mode === 'events'
        ? getWeightedRows(rows.filter((row) => isLnkRequestInRange(row, method, from, to)), unit)
        : weightedRows
    const closedSourceRows =
      mode === 'events' ? getWeightedRows(rows.filter((row) => isDateInRange(row[method.conclusionDateKey], from, to)), unit) : weightedRows
    const requestRows = requestSourceRows.filter((row) => hasStatisticsLnkRequest(row, method))
    const closedRows = closedSourceRows.filter((row) => hasLnkClosedData(row, method))
    const closedRequestRows = requestRows.filter((row) => hasLnkClosedData(row, method))
    const closedWithoutRequestRows = closedRows.filter((row) => !hasStatisticsLnkRequest(row, method))
    const waitingRequestRows = activeRows.filter((row) => !hasStatisticsLnkRequest(row, method) && !hasLnkClosedData(row, method))
    const waitingControlRows = requestRows.filter((row) => !hasLnkClosedData(row, method))
    const requests = sumRows(requestRows, unit)
    const closed = sumRows(closedRequestRows, unit)
    const totalClosed = sumRows(closedRows, unit)
    const waitingControl = sumRows(waitingControlRows, unit)
    const goodRows = closedRows.filter((row) => normalizeResultStatus(row[method.resultKey]) === 'годен')
    const rejectedRows = closedRows.filter((row) => {
      const result = normalizeResultStatus(row[method.resultKey])
      return result === 'ремонт' || result === 'вырез'
    })
    return {
      code: method.code,
      requests,
      closed,
      totalClosed,
      closedWithoutRequest: sumRows(closedWithoutRequestRows, unit),
      pending: waitingControl,
      waitingRequest: sumRows(waitingRequestRows, unit),
      waitingControl,
      good: sumRows(goodRows, unit),
      rejected: sumRows(rejectedRows, unit),
      closurePercent: getPercent(closed, requests),
    }
  })

  const pstoRequestSourceRows =
    mode === 'events' ? getWeightedRows(rows.filter((row) => isPstoRequestInRange(row, from, to)), unit) : weightedRows
  const pstoClosedSourceRows =
    mode === 'events' ? getWeightedRows(rows.filter((row) => isDateInRange(row.pstoDate, from, to)), unit) : weightedRows
  const pstoRequestRows = pstoRequestSourceRows.filter(hasStatisticsPstoRequest)
  const pstoActiveRows = weightedRows.filter(isStatisticsPstoActive)
  const pstoClosedRows = pstoClosedSourceRows.filter(hasPstoClosedData)
  const pstoClosedRequestRows = pstoRequestRows.filter(hasPstoClosedData)
  const pstoWaitingRequestRows = pstoActiveRows.filter((row) => !hasStatisticsPstoRequest(row) && !hasPstoClosedData(row))
  const pstoWaitingControlRows = pstoRequestRows.filter((row) => !hasPstoClosedData(row))
  const pstoRequests = sumRows(pstoRequestRows, unit)
  const pstoClosed = sumRows(pstoClosedRows, unit)
  const pstoClosedByRequest = sumRows(pstoClosedRequestRows, unit)
  const pstoClosedWithoutRequest = sumRows(pstoClosedRows.filter((row) => !hasStatisticsPstoRequest(row)), unit)
  const pstoWaitingControl = sumRows(pstoWaitingControlRows, unit)
  const pstoMethod = {
    code: 'ПСТО',
    requests: pstoRequests,
    closed: pstoClosedByRequest,
    totalClosed: pstoClosed,
    closedWithoutRequest: pstoClosedWithoutRequest,
    pending: pstoWaitingControl,
    waitingRequest: sumRows(pstoWaitingRequestRows, unit),
    waitingControl: pstoWaitingControl,
    good: sumRows(pstoClosedRows.filter((row) => String(row.pstoResult ?? '').trim().toLowerCase().includes('проведено')), unit),
    rejected: 0,
    closurePercent: getPercent(pstoClosedByRequest, pstoRequests),
  }

  const lnkRequests = methods.reduce((total, method) => total + method.requests, 0)
  const lnkClosed = methods.reduce((total, method) => total + method.closed, 0)
  const lnkTotalClosed = methods.reduce((total, method) => total + method.totalClosed, 0)

  return {
    periodRows,
    totalRows,
    welded,
    weldedShare: getPercent(welded, totalRows),
    good,
    rejected,
    waitingWeld,
    waitingRequest,
    waitingControl,
    waitingRepair,
    completedRepairs,
    qualityPercent: getPercent(good, good + rejected),
    lnkRequests,
    lnkClosed,
    lnkTotalClosed,
    lnkClosurePercent: getPercent(lnkClosed, lnkRequests),
    pstoRequests,
    pstoClosed: pstoClosedByRequest,
    pstoTotalClosed: pstoClosed,
    pstoClosurePercent: getPercent(pstoClosedByRequest, pstoRequests),
    methods,
    pstoMethod,
  }
}

export function formatStatisticValue(value: number, unit: StatisticsUnit) {
  if (unit === 'wdi') return formatNumber(value)
  return String(Math.round(value))
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%'
  return `${Math.round(value)}%`
}

function isDateInRange(value: unknown, from: string, to: string) {
  const date = parseDateForStatistics(value)
  if (!date) return false
  return (!from || date >= from) && (!to || date <= to)
}

function isIsoDateInRange(date: string | null, from: string, to: string) {
  if (!date) return false
  return (!from || date >= from) && (!to || date <= to)
}

function getWeightedRows(rows: WeldRow[], unit: StatisticsUnit) {
  return unit === 'wdi' ? rows.filter((row) => getRowWeight(row, unit) > 0) : rows
}

function parseDateForStatistics(value: unknown) {
  const parsed = parseDateLikeToIso(value)
  if (parsed) return parsed
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function parseDateFromText(value: unknown) {
  const match = String(value ?? '').match(/(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))/)
  return match ? parseDateForStatistics(match[1]) : null
}

function sumRows(rows: WeldRow[], unit: StatisticsUnit) {
  return rows.reduce((total, row) => total + getRowWeight(row, unit), 0)
}

function sumRowsByStatus(rows: WeldRow[], statuses: string[], unit: StatisticsUnit, status: string) {
  return rows.reduce((total, row, index) => total + (statuses[index] === status ? getRowWeight(row, unit) : 0), 0)
}

function hasLnkClosedData(row: WeldRow, method: (typeof LNK_METHODS)[number]) {
  if (isStatisticsLnkNoNeed(row, method)) return false
  const result = String(row[method.resultKey] ?? '').trim().toLowerCase()
  return hasRealLnkResultValue(result) || result === 'годен (отменен)'
}

function hasStatisticsLnkRequest(row: WeldRow, method: (typeof LNK_METHODS)[number]) {
  if (!hasText(row[method.requestKey])) return false
  if (isStatisticsLnkNoNeed(row, method)) return false
  return !isCancelledControlValue(row[method.enabledKey]) || hasLnkClosedData(row, method)
}

function isStatisticsLnkActive(row: WeldRow, method: (typeof LNK_METHODS)[number]) {
  return isEnabledControlValue(row[method.enabledKey]) && !isStatisticsLnkNoNeed(row, method)
}

function isStatisticsLnkNoNeed(row: WeldRow, method: (typeof LNK_METHODS)[number]) {
  return String(getLnkDisplayValue(row, method.resultKey) ?? '').trim().toLowerCase() === 'нет потребности'
}

function isLnkRequestInRange(row: WeldRow, method: (typeof LNK_METHODS)[number], from: string, to: string) {
  if (!hasStatisticsLnkRequest(row, method)) return false
  const requestDate = parseDateFromText(row[method.requestKey]) ?? parseDateForStatistics(row.lnkCreatedAt)
  return isIsoDateInRange(requestDate, from, to)
}

function hasPstoClosedData(row: WeldRow) {
  if (isStatisticsPstoNoNeed(row)) return false
  const result = String(row.pstoResult ?? '').trim().toLowerCase()
  return result === 'проведено' || result === 'проведено (отменен)'
}

function hasStatisticsPstoRequest(row: WeldRow) {
  if (!hasText(row.pstoRequest)) return false
  if (isStatisticsPstoNoNeed(row)) return false
  return !isCancelledControlValue(row.pstoRequired) || hasPstoClosedData(row)
}

function isStatisticsPstoActive(row: WeldRow) {
  return isEnabledControlValue(row.pstoRequired) && !isStatisticsPstoNoNeed(row)
}

function isStatisticsPstoNoNeed(row: WeldRow) {
  return String(getPstoDisplayValue(row, 'pstoResult') ?? '').trim().toLowerCase() === 'нет потребности'
}

function isPstoRequestInRange(row: WeldRow, from: string, to: string) {
  if (!hasStatisticsPstoRequest(row)) return false
  const requestDate = parseDateFromText(row.pstoRequest) ?? parseDateForStatistics(row.pstoCreatedAt)
  return isIsoDateInRange(requestDate, from, to)
}

function getRowWeight(row: WeldRow, unit: StatisticsUnit) {
  if (unit === 'joints') return 1
  const value = Number(String(row.wdi ?? '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function isCompletedRepeatedJoint(row: WeldRow) {
  if (!hasText(row.weldDate)) return false
  return parseJointChainName(String(row.joint ?? '')).segments.length > 0
}

function getPercent(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0
}

function formatDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)
}
