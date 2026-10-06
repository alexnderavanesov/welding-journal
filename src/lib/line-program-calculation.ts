import type { WeldRow } from '@/lib/dispatcher-types'
import { isAngularConnectionType } from '@/lib/connection-type'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import { normalizeControlAvailabilityStorageText } from '@/lib/control-availability-values'
import { normalizeResultStatus } from '@/lib/weld-status'
import { isPreHeatTreatmentStageEnabled } from '@/lib/pre-heat-treatment-policy'
import { getControlAssignmentHistory } from './control-assignment-history'
import { buildLineProgramTopology } from './line-program-topology'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import { buildProgramRepairRequirements, REPAIR_CONTROL_FIELDS } from './line-program-repair-requirements'
import { programApprovalKey } from './program-control-approval'
import { isActiveOfficialWeld } from './control-assignment-eligibility'

export type LineProgramMethod = 'ВИК' | 'РК' | 'УЗК' | 'ПВК'
export type LineProgramDemandKind = 'common' | 'pvk'
export type LineProgramExcessAssignment = { rowId: number; method: 'РК' | 'УЗК' | 'ПВК' | 'Послойный ПВК'; duplicate: boolean }
const METHODS = [
  { code: 'ВИК', assignment: 'hasVik', result: 'vikResult' },
  { code: 'РК', assignment: 'hasRk', result: 'rkResult' },
  { code: 'УЗК', assignment: 'hasUzk', result: 'uzkResult' },
  { code: 'ПВК', assignment: 'hasPvk', result: 'pvkResult' },
] as const

export type LineProgramDemand = {
  percent: number
  baseRequired: number
  additionalRequired: number
  required: number
  actionableRequired: number
  assignedRowIds: number[]
  additionalRowIds: number[]
  cancelledRowIds: number[]
  coveredRowIds: number[]
  completedRowIds: number[]
  candidateRowIds: number[]
  excessRowIds: number[]
  duplicateAssignmentRowIds: number[]
  excessAssignments?: LineProgramExcessAssignment[]
  missing: number
}

export type LineProgramStampCalculation = {
  scope?: 'line' | 'stamp'
  stamp: string
  rowIds: number[]
  rejectedRowIds: number[]
  fullControlRequired: boolean
  common: LineProgramDemand
  pvk: LineProgramDemand
  /** Context includes historical primary sources; rowIds counts physical connections. */
  contextRowIds?: number[]
}

type RowDemand = {
  assigned: boolean
  additional: boolean
  cancelled: boolean
  covered: boolean
  completed: boolean
  candidate: boolean
  duplicate: boolean
}

export function parseLineProgramPercent(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value).trim().replace(',', '.')
  if (!text || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return null
  const percent = Number(text)
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null
}

/** Decimal half-up, including exact .5 boundaries that binary arithmetic can move. */
export function calculateLineProgramBaseRequired(count: number, percent: number | string): number {
  const parsed = parseLineProgramPercent(percent)
  if (parsed === null) throw new Error('Процент контроля должен быть числом от 0 до 100.')
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Некорректное количество стыков.')
  if (!count || !parsed) return 0
  const [mantissa, exponentText = '0'] = String(parsed).toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const exponent = Number(exponentText) - fraction.length
  const numerator = BigInt(whole + fraction) * (exponent > 0 ? 10n ** BigInt(exponent) : 1n)
  const denominator = 100n * (exponent < 0 ? 10n ** BigInt(-exponent) : 1n)
  const rounded = Number((2n * BigInt(count) * numerator + denominator) / (2n * denominator))
  return Math.min(count, Math.max(1, rounded))
}

export function getLineProgramOfficialStamps(row: WeldRow): string[] {
  const stamps = new Map<string, string>()
  for (const key of OFFICIAL_WELDER_STAMP_FIELD_KEYS) {
    const stamp = String(row[key] ?? '').trim()
    if (stamp) stamps.set(stamp.toLocaleLowerCase('ru'), stamp)
  }
  return [...stamps.values()]
}

export function isLineProgramCalculationRow(row: WeldRow) {
  return isLineProgramControlRow(row) && Boolean(String(row.weldDate ?? '').trim())
}

