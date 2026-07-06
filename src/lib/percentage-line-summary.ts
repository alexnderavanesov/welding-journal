import type { WeldRow } from '@/lib/dispatcher-types'
import { parseJointChainName } from '@/lib/joint-chain'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import { hasText, isAdditionalControlValue, isCancelledControlValue, isEnabledControlValue } from '@/lib/report-value-utils'
import { calculateFinalStatus, normalizeResultStatus } from '@/lib/weld-status'

export type PercentageControlMethod = 'РК' | 'УЗК'

export type PercentageLineStampSummary = {
  key: string
  stamp: string
  lineKey: string
  projectTitle: string
  subtitleCode: string
  line: string
  percent: number
  officialJointCount: number
  baseRequiredControls: number
  additionalRequiredControls: number
  requiredControls: number
  assignedControls: number
  normalAssignedControls: number
  coveredControls: number
  completedControls: number
  rejectedPrimaryControls: number
  goodJoints: number
  rejectedJoints: number
  waitingRequestJoints: number
  waitingControlJoints: number
  assignedJointNames: string[]
  coveredJointNames: string[]
  completedJointNames: string[]
  rejectedPrimaryJointNames: string[]
  rejectedPrimaryRowIds: number[]
  missingCandidateJointNames: string[]
  excessCandidateJointNames: string[]
  missingControls: number
  excessControls: number
  fullControlRequired: boolean
}

export type PercentageLineSummary = {
  lineKey: string
  projectTitle: string
  subtitleCode: string
  line: string
  percent: number
  rows: WeldRow[]
  stamps: PercentageLineStampSummary[]
}

type LineGroup = {
  key: string
  projectTitle: string
  subtitleCode: string
  line: string
  percent: number
  rows: WeldRow[]
}

type StampAccumulator = {
  stamp: string
  rows: WeldRow[]
}

const PERCENTAGE_CONTROL_METHODS = [
  { code: 'РК' as const, enabledKey: 'hasRk' as const, resultKey: 'rkResult' as const },
  { code: 'УЗК' as const, enabledKey: 'hasUzk' as const, resultKey: 'uzkResult' as const },
]

export function buildPercentageLineSummaries(rows: WeldRow[]): PercentageLineSummary[] {
  const lineGroups = getPercentageLineGroups(rows)

  return lineGroups
    .map((group) => ({
      lineKey: group.key,
      projectTitle: group.projectTitle,
      subtitleCode: group.subtitleCode,
      line: group.line,
      percent: group.percent,
      rows: group.rows,
      stamps: buildStampSummaries(group),
    }))
    .filter((summary) => summary.stamps.length > 0)
    .sort(
      (left, right) =>
        left.projectTitle.localeCompare(right.projectTitle, 'ru', { numeric: true }) ||
        left.subtitleCode.localeCompare(right.subtitleCode, 'ru', { numeric: true }) ||
        left.line.localeCompare(right.line, 'ru', { numeric: true }),
    )
}

function getPercentageLineGroups(rows: WeldRow[]) {
  const lineRows = new Map<string, WeldRow[]>()

  for (const row of rows) {
    if (isRevisionNotActual(row) || !hasText(row.line)) continue
    const key = getLineKey(row)
    const current = lineRows.get(key) ?? []
    current.push(row)
    lineRows.set(key, current)
  }

  return Array.from(lineRows.entries()).flatMap(([key, groupedRows]) => {
    const parsedPercents = groupedRows.map((row) => parsePercent(row.weldControlPercent))
    if (!parsedPercents.every(isValidPercent)) return []

    const percents = new Set(parsedPercents)
    if (percents.size !== 1) return []

    const [percent] = Array.from(percents)
    if (percent >= 100) return []

    const sample = groupedRows[0]
    const weldedOfficialRows = groupedRows.filter((row) => !isUnofficial(row) && hasText(row.weldDate))
    if (weldedOfficialRows.length === 0) return []

    return [
      {
        key,
        projectTitle: displayValue(sample.projectTitle),
        subtitleCode: displayValue(sample.subtitleCode),
        line: displayValue(sample.line),
        percent,
        rows: weldedOfficialRows,
      } satisfies LineGroup,
    ]
  })
}

function buildStampSummaries(group: LineGroup) {
  const stampRows = new Map<string, StampAccumulator>()

  for (const row of group.rows) {
    for (const stamp of getOfficialStamps(row)) {
      const current = stampRows.get(stamp) ?? { stamp, rows: [] }
      current.rows.push(row)
      stampRows.set(stamp, current)
    }
  }

  return Array.from(stampRows.values())
    .map((entry) => buildStampSummary(group, entry))
    .sort(
      (left, right) =>
        right.missingControls - left.missingControls ||
        right.excessControls - left.excessControls ||
        left.stamp.localeCompare(right.stamp, 'ru', { numeric: true }),
    )
}

