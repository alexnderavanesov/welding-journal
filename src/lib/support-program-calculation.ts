import type { WeldRow } from './dispatcher-types'
import { isTConnectionType } from './connection-type'
import { isActiveOfficialWeld } from './control-assignment-eligibility'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'
import { captureProgramChainStates } from './line-program-chain-state'
import { buildLineProgramTopology } from './line-program-topology'
import { getControlAssignmentRemovalHistory } from './control-assignment-history'
import { buildProgramRepairRequirements } from './line-program-repair-requirements'
import { getLineProgramOfficialStamps, hasOwnLineProgramMethodResult, parseLineProgramPercent, type LineProgramDemand, type LineProgramStampCalculation } from './line-program-calculation'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'

export function calculateSupportRequired(count: number, percent: number | string) {
  const parsed = parseLineProgramPercent(percent)
  if (parsed == null || parsed < 0.5) throw new Error('Процент контроля опор должен быть от 0,5 до 100.')
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Некорректное количество опор.')
  if (!count) return 0
  const [mantissa, exponentText = '0'] = String(parsed).toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const exponent = Number(exponentText) - fraction.length
  const numerator = BigInt(whole + fraction) * (exponent > 0 ? 10n ** BigInt(exponent) : 1n)
  const denominator = 100n * (exponent < 0 ? 10n ** BigInt(-exponent) : 1n)
  return Number((BigInt(count) * numerator + denominator - 1n) / denominator)
}

/** Stable physical identities, including moved/renamed repairs. No grouping by a suffix alone. */
export function buildSupportProgramContext(input: readonly WeldRow[], settings: SystemIndexSettings = loadSystemIndexSettings()) {
  const supports = input.filter(row => isTConnectionType(row.connectionType))
  const states = captureProgramChainStates(supports, settings)
  const rows = supports.map(row => ({ ...row, programChainState: states.get(row.id) }))
  const topology = buildLineProgramTopology(rows, true, settings)
  const roots = topology.physicalRows.filter(isActiveOfficialWeld)
  const rootIds = new Set(roots.map(row => row.id))
  const members = new Map<number, WeldRow[]>()
  for (const row of rows) {
    if (!isActiveOfficialWeld(row)) continue
    const rootId = row.programChainState?.physicalRootId ?? row.id
    if (!rootIds.has(rootId)) continue
    const group = members.get(rootId) ?? []
    group.push(row); members.set(rootId, group)
  }
  return { rows, roots, members, topology }
}

export function getSupportChainMethodState(members: readonly WeldRow[], kind: 'common' | 'pvk') {
  const field = kind === 'common' ? 'hasUzk' : 'hasPvk'
  const method = kind === 'common' ? 'УЗК' : 'ПВК'
  const values = members.map(row => normalizeControlAvailabilityStorageText(row[field]))
  const assigned = values.includes('да')
  const additional = values.includes('дополнительный')
  const completed = members.some(row => hasOwnLineProgramMethodResult(row, method))
  const covered = assigned || additional || completed
  // Cancellation of an unperformed method excludes availability, never a performed fact.
  const cancelled = !covered && values.includes('отменен')
  return { assigned, additional, completed, covered, cancelled, candidate: !covered && !cancelled }
}