/** Full-line assignments can be planned before welding and official stamps exist. */
export function isLineProgramControlRow(row: WeldRow) {
  const family = String(row.connectionType ?? '').trim().toLocaleUpperCase('ru')
  return (family.startsWith('С') || family.startsWith('У')) && isActiveOfficialWeld(row)
}

export function isRejectedLineProgramResult(value: unknown) {
  const result = normalizeResultStatus(value)
  return result === 'ремонт' || result === 'вырез'
}

export function isCompletedLineProgramResult(value: unknown) {
  return normalizeResultStatus(value) === 'годен' || isRejectedLineProgramResult(value)
}

export function hasRejectedLineProgramControl(
  row: WeldRow,
  { includeDisabledStageHistory = false }: { includeDisabledStageHistory?: boolean } = {},
): boolean {
  return METHODS.some(({ result }) => isRejectedLineProgramResult(row[result])) ||
    ((includeDisabledStageHistory || isPreHeatTreatmentStageEnabled(row)) &&
      (row.preHeatTreatmentControls ?? []).some((control) =>
        METHODS.some(({ code }) => code === control.method) && isRejectedLineProgramResult(control.result))) ||
    (row.duplicateControls ?? []).some((control) =>
      METHODS.some(({ code }) => code === control.method) && isRejectedLineProgramResult(control.result))
}

export function hasOwnLineProgramMethodResult(row: WeldRow, method: LineProgramMethod) {
  const definition = METHODS.find(({ code }) => code === method)!
  return isCompletedLineProgramResult(row[definition.result]) ||
    (isPreHeatTreatmentStageEnabled(row) && (row.preHeatTreatmentControls ?? []).some((control) =>
      control.method === method && isCompletedLineProgramResult(control.result)))
}

/** Surcharge sources are primary RK/UZK failures, once per connection and stamp. */
export function hasLineProgramSurchargeResult(row: WeldRow) {
  return isRejectedLineProgramResult(row.rkResult) || isRejectedLineProgramResult(row.uzkResult) ||
    (isPreHeatTreatmentStageEnabled(row) && (row.preHeatTreatmentControls ?? []).some(control =>
      (control.method === 'РК' || control.method === 'УЗК') && isRejectedLineProgramResult(control.result))) ||
    (row.duplicateControls ?? []).some(control =>
      (control.method === 'РК' || control.method === 'УЗК') && isRejectedLineProgramResult(control.result))
}

export function getLineProgramRowDemand(row: WeldRow, kind: LineProgramDemandKind): RowDemand {
  const blocked = hasRejectedLineProgramControl(row)
  const methods = kind === 'pvk' ? METHODS.filter(({ code }) => code === 'ПВК')
    : METHODS.filter(({ code }) => code === 'РК' || code === 'УЗК')
  const states = methods.map(({ code, assignment }) => {
    const value = normalizeControlAvailabilityStorageText(row[assignment])
    const completed = hasOwnLineProgramMethodResult(row, code)
    return {
      assigned: value === 'да',
      additional: value === 'дополнительный',
      cancelled: value === 'отменен',
      // A rejected fact is still performed; a merely assigned impossible method is not.
      covered: kind === 'pvk' && blocked ? false : completed || ((value === 'да' || value === 'дополнительный') && !blocked),
      completed,
      candidate: value !== 'отменен',
    }
  })
  const layered = !blocked && kind === 'common' && isAngularConnectionType(row.connectionType) && row.layeredControlAssigned === true
  const cancelledPair = !blocked && kind === 'common' && !isAngularConnectionType(row.connectionType) && states.every((s) => s.cancelled)
  const assignedCount = states.filter((s) => s.assigned).length + Number(layered)
  const covered = states.some((s) => s.covered) || layered || cancelledPair
  return {
    assigned: assignedCount > 0,
    additional: states.some((s) => s.additional),
    cancelled: kind === 'pvk' ? states.some((s) => s.cancelled) : cancelledPair,
    covered,
    completed: states.some((s) => s.completed) || (layered && isCompletedLineProgramResult(row.pvkResult)),
    candidate: !covered && !blocked && (states.some((s) => s.candidate) ||
      (kind === 'common' && isAngularConnectionType(row.connectionType))),
    duplicate: kind === 'common' && !states.some(s => s.additional) &&
      (assignedCount > 1 || assignedCount > 0 && states.some(s => s.completed && !s.assigned)),
  }
}

