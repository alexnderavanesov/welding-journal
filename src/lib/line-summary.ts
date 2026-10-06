import type { WeldRow } from '@/lib/dispatcher-types'
import { parseJointChainName } from '@/lib/joint-chain'
import { getConfiguredBaseJointType, type SystemIndexSettings } from '@/lib/system-index-settings'
import type { StatisticsUnit } from '@/lib/statistics-summary'
import { encodeIdentityKey } from '@/lib/identity-key'
import { captureProgramChainStates } from '@/lib/line-program-chain-state'
import { buildLineProgramTopology, programJointIdentity } from '@/lib/line-program-topology'
import { isActiveOfficialWeld } from '@/lib/control-assignment-eligibility'
import { compareJointChainRows } from '@/lib/repeated-joint-row-utils'

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
  rowIds: number[]
  completedRowIds: number[]
  remainingRowIds: number[]
}

export type LineSummary = {
  rows: LineSummaryRow[]
  total: number
  completed: number
  remaining: number
}

export function buildLineSummary(rows: WeldRow[], unit: StatisticsUnit, systemIndexSettings?: SystemIndexSettings,
  includeRow: (row: WeldRow) => boolean = () => true,
): LineSummary {
  const rowsForSummary = getActualLineRows(rows, systemIndexSettings)
  const lineRows = new Map<string, LineSummaryRow>()

  for (const row of rowsForSummary) {
    if (!includeRow(row)) continue // Display filters must not remove physical history before calculation.
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
        rowIds: [],
        completedRowIds: [],
        remainingRowIds: [],
      } satisfies LineSummaryRow)

    const jointType = getJointType(row, systemIndexSettings)
    const completed = hasText(row.weldDate)
    summaryRow.rowIds.push(row.id)
    summaryRow.total += weight
    if (jointType === 'f') summaryRow.totalF += weight
    if (jointType === 's') summaryRow.totalS += weight

    if (completed) {
      summaryRow.completedRowIds.push(row.id)
      summaryRow.completed += weight
      if (jointType === 'f') summaryRow.completedF += weight
      if (jointType === 's') summaryRow.completedS += weight
    } else {
      summaryRow.remainingRowIds.push(row.id)
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

function getActualLineRows(
  input: WeldRow[],
  systemIndexSettings?: SystemIndexSettings,
) {
  const states = input.every(row => row.programChainState)
    ? new Map(input.map(row => [row.id, row.programChainState!]))
    : captureProgramChainStates(input, systemIndexSettings)
  const lines = new Map<string, WeldRow[]>()
  for (const source of input) {
    const row = source.programChainState === states.get(source.id)
      ? source : { ...source, programChainState: states.get(source.id)! }
    const key = programJointIdentity(row, '')
    const line = lines.get(key) ?? []
    line.push(row); lines.set(key, line)
  }
  const representatives: WeldRow[] = []
  for (const rows of lines.values()) {
    // Preserve excluded history until physical replacement has been resolved.
    // NDT goodness is deliberately not an input to welding-by-date progress.
    // Welding progress includes planned connections, unlike the percentage
    // sample restricted to welded joints. Keep planned coil pairs in its scope.
    const topology = buildLineProgramTopology(rows, true, systemIndexSettings)
    const current = new Map(topology.physicalRows.filter(isActiveOfficialWeld).map(row => [row.id, row]))
    const depths = getRepairDepths(rows)
    for (const row of rows) {
      if (!isActiveOfficialWeld(row)) continue
      const rootId = row.programChainState?.physicalRootId
      const previous = rootId == null ? undefined : current.get(rootId)
      if (!previous || previous === row) continue // Orphan/moved repairs never create physical volume.
      const difference = depths.get(row.id)! - depths.get(previous.id)!
      if (difference > 0 || difference === 0 && compareJointChainRows(row, previous, systemIndexSettings) > 0) {
        current.set(rootId!, row)
      }
    }
    representatives.push(...current.values())
  }
  return representatives
}

/** Stable links, not names/dates, order repairs. Memoized and iterative: no
 * recursive stack or repeated ancestor walk for long imported histories.
 * Broken/competing chains remain dispatcher issues, never extra connections.
 */
function getRepairDepths(rows: WeldRow[]) {
  const byId = new Map(rows.map(row => [row.id, row]))
  const depths = new Map<number, number>()
  for (const row of rows) {
    if (depths.has(row.id)) continue
    const path: WeldRow[] = [], seen = new Set<number>()
    let current: WeldRow | undefined = row
    while (current && !depths.has(current.id) && !seen.has(current.id)) {
      if (current.programChainState?.kind !== 'repair') { depths.set(current.id, 0); break }
      seen.add(current.id); path.push(current)
      const source = byId.get(current.programChainState.sourceRowId ?? -1)
      current = source?.programChainState?.physicalRootId === current.programChainState.physicalRootId ? source : undefined
    }
    let depth = current ? depths.get(current.id) ?? 0 : 0
    for (let i = path.length - 1; i >= 0; i--) depths.set(path[i].id, ++depth)
  }
  return depths
}

function getLineGroupKey(row: WeldRow) {
  return encodeIdentityKey([
    normalizeText(row.projectTitle),
    normalizeText(row.subtitleCode),
    normalizeText(row.line),
    normalizeText(row.groupName),
    normalizeText(row.category),
    normalizeText(row.weldControlPercent),
  ])
}

function getJointType(row: WeldRow, systemIndexSettings?: SystemIndexSettings): 'f' | 's' | null {
  const base = parseJointChainName(String(row.joint ?? ''), systemIndexSettings).base.trim().toUpperCase()
  return getConfiguredBaseJointType(base, systemIndexSettings)
}

function getRowWeight(row: WeldRow, unit: StatisticsUnit) {
  if (unit === 'joints') return 1
  const value = Number(String(row.wdi ?? '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
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
