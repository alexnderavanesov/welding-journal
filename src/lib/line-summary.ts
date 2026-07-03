import type { WeldRow } from '@/lib/dispatcher-types'
import { parseJointChainName } from '@/lib/joint-chain'
import type { StatisticsUnit } from '@/lib/statistics-summary'
import { calculateFinalStatusInRows } from '@/lib/weld-status'

export type LineSummaryRow = {
  key: string
  projectTitle: string
  subtitleCode: string
  line: string
  groupName: string
  category: string
  weldControlPercent: string
  total: number
  totalF: number
  totalS: number
  completed: number
  completedF: number
  completedS: number
  remaining: number
  remainingF: number
  remainingS: number
}

export type LineSummary = {
  rows: LineSummaryRow[]
  total: number
  completed: number
  remaining: number
}

type ChainRow = {
  row: WeldRow
  normalizedJoint: string
  order: number
}

export function buildLineSummary(rows: WeldRow[], unit: StatisticsUnit): LineSummary {
  const rowsForSummary = getActualLineRows(rows)
  const lineRows = new Map<string, LineSummaryRow>()

  for (const row of rowsForSummary) {
    const weight = getRowWeight(row, unit)
    if (weight <= 0) continue

    const key = getLineGroupKey(row)
    const summaryRow =
      lineRows.get(key) ??
      ({
        key,
        projectTitle: displayValue(row.projectTitle),
        subtitleCode: displayValue(row.subtitleCode),
        line: displayValue(row.line),
        groupName: displayValue(row.groupName),
        category: displayValue(row.category),
        weldControlPercent: displayValue(row.weldControlPercent),
        total: 0,
        totalF: 0,
        totalS: 0,
        completed: 0,
        completedF: 0,
        completedS: 0,
        remaining: 0,
        remainingF: 0,
        remainingS: 0,
      } satisfies LineSummaryRow)

    const jointType = getJointType(row)
    const completed = hasText(row.weldDate)
    summaryRow.total += weight
    if (jointType === 'f') summaryRow.totalF += weight
    if (jointType === 's') summaryRow.totalS += weight

    if (completed) {
      summaryRow.completed += weight
      if (jointType === 'f') summaryRow.completedF += weight
      if (jointType === 's') summaryRow.completedS += weight
    } else {
      summaryRow.remaining += weight
      if (jointType === 'f') summaryRow.remainingF += weight
      if (jointType === 's') summaryRow.remainingS += weight
    }

    lineRows.set(key, summaryRow)
  }

  const resultRows = Array.from(lineRows.values()).sort(
    (left, right) =>
      left.projectTitle.localeCompare(right.projectTitle, 'ru', { numeric: true }) ||
      left.subtitleCode.localeCompare(right.subtitleCode, 'ru', { numeric: true }) ||
      left.line.localeCompare(right.line, 'ru', { numeric: true }) ||
      left.groupName.localeCompare(right.groupName, 'ru', { numeric: true }) ||
      left.category.localeCompare(right.category, 'ru', { numeric: true }) ||
      left.weldControlPercent.localeCompare(right.weldControlPercent, 'ru', { numeric: true }),
  )

  return {
    rows: resultRows,
    total: resultRows.reduce((sum, row) => sum + row.total, 0),
    completed: resultRows.reduce((sum, row) => sum + row.completed, 0),
    remaining: resultRows.reduce((sum, row) => sum + row.remaining, 0),
  }
}

function getActualLineRows(rows: WeldRow[]) {
  const chainGroups = new Map<string, WeldRow[]>()

  for (const row of rows) {
    if (isRevisionNotActual(row)) continue
    const key = getChainKey(row)
    const current = chainGroups.get(key) ?? []
    current.push(row)
    chainGroups.set(key, current)
  }

  return Array.from(chainGroups.values()).flatMap((chainRows) => getActualRowsFromChain(chainRows, rows))
}

function getActualRowsFromChain(chainRows: WeldRow[], allRows: WeldRow[]) {
  const officialRows = chainRows.filter((row) => !isUnofficial(row.status))
  if (officialRows.length === 0) return []

  const goodOfficialRows = officialRows.filter((row) => normalizeStatus(calculateFinalStatusInRows(row, allRows)) === 'годен')
  if (goodOfficialRows.length > 0) return [pickGoodChainRepresentative(goodOfficialRows)]

  const prepared = officialRows.map((row) => ({
    row,
    normalizedJoint: normalizeJoint(row.joint),
    order: getJointOrder(row.joint),
  }))

  return prepared
    .filter((candidate) => !prepared.some((other) => isStrictChainSuccessor(candidate, other)))
    .map((candidate) => candidate.row)
}

function pickGoodChainRepresentative(rows: WeldRow[]) {
  return [...rows].sort(
    (left, right) =>
      getComparableDate(right).localeCompare(getComparableDate(left), 'ru', { numeric: true }) ||
      getJointOrder(right.joint) - getJointOrder(left.joint) ||
      Number(right.id ?? 0) - Number(left.id ?? 0),
  )[0]
}

function isStrictChainSuccessor(candidate: ChainRow, other: ChainRow) {
  if (candidate.row.id === other.row.id) return false
  if (candidate.normalizedJoint === other.normalizedJoint) {
    return getComparableDate(other.row) > getComparableDate(candidate.row)
  }
  if (!other.normalizedJoint.startsWith(candidate.normalizedJoint)) return false
  return other.order > candidate.order
}

function getLineGroupKey(row: WeldRow) {
  return [
    normalizeText(row.projectTitle),
    normalizeText(row.subtitleCode),
    normalizeText(row.line),
    normalizeText(row.groupName),
    normalizeText(row.category),
    normalizeText(row.weldControlPercent),
  ].join('|')
}

function getChainKey(row: WeldRow) {
  const parsed = parseJointChainName(String(row.joint ?? ''))
  return [
    normalizeText(row.projectTitle),
    normalizeText(row.subtitleCode),
    normalizeText(row.line),
    normalizeText(parsed.base),
  ].join('|')
}

function getJointType(row: WeldRow): 'f' | 's' | null {
  const base = parseJointChainName(String(row.joint ?? '')).base.trim().toUpperCase()
  if (base.startsWith('F')) return 'f'
  if (base.startsWith('S')) return 's'
  return null
}

function getJointOrder(value: unknown) {
  return parseJointChainName(String(value ?? '')).segments.reduce((total, segment, index) => {
    const suffixOrder = segment.suffix === 'R' ? 1 : segment.suffix === 'W' ? 2 : segment.suffix === 'Y' ? 3 : 4
    return total + suffixOrder * 1000 ** (10 - index) + segment.index
  }, 0)
}

function getComparableDate(row: WeldRow) {
  const date = String(row.weldDate ?? '').trim()
  return `${date || '9999-99-99'}|${String(row.id ?? '').padStart(10, '0')}`
}

function getRowWeight(row: WeldRow, unit: StatisticsUnit) {
  if (unit === 'joints') return 1
  const value = Number(String(row.wdi ?? '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function isRevisionNotActual(row: WeldRow) {
  return String(row.revisionActuality ?? '').trim().toLowerCase() === 'не актуален'
}

function isUnofficial(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'неофициальный'
}

function normalizeStatus(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeJoint(value: unknown) {
  return String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function displayValue(value: unknown) {
  return String(value ?? '').trim() || '-'
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}