/** Input is the complete line, never a page or a search-filtered subset. */
export function calculateLineProgram(
  rows: readonly WeldRow[],
  percent: number,
  pvkPercent: number,
  systemIndexSettings: SystemIndexSettings = loadSystemIndexSettings(),
  approved: ReadonlySet<string> = new Set(),
): LineProgramStampCalculation[] {
  if (parseLineProgramPercent(percent) === null || parseLineProgramPercent(pvkPercent) === null ||
    (percent === 100 ? pvkPercent < 1 : pvkPercent > percent)) {
    throw new Error('Проверьте базовый процент и процент ПВК в программе линии.')
  }
  const full = percent === 100
  const topology = buildLineProgramTopology(rows, full, systemIndexSettings)
  const uniqueRows = new Map(topology.physicalRows.filter(full ? isLineProgramControlRow : isLineProgramCalculationRow).map((row) => [row.id, row]))
  const groups = new Map<string, { stamp: string; rows: WeldRow[]; sources: WeldRow[] }>()
  const flags = new Map<number, Record<LineProgramDemandKind, RowDemand>>()
  for (const row of uniqueRows.values()) {
    flags.set(row.id, { common: getLineProgramRowDemand(row, 'common'), pvk: getLineProgramRowDemand(row, 'pvk') })
    for (const stamp of isLineProgramCalculationRow(row) ? getLineProgramOfficialStamps(row) : []) {
      const key = stamp.toLocaleLowerCase('ru')
      const group = groups.get(key) ?? { stamp, rows: [], sources: [] }
      group.rows.push(row)
      groups.set(key, group)
    }
  }
  for (const row of topology.primaryRows) {
    if (!isLineProgramCalculationRow(row) || !hasLineProgramSurchargeResult(row)) continue
    if (topology.excluded.has(row.id) && topology.excluded.get(row.id) !== 'replaced') continue
    for (const stamp of getLineProgramOfficialStamps(row)) {
      const key = stamp.toLocaleLowerCase('ru')
      const group = groups.get(key) ?? { stamp, rows: [], sources: [] }
      group.sources.push(row); groups.set(key, group)
    }
  }
  const calculations: LineProgramStampCalculation[] = (full && pvkPercent === 100 ? [] : [...groups.values()].sort((a, b) => a.stamp.localeCompare(b.stamp, 'ru'))).map((group) => {
    const rejectedRowIds = group.sources.map((row) => row.id)
    const fullControlRequired = percent > 0 && percent < 100 && rejectedRowIds.length >= 4
    const commonBase = calculateLineProgramBaseRequired(group.rows.length, percent)
    const commonRequired = percent === 0 ? 0 : fullControlRequired ? group.rows.length :
      commonBase + rejectedRowIds.length * (percent === 1 ? 1 : 2)
    return {
      stamp: group.stamp,
      rowIds: group.rows.map((row) => row.id),
      contextRowIds: [...new Set([...group.rows, ...group.sources].map(row => row.id))].sort((a, b) => a - b),
      rejectedRowIds,
      fullControlRequired,
      common: full ? buildDemand([], flags, 'common', 0, 0, 0) : buildDemand(group.rows, flags, 'common', percent, commonBase, commonRequired),
      pvk: buildDemand(group.rows, flags, 'pvk', pvkPercent,
        calculateLineProgramBaseRequired(group.rows.length, pvkPercent),
        calculateLineProgramBaseRequired(group.rows.length, pvkPercent)),
    }
  })
  if (full) {
    const lineRows = [...uniqueRows.values()]
    calculations.unshift({ scope: 'line', stamp: '', rowIds: lineRows.map(row => row.id),
      rejectedRowIds: topology.primaryRows.filter(row => isLineProgramCalculationRow(row) && hasLineProgramSurchargeResult(row)).map(row => row.id), fullControlRequired: false,
      common: buildDemand(lineRows, flags, 'common', 100, lineRows.length, lineRows.length),
      pvk: pvkPercent === 100 ? buildDemand(lineRows, flags, 'pvk', 100, lineRows.length, lineRows.length) : buildDemand([], flags, 'pvk', 0, 0, 0),
    })
  }
  // An approved combination is necessary independently of quota. Reserve its
  // coverage before choosing ordinary surplus on other joints (plan §8/14).
  const approvedCommonIds = new Set([...uniqueRows.values()].filter(row =>
    approved.has(programApprovalKey(row, 'common', true)),
  ).map(row => row.id))
  const commonExcess = identifyExcess(calculations, uniqueRows, flags, 'common', approvedCommonIds)
  const necessaryLayeredIds = new Set([...uniqueRows.values()].filter((row) =>
    row.layeredControlAssigned && isAngularConnectionType(row.connectionType) && !commonExcess.has(`${row.id}:Послойный ПВК`),
  ).map((row) => row.id))
  identifyExcess(calculations, uniqueRows, flags, 'pvk', necessaryLayeredIds)
  // Repair work has zero percentage weight, but optional ordinary assignments can
  // still be surplus. Required methods and agreed pairs are not surplus controls.
  if ([...topology.excluded.values()].includes('repair')) {
    const requirements = buildProgramRepairRequirements(topology.rows, approved, systemIndexSettings)
    const byStamp = new Map(calculations.filter(group => group.scope !== 'line').map(group => [group.stamp.toLocaleLowerCase('ru'), group]))
    const repairMembership = new Map<LineProgramStampCalculation, { context: Set<number>; common: Set<number>; pvk: Set<number> }>()
    for (const row of topology.rows) {
      if (topology.excluded.get(row.id) !== 'repair' || !isLineProgramCalculationRow(row)) continue
      const requiredMethods = new Set((row.programRepairRequirements ?? requirements.get(row.id) ?? []).map(item => item.method))
      for (const method of ['РК', 'УЗК', 'ПВК'] as const) {
        const kind = method === 'ПВК' ? 'pvk' : 'common'
        if (requiredMethods.has(method) || normalizeControlAvailabilityStorageText(row[REPAIR_CONTROL_FIELDS[method]]) !== 'да' ||
          approved.has(programApprovalKey(row, kind, true))) continue
        for (const stamp of getLineProgramOfficialStamps(row)) {
          const key = stamp.toLocaleLowerCase('ru')
          let group = byStamp.get(key)
          if (!group) {
            group = { stamp, rowIds: [], contextRowIds: [], rejectedRowIds: [], fullControlRequired: false,
              common: buildDemand([], flags, 'common', percent, 0, 0), pvk: buildDemand([], flags, 'pvk', pvkPercent, 0, 0) }
            calculations.push(group); byStamp.set(key, group)
          }
          let membership = repairMembership.get(group)
          if (!membership) {
            membership = { context: new Set(group.contextRowIds), common: new Set(group.common.excessRowIds), pvk: new Set(group.pvk.excessRowIds) }
            repairMembership.set(group, membership)
          }
          if (!membership.context.has(row.id)) { (group.contextRowIds ??= []).push(row.id); membership.context.add(row.id) }
          const demand = group[kind]
          if (!membership[kind].has(row.id)) { demand.excessRowIds.push(row.id); membership[kind].add(row.id) }
          ;(demand.excessAssignments ??= []).push({ rowId: row.id, method, duplicate: false })
        }
      }
    }
  }
  return calculations
}

