import { parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { StatisticsUnit } from '@/lib/statistics-summary'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { calculateFinalStatusInRows } from '@/lib/weld-status'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampPart = {
  key: WeldFieldKey
  singleWeight: number
  doubleWeight: number
}

export type WelderStatisticsRow = {
  stamp: string
  total: number
  good: number
  waitingRequest: number
  waitingControl: number
  rejected: number
  defectPercent: number
}

export type WelderStatisticsSummary = {
  rows: WelderStatisticsRow[]
  totalWelders: number
  total: number
  good: number
  waitingRequest: number
  waitingControl: number
  rejected: number
  defectPercent: number
}

const indexOneFactStampParts: WelderStampPart[] = [
  { key: 'stamp1KFact', singleWeight: 0.4, doubleWeight: 0.2 },
  { key: 'stamp1ZFact', singleWeight: 0.3, doubleWeight: 0.15 },
  { key: 'stamp1OFact', singleWeight: 0.3, doubleWeight: 0.15 },
]

const indexTwoFactStampParts: WelderStampPart[] = [
  { key: 'stamp2KFact', singleWeight: 0, doubleWeight: 0.2 },
  { key: 'stamp2ZFact', singleWeight: 0, doubleWeight: 0.15 },
  { key: 'stamp2OFact', singleWeight: 0, doubleWeight: 0.15 },
]

export function buildWelderStatisticsSummary(
  rows: WeldRow[],
  welderStamps: WelderStampRecord[],
  from: string,
  to: string,
  unit: StatisticsUnit,
): WelderStatisticsSummary {
  const stampLabels = buildWelderStampLabelMap(welderStamps)
  const periodRows = rows.filter((row) => isDateInRange(row.weldDate, from, to))
  const stats = new Map<string, WelderStatisticsRow>()

  for (const row of periodRows) {
    const rowWeight = getRowWeight(row, unit)
    if (rowWeight <= 0) continue

    const hasSecondWelder = indexTwoFactStampParts.some((part) => hasText(row[part.key]))
    const parts = hasSecondWelder ? [...indexOneFactStampParts, ...indexTwoFactStampParts] : indexOneFactStampParts
    const status = String(calculateFinalStatusInRows(row, rows)).trim().toLowerCase()

    for (const part of parts) {
      const rawStamp = String(row[part.key] ?? '').trim()
      if (!rawStamp) continue

      const stamp = getWelderStampLabel(rawStamp, stampLabels)
      const partWeight = hasSecondWelder ? part.doubleWeight : part.singleWeight
      addWelderStat(stats, stamp, rowWeight * partWeight, status)
    }
  }

  const resultRows = Array.from(stats.values()).map((row) => ({
    ...row,
    defectPercent: getPercent(row.rejected, row.good + row.rejected),
  }))

  resultRows.sort(
    (left, right) =>
      left.defectPercent - right.defectPercent ||
      left.rejected - right.rejected ||
      right.total - left.total ||
      left.stamp.localeCompare(right.stamp, 'ru', { numeric: true }),
  )

  const total = resultRows.reduce(
    (summary, row) => ({
      total: summary.total + row.total,
      good: summary.good + row.good,
      waitingRequest: summary.waitingRequest + row.waitingRequest,
      waitingControl: summary.waitingControl + row.waitingControl,
      rejected: summary.rejected + row.rejected,
    }),
    { total: 0, good: 0, waitingRequest: 0, waitingControl: 0, rejected: 0 },
  )

  return {
    rows: resultRows,
    totalWelders: resultRows.length,
    ...total,
    defectPercent: getPercent(total.rejected, total.good + total.rejected),
  }
}

function addWelderStat(stats: Map<string, WelderStatisticsRow>, stamp: string, value: number, status: string) {
  const row =
    stats.get(stamp) ??
    ({
      stamp,
      total: 0,
      good: 0,
      waitingRequest: 0,
      waitingControl: 0,
      rejected: 0,
      defectPercent: 0,
    } satisfies WelderStatisticsRow)

  row.total += value
  if (status === 'годен') row.good += value
  if (status === 'ожидает заявку') row.waitingRequest += value
  if (status === 'ожидает нк') row.waitingControl += value
  if (status === 'не годен') row.rejected += value
  stats.set(stamp, row)
}

function buildWelderStampLabelMap(records: WelderStampRecord[]) {
  const map = new Map<string, string>()
  for (const record of records) {
    const naksStamp = record.naksStamp.trim()
    const internalStamp = record.internalStamp.trim()
    const label = naksStamp || internalStamp
    if (!label) continue

    if (naksStamp && !map.has(normalizeStamp(naksStamp))) map.set(normalizeStamp(naksStamp), naksStamp)
    if (internalStamp && !map.has(normalizeStamp(internalStamp))) map.set(normalizeStamp(internalStamp), label)
  }
  return map
}

function getWelderStampLabel(rawStamp: string, labels: Map<string, string>) {
  return labels.get(normalizeStamp(rawStamp)) ?? rawStamp
}

function normalizeStamp(value: string) {
  return value.trim().toUpperCase()
}

function getRowWeight(row: WeldRow, unit: StatisticsUnit) {
  if (unit === 'joints') return 1
  const value = Number(String(row.wdi ?? '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function isDateInRange(value: unknown, from: string, to: string) {
  const date = parseDateForStatistics(value)
  if (!date) return false
  return (!from || date >= from) && (!to || date <= to)
}

function parseDateForStatistics(value: unknown) {
  const parsed = parseDateLikeToIso(value)
  if (parsed) return parsed
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function getPercent(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0
}