function buildStampSummary(group: LineGroup, entry: StampAccumulator): PercentageLineStampSummary {
  const officialJointCount = entry.rows.length
  const baseRequiredControls = getBaseRequiredControls(officialJointCount, group.percent)
  const rejectedPrimaryControls = entry.rows.filter(isRejectedPrimaryPercentageControl).length
  const fullControlRequired = rejectedPrimaryControls >= 4
  const additionalRequiredControls = fullControlRequired
    ? Math.max(0, officialJointCount - baseRequiredControls)
    : getAdditionalRequiredControls(rejectedPrimaryControls, group.percent)
  const requiredControls = Math.min(
    officialJointCount,
    fullControlRequired ? officialJointCount : baseRequiredControls + additionalRequiredControls,
  )
  const assignedControls = entry.rows.filter(hasAssignedPercentageControl).length
  const coveredControls = entry.rows.filter(hasCoveredPercentageControl).length
  const completedControls = entry.rows.filter(hasCompletedPercentageControl).length
  const normalAssignedControls = entry.rows.filter(hasNormalAssignedPercentageControl).length
  const statusCounters = entry.rows.reduce(
    (result, row) => {
      const status = calculateFinalStatus(row)
      if (status === 'годен') result.goodJoints += 1
      else if (status === 'не годен') result.rejectedJoints += 1
      else if (status === 'ожидает заявку') result.waitingRequestJoints += 1
      else if (status === 'ожидает НК') result.waitingControlJoints += 1
      return result
    },
    { goodJoints: 0, rejectedJoints: 0, waitingRequestJoints: 0, waitingControlJoints: 0 },
  )
  const assignedJointNames = entry.rows.filter(hasAssignedPercentageControl).map(getJointDisplayName)
  const coveredJointNames = entry.rows.filter(hasCoveredPercentageControl).map(getJointDisplayName)
  const completedJointNames = entry.rows.filter(hasCompletedPercentageControl).map(getJointDisplayName)
  const rejectedPrimaryJointNames = entry.rows.filter(isRejectedPrimaryPercentageControl).map(getJointDisplayName)
  const rejectedPrimaryRowIds = entry.rows.filter(isRejectedPrimaryPercentageControl).map((row) => row.id)
  const missingCandidateJointNames = entry.rows.filter((row) => !hasCoveredPercentageControl(row)).map(getJointDisplayName)
  const excessCandidateJointNames = entry.rows.filter(hasNormalAssignedPercentageControl).map(getJointDisplayName)

  return {
    key: `${group.key}|${normalizeText(entry.stamp)}`,
    stamp: entry.stamp,
    lineKey: group.key,
    projectTitle: group.projectTitle,
    subtitleCode: group.subtitleCode,
    line: group.line,
    percent: group.percent,
    officialJointCount,
    baseRequiredControls,
    additionalRequiredControls: Math.min(additionalRequiredControls, Math.max(0, officialJointCount - baseRequiredControls)),
    requiredControls,
    assignedControls,
    normalAssignedControls,
    coveredControls,
    completedControls,
    rejectedPrimaryControls,
    ...statusCounters,
    assignedJointNames,
    coveredJointNames,
    completedJointNames,
    rejectedPrimaryJointNames,
    rejectedPrimaryRowIds,
    missingCandidateJointNames,
    excessCandidateJointNames,
    missingControls: Math.max(0, requiredControls - coveredControls),
    excessControls: Math.max(0, normalAssignedControls - requiredControls),
    fullControlRequired,
  }
}

function getBaseRequiredControls(officialJointCount: number, percent: number) {
  if (officialJointCount <= 0) return 0
  return Math.max(1, Math.ceil((officialJointCount * percent) / 100))
}

function getAdditionalRequiredControls(rejectedPrimaryControls: number, percent: number) {
  if (rejectedPrimaryControls <= 0) return 0
  return rejectedPrimaryControls * (percent === 1 ? 1 : 2)
}

function getOfficialStamps(row: WeldRow) {
  const stamps = new Set<string>()

  for (const key of OFFICIAL_WELDER_STAMP_FIELD_KEYS) {
    const value = String(row[key] ?? '').trim()
    if (value) stamps.add(value)
  }

  return Array.from(stamps)
}

function hasAssignedPercentageControl(row: WeldRow) {
  return PERCENTAGE_CONTROL_METHODS.some(({ enabledKey }) => isEnabledControlValue(row[enabledKey]))
}

function hasNormalAssignedPercentageControl(row: WeldRow) {
  return PERCENTAGE_CONTROL_METHODS.some(({ enabledKey }) => {
    const value = row[enabledKey]
    return isEnabledControlValue(value) && !isAdditionalControlValue(value)
  })
}

function hasCoveredPercentageControl(row: WeldRow) {
  return PERCENTAGE_CONTROL_METHODS.some(
    ({ enabledKey, resultKey }) =>
      isEnabledControlValue(row[enabledKey]) || isCancelledControlValue(row[enabledKey]) || hasCompletedResult(row[resultKey]),
  )
}

function hasCompletedPercentageControl(row: WeldRow) {
  return PERCENTAGE_CONTROL_METHODS.some(({ resultKey }) => hasCompletedResult(row[resultKey]))
}

function isRejectedPrimaryPercentageControl(row: WeldRow) {
  if (parseJointChainName(String(row.joint ?? '')).segments.length > 0) return false
  return PERCENTAGE_CONTROL_METHODS.some(({ resultKey }) => {
    const result = normalizeResultStatus(row[resultKey])
    return result === 'ремонт' || result === 'вырез'
  })
}

function hasCompletedResult(value: unknown) {
  const result = normalizeResultStatus(value)
  return result === 'годен' || result === 'ремонт' || result === 'вырез'
}

function getLineKey(row: WeldRow) {
  return [normalizeText(row.projectTitle), normalizeText(row.subtitleCode), normalizeText(row.line)].join('|')
}

function parsePercent(value: unknown) {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function isValidPercent(value: number | null): value is number {
  return value !== null && value > 0
}

function isRevisionNotActual(row: WeldRow) {
  return String(row.revisionActuality ?? '').trim().toLowerCase() === 'не актуален'
}

function isUnofficial(row: WeldRow) {
  return String(row.status ?? '').trim().toLowerCase() === 'неофициальный'
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function displayValue(value: unknown) {
  return String(value ?? '').trim() || '-'
}

function getJointDisplayName(row: WeldRow) {
  return String(row.joint ?? '').trim() || `#${row.id ?? '-'}`
}