function buildDemand(
  rows: WeldRow[],
  flags: Map<number, Record<LineProgramDemandKind, RowDemand>>,
  kind: LineProgramDemandKind,
  percent: number,
  baseRequired: number,
  required: number,
): LineProgramDemand {
  const ids = (field: keyof RowDemand) => rows.filter((row) => flags.get(row.id)![kind][field]).map((row) => row.id)
  const coveredRowIds = ids('covered')
  const candidateRowIds = ids('candidate')
  const actionableRequired = Math.min(required, coveredRowIds.length + candidateRowIds.length)
  return {
    percent, baseRequired, additionalRequired: required - baseRequired, required, actionableRequired,
    assignedRowIds: ids('assigned'), additionalRowIds: ids('additional'), cancelledRowIds: ids('cancelled'),
    coveredRowIds, completedRowIds: ids('completed'), candidateRowIds, excessRowIds: [],
    duplicateAssignmentRowIds: ids('duplicate'),
    missing: Math.max(0, actionableRequired - coveredRowIds.length),
  }
}

function identifyExcess(
  calculations: LineProgramStampCalculation[],
  rows: Map<number, WeldRow>,
  flags: Map<number, Record<LineProgramDemandKind, RowDemand>>,
  kind: LineProgramDemandKind,
  protectedIds: ReadonlySet<number>,
) {
  const memberships = new Map<number, number[]>()
  const remaining = calculations.map((group) => group[kind].coveredRowIds.length)
  calculations.forEach((group, index) => {
    group[kind].excessAssignments = []
    group[kind].excessRowIds = []
    group[kind].duplicateAssignmentRowIds = []
    for (const id of group.rowIds) {
      if (group[kind].percent === 0 && !group[kind].coveredRowIds.length && !group[kind].assignedRowIds.length) continue
      const owners = memberships.get(id) ?? []
      owners.push(index)
      memberships.set(id, owners)
    }
  })
  const excess = new Set<string>()
  const fields = { РК: 'hasRk', УЗК: 'hasUzk', ПВК: 'hasPvk' } as const
  const methods = (row: WeldRow): LineProgramExcessAssignment['method'][] => kind === 'pvk'
    ? normalizeControlAvailabilityStorageText(row.hasPvk) === 'да' ? ['ПВК'] : []
    : [...(['УЗК', 'РК'] as const).filter(method => normalizeControlAvailabilityStorageText(row[fields[method]]) === 'да'),
      ...(row.layeredControlAssigned && isAngularConnectionType(row.connectionType) ? ['Послойный ПВК' as const] : [])]
  const protectedMethod = (row: WeldRow, method: LineProgramExcessAssignment['method']) => method === 'Послойный ПВК' || !!getControlAssignmentHistory(row, fields[method])
  const add = (rowId: number, method: LineProgramExcessAssignment['method'], duplicate: boolean, owners: number[]) => {
    excess.add(`${rowId}:${method}`)
    for (const index of owners) {
      const demand = calculations[index][kind]
      demand.excessAssignments!.push({ rowId, method, duplicate })
      const ids = duplicate ? demand.duplicateAssignmentRowIds : demand.excessRowIds
      if (ids.at(-1) !== rowId) ids.push(rowId)
    }
  }
  const remainingMethods = new Map<number, LineProgramExcessAssignment['method'][]>()
  // First identify redundant METHODS. Keep historical facts and the layered replacement
  // before a not-yet-started ordinary assignment; an extra control never becomes excess.
  for (const [id, owners] of memberships) {
    const row = rows.get(id)!, state = flags.get(id)![kind]
    if (!state.assigned || state.additional || protectedIds.has(id)) continue
    const ordinary = methods(row).sort((a, b) => Number(protectedMethod(row, a)) - Number(protectedMethod(row, b)))
    const fixedFact = kind === 'common' && (['РК', 'УЗК'] as const).some(method =>
      normalizeControlAvailabilityStorageText(row[fields[method]]) !== 'да' && hasOwnLineProgramMethodResult(row, method))
    const duplicateCount = kind === 'common' ? Math.max(0, ordinary.length - (fixedFact ? 0 : 1)) : 0
    for (const method of ordinary.slice(0, duplicateCount)) add(id, method, true, owners)
    remainingMethods.set(id, ordinary.slice(duplicateCount))
  }
  // Prefer a removable surplus over a completed one, with deterministic joint ordering.
  // This is a safe subset, not global optimization or automatic reassignment.
  const ordered = [...remainingMethods.keys()].sort((a, b) => {
    const rank = (id: number) => Number(remainingMethods.get(id)!.every(method => protectedMethod(rows.get(id)!, method)))
    return rank(a) - rank(b) || b - a
  })
  for (const id of ordered) {
    const owners = memberships.get(id) ?? []
    const state = flags.get(id)![kind]
    // Additional coverage occupies quota places but is never a removal candidate.
    // A mixed yes + additional joint is one protected place too: removing its yes
    // would not reduce coverage. Look for a genuinely removable ordinary joint.
    const ordinary = remainingMethods.get(id)!
    if (!ordinary.length || !state.covered || !owners.length) continue
    if (!owners.every((i) => remaining[i] > calculations[i][kind].required)) continue
    for (const method of ordinary) add(id, method, false, owners)
    for (const i of owners) {
      remaining[i]--
    }
  }
  return excess
}
