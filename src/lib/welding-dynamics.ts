import { formatDateInputValue, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { StatisticsUnit } from '@/lib/statistics-summary'

export type WeldingDynamicsUnit = 'day' | 'week' | 'month' | 'quarter' | 'year'

export type WeldingDynamicsBucket = {
  key: string
  label: string
  shortLabel: string
  value: number
  weldedJoints: number
  wdi: number
  welderCount: number
}

export type WeldingDynamicsSummary = {
  bucketUnit: WeldingDynamicsUnit
  bucketUnitLabel: string
  buckets: WeldingDynamicsBucket[]
  periodDays: number
  totalValue: number
  totalWelders: number
  peakValue: number
  peakWelders: number
}

const FACTUAL_STAMP_KEYS = [
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
] as const satisfies readonly (keyof WeldRow)[]

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function buildWeldingDynamics(
  rows: readonly WeldRow[],
  from: string,
  to: string,
  unit: StatisticsUnit,
): WeldingDynamicsSummary {
  const datedRows = rows
    .map((row) => ({ row, date: parseDateLikeToIso(row.weldDate) }))
    .filter((item): item is { row: WeldRow; date: string } => Boolean(item.date))
    .sort((a, b) => a.date.localeCompare(b.date))

  const firstDate = from || datedRows[0]?.date || ''
  const lastDate = to || datedRows.at(-1)?.date || firstDate
  if (!firstDate || !lastDate) return createEmptyDynamics('day')

  const startIso = firstDate <= lastDate ? firstDate : lastDate
  const endIso = firstDate <= lastDate ? lastDate : firstDate
  const periodDays = getDaysBetween(parseIsoDate(startIso), parseIsoDate(endIso)) + 1
  const bucketUnit = chooseWeldingDynamicsUnit(startIso, endIso)
  const bucketUnitLabel = getBucketUnitLabel(bucketUnit)
  const bucketMap = new Map<string, WeldingDynamicsBucket>()
  for (const bucket of createBuckets(startIso, endIso, bucketUnit)) {
    bucketMap.set(bucket.key, bucket)
  }

  const weldersByBucket = new Map<string, Set<string>>()
  const allWelders = new Set<string>()

  for (const { row, date } of datedRows) {
    if (date < startIso || date > endIso) continue
    const bucketKey = getBucketKey(date, startIso, bucketUnit)
    const bucket = bucketMap.get(bucketKey)
    if (!bucket) continue

    bucket.weldedJoints += 1
    bucket.wdi += getWdiValue(row)
    bucket.value = unit === 'wdi' ? bucket.wdi : bucket.weldedJoints

    const bucketWelders = weldersByBucket.get(bucketKey) ?? new Set<string>()
    for (const stamp of getFactualStamps(row)) {
      bucketWelders.add(stamp)
      allWelders.add(stamp)
    }
    weldersByBucket.set(bucketKey, bucketWelders)
    bucket.welderCount = bucketWelders.size
  }

  const buckets = Array.from(bucketMap.values())
  return {
    bucketUnit,
    bucketUnitLabel,
    buckets,
    periodDays,
    totalValue: buckets.reduce((total, bucket) => total + bucket.value, 0),
    totalWelders: allWelders.size,
    peakValue: Math.max(0, ...buckets.map((bucket) => bucket.value)),
    peakWelders: Math.max(0, ...buckets.map((bucket) => bucket.welderCount)),
  }
}

function chooseWeldingDynamicsUnit(from: string, to: string): WeldingDynamicsUnit {
  const days = getDaysBetween(parseIsoDate(from), parseIsoDate(to)) + 1
  if (days <= 45) return 'day'
  if (days <= 180) return 'week'
  if (days <= 900) return 'month'
  if (days <= 1825) return 'quarter'
  return 'year'
}

function createEmptyDynamics(bucketUnit: WeldingDynamicsUnit): WeldingDynamicsSummary {
  return {
    bucketUnit,
    bucketUnitLabel: getBucketUnitLabel(bucketUnit),
    buckets: [],
    periodDays: 0,
    totalValue: 0,
    totalWelders: 0,
    peakValue: 0,
    peakWelders: 0,
  }
}

function createBuckets(from: string, to: string, unit: WeldingDynamicsUnit) {
  const buckets: WeldingDynamicsBucket[] = []
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)

  if (unit === 'day') {
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const iso = formatDateInputValue(date)
      buckets.push(createBucket(iso, formatDayLabel(iso), formatShortDayLabel(iso)))
    }
    return buckets
  }

  if (unit === 'week') {
    for (let date = start; date <= end; date = addDays(date, 7)) {
      const bucketEnd = minDate(addDays(date, 6), end)
      const startIso = formatDateInputValue(date)
      const endIso = formatDateInputValue(bucketEnd)
      buckets.push(createBucket(startIso, `${formatDayLabel(startIso)} - ${formatDayLabel(endIso)}`, formatShortDayLabel(startIso)))
    }
    return buckets
  }

  if (unit === 'month') {
    for (let date = startOfMonth(start); date <= end; date = addMonths(date, 1)) {
      const iso = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
      buckets.push(createBucket(iso, formatMonthLabel(date), formatMonthLabel(date)))
    }
    return buckets
  }

  if (unit === 'quarter') {
    for (let date = startOfQuarter(start); date <= end; date = addMonths(date, 3)) {
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1
      const iso = `${date.getUTCFullYear()}-Q${quarter}`
      buckets.push(createBucket(iso, `${quarter} кв. ${date.getUTCFullYear()}`, `${quarter} кв.`))
    }
    return buckets
  }

  for (let date = startOfYear(start); date <= end; date = addYears(date, 1)) {
    const iso = String(date.getUTCFullYear())
    buckets.push(createBucket(iso, iso, iso))
  }
  return buckets
}