/** Independent per-stamp norms; repair history contributes one place to its original physical OP. */
export function calculateSupportProgramDetails(input: readonly WeldRow[], uzkPercent: number, pvkPercent: number, settings: SystemIndexSettings = loadSystemIndexSettings()) {
  calculateSupportRequired(0, uzkPercent); calculateSupportRequired(0, pvkPercent)
  const context = buildSupportProgramContext(input, settings)
  const repairRequirements = buildProgramRepairRequirements(context.rows, new Set(), settings)
  const calculationRows = context.roots.filter(row => Boolean(row.weldDate))
  const byStamp = new Map<string, { stamp: string; roots: WeldRow[] }>()
  for (const row of calculationRows) for (const stamp of getLineProgramOfficialStamps(row)) {
    const key = stamp.toLocaleLowerCase('ru'), group = byStamp.get(key) ?? { stamp, roots: [] }
    group.roots.push(row); byStamp.set(key, group)
  }
  const buildDemand = (roots: WeldRow[], kind: 'common' | 'pvk', percent: number): LineProgramDemand => {
    const states = new Map(roots.map(root => [root.id, getSupportChainMethodState(context.members.get(root.id) ?? [root], kind)]))
    const ids = (field: keyof ReturnType<typeof getSupportChainMethodState>) => roots.filter(row => states.get(row.id)![field]).map(row => row.id)
    const required = calculateSupportRequired(roots.length, percent)
    const coveredRowIds = ids('covered'), candidateRowIds = ids('candidate'), cancelledRowIds = ids('cancelled')
    const actionableRequired = Math.min(required, roots.length - cancelledRowIds.length)
    const method = kind === 'common' ? 'УЗК' : 'ПВК'
    const field = kind === 'common' ? 'hasUzk' : 'hasPvk'
    const members = (root: WeldRow) => context.members.get(root.id) ?? [root]
    const mandatory = (row: WeldRow) => (row.programRepairRequirements ?? repairRequirements.get(row.id))?.some(item => item.method === method)
    const normal = (root: WeldRow) => members(root).filter(row => normalizeControlAvailabilityStorageText(row[field]) === 'да')
    // One representative retains this physical credit. Other optional member
    // assignments do not create extra places, even when the repairer changed.
    const representatives = new Map(roots.map(root => {
      const ordinary = normal(root)
      const factual = ordinary.find(row => hasOwnLineProgramMethodResult(row, method))
      const requiredRepair = ordinary.find(mandatory)
      const coveredWithoutOrdinary = states.get(root.id)!.completed || states.get(root.id)!.additional
      return [root.id, factual ?? requiredRepair ?? (coveredWithoutOrdinary ? undefined : ordinary[0])]
    }))
    const excess = new Map<number, { rowId: number; method: 'УЗК' | 'ПВК'; duplicate: boolean }>()
    const add = (row: WeldRow) => { if (!mandatory(row)) excess.set(row.id, { rowId: row.id, method, duplicate: false }) }
    for (const root of roots) for (const row of normal(root)) if (row !== representatives.get(root.id)) add(row)
    const ordinaryCovered = roots.filter(root => states.get(root.id)!.covered && !states.get(root.id)!.additional)
    const surplus = Math.max(0, ordinaryCovered.length - actionableRequired)
    const surplusRoots = ordinaryCovered.filter(root => {
      const row = representatives.get(root.id)
      return row && !mandatory(row)
    }).sort((a, b) => {
      const protectedRoot = (root: WeldRow) => !!getControlAssignmentRemovalHistory(representatives.get(root.id)!, field)
      return Number(protectedRoot(a)) - Number(protectedRoot(b)) || b.id - a.id
    })
    for (const root of surplusRoots.slice(0, surplus)) add(representatives.get(root.id)!)
    const excessAssignments = [...excess.values()]
    return { percent, baseRequired: required, additionalRequired: 0, required, actionableRequired,
      assignedRowIds: ids('assigned'), additionalRowIds: ids('additional'), cancelledRowIds, coveredRowIds,
      completedRowIds: ids('completed'), candidateRowIds, excessRowIds: excessAssignments.map(item => item.rowId),
      excessAssignments, duplicateAssignmentRowIds: [], missing: Math.max(0, actionableRequired - coveredRowIds.length) }
  }
  const calculations: LineProgramStampCalculation[] = [...byStamp.values()].map(({ stamp, roots }) => ({
    support: true, stamp, scope: 'stamp', rowIds: roots.map(row => row.id),
    contextRowIds: roots.flatMap(row => (context.members.get(row.id) ?? [row]).map(member => member.id)),
    rejectedRowIds: [], fullControlRequired: false,
    common: buildDemand(roots, 'common', uzkPercent), pvk: buildDemand(roots, 'pvk', pvkPercent),
  }))
  return { calculations, calculationRows }
}