function createBucket(key: string, label: string, shortLabel: string): WeldingDynamicsBucket {
  return {
    key,
    label,
    shortLabel,
    value: 0,
    weldedJoints: 0,
    wdi: 0,
    welderCount: 0,
  }
}

function getBucketKey(date: string, from: string, unit: WeldingDynamicsUnit) {
  if (unit === 'day') return date
  const parsed = parseIsoDate(date)
  if (unit === 'week') {
    const offset = Math.floor(getDaysBetween(parseIsoDate(from), parsed) / 7) * 7
    return formatDateInputValue(addDays(parseIsoDate(from), offset))
  }
  if (unit === 'month') return date.slice(0, 7)
  if (unit === 'quarter') {
    const quarter = Math.floor(parsed.getUTCMonth() / 3) + 1
    return `${parsed.getUTCFullYear()}-Q${quarter}`
  }
  return String(parsed.getUTCFullYear())
}

function getFactualStamps(row: WeldRow) {
  const stamps = new Set<string>()
  for (const key of FACTUAL_STAMP_KEYS) {
    const value = String(row[key] ?? '').trim()
    if (value) stamps.add(value)
  }
  return stamps
}

function getWdiValue(row: WeldRow) {
  const value = Number(String(row.wdi ?? '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function getBucketUnitLabel(unit: WeldingDynamicsUnit) {
  if (unit === 'day') return 'день'
  if (unit === 'week') return 'неделя'
  if (unit === 'month') return 'месяц'
  if (unit === 'quarter') return 'квартал'
  return 'год'
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1))
}

function getDaysBetween(from: Date, to: Date) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY))
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

function addYears(date: Date, years: number) {
  const next = new Date(date)
  next.setUTCFullYear(next.getUTCFullYear() + years)
  return next
}

function minDate(a: Date, b: Date) {
  return a.getTime() <= b.getTime() ? a : b
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function startOfQuarter(date: Date) {
  const month = Math.floor(date.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(date.getUTCFullYear(), month, 1))
}

function startOfYear(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
}

function formatDayLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}.${month}`
}

function formatShortDayLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}.${month}`
}

function formatMonthLabel(date: Date) {
  return `${pad(date.getUTCMonth() + 1)}.${String(date.getUTCFullYear()).slice(2)}`
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}
