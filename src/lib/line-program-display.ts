import { countProgramRemovalHints, type ProgramRemovalHints } from './line-program-excess'
import type { WeldRow } from './dispatcher-types'
import { getLineProgramOfficialStamps, getLineProgramRowDemand, isLineProgramControlRow, type LineProgramDemand, type LineProgramStampCalculation } from './line-program-calculation'
import { compactLineProgramDemand } from './line-program-overview'
import { getProgramDemandAccounting, type ProgramCoverageAccounting } from './line-program-accounting'
import { calculateFinalStatus } from './weld-status'
import { buildLineProgramTopology } from './line-program-topology'
import { countProgramRows } from './line-program-row-filters'

const idFields = ['assignedRowIds', 'additionalRowIds', 'cancelledRowIds', 'coveredRowIds', 'completedRowIds', 'candidateRowIds', 'excessRowIds', 'duplicateAssignmentRowIds'] as const
const emptyDemand = (percent: number): LineProgramDemand => ({ percent, baseRequired: 0, additionalRequired: 0, required: 0, actionableRequired: 0, missing: 0,
  assignedRowIds: [], additionalRowIds: [], cancelledRowIds: [], coveredRowIds: [], completedRowIds: [], candidateRowIds: [], excessRowIds: [], duplicateAssignmentRowIds: [] })

/** Planning includes unwelded/unstamped joints; percentage quotas still use the original calculation. */
export function buildLineProgramDisplay(rows: readonly WeldRow[], groups: readonly LineProgramStampCalculation[], percent: number, pvkPercent: number, hints: ProgramRemovalHints = new Map()) {
  const uniqueRows = [...new Map(rows.map(row => [row.id, row])).values()]
  const eligible = buildLineProgramTopology(uniqueRows, percent === 100).physicalRows.filter(isLineProgramControlRow)
  const states = new Map(uniqueRows.map(row => [row.id, calculateFinalStatus(row)]))
  const good = new Set(uniqueRows.filter(row => states.get(row.id) === 'годен').map(row => row.id))
  const rejected = new Set(uniqueRows.filter(row => states.get(row.id)?.startsWith('не годен')).map(row => row.id))
  const errors = new Set(uniqueRows.filter(row => states.get(row.id) === 'ошибка').map(row => row.id))
  const flags = new Map(uniqueRows.map(row => [row.id, { common: getLineProgramRowDemand(row, 'common'), pvk: getLineProgramRowDemand(row, 'pvk') }]))
  const physicalIds = new Set(eligible.map(row => row.id))
  const state = (members: readonly WeldRow[]) => {
    const physical = members.filter(row => physicalIds.has(row.id))
    // Present the existing final statuses; labels alone never prove that control has started.
    const incompleteStages = { welding: 0, request: 0, control: 0, other: 0 }
    for (const row of physical) {
      if (good.has(row.id) || rejected.has(row.id) || errors.has(row.id)) continue
      const status = states.get(row.id)
      const stage = status === 'ожидает сварку' ? 'welding' : status === 'ожидает заявку' ? 'request' : status === 'ожидает НК' ? 'control' : 'other'
      incompleteStages[stage]++
    }
    return { reducible: countProgramRemovalHints(hints, members.map(row => row.id)), count: physical.length, journalRows: members.length,
      good: physical.filter(row => good.has(row.id)).length, rejected: physical.filter(row => rejected.has(row.id)).length,
      errors: physical.filter(row => errors.has(row.id)).length, waitingWeld: physical.filter(row => !row.weldDate).length, incompleteStages }
  }
  const assignments = (members: readonly WeldRow[], kind: 'common' | 'pvk') => getProgramDemandAccounting({
    assignedRowIds: members.filter(row => flags.get(row.id)?.[kind].assigned).map(row => row.id),
    additionalRowIds: members.filter(row => flags.get(row.id)?.[kind].additional).map(row => row.id), coveredRowIds: [],
  }).assignments
  const reducible = (members: readonly WeldRow[], kind: 'common' | 'pvk') => members.reduce((sum, row) => sum + [...(hints.get(row.id)?.keys() ?? [])].filter(method => kind === 'pvk' ? method === 'ПВК' : method !== 'ПВК').length, 0)
  const lineGroup = groups.find(group => group.scope === 'line')
  const stampGroups = new Map(groups.filter(group => group.scope !== 'line').map(group => [group.stamp.toLocaleLowerCase('ru'), group]))
  const membership = (kind: 'common' | 'pvk') => Object.fromEntries(idFields.map(field => [field, new Set(lineGroup?.[kind][field])])) as Record<typeof idFields[number], Set<number>>
  const lineIds = { common: membership('common'), pvk: membership('pvk') }
  const lineExcess = new Map<string, NonNullable<LineProgramDemand['excessAssignments']>>()
  for (const kind of ['common', 'pvk'] as const) for (const entry of lineGroup?.[kind].excessAssignments ?? []) {
    const key = `${kind}:${entry.rowId}`, bucket = lineExcess.get(key) ?? []
    bucket.push(entry); lineExcess.set(key, bucket)
  }
  const members = new Map<string, { stamp: string; rows: WeldRow[] }>()
  const unstamped: WeldRow[] = []
  const extraIds = new Set(groups.flatMap(group => [...group.common.excessRowIds, ...group.pvk.excessRowIds]))
  for (const row of uniqueRows.filter(row => physicalIds.has(row.id) || extraIds.has(row.id))) {
    const stamps = getLineProgramOfficialStamps(row)
    if (!stamps.length) unstamped.push(row)
    for (const stamp of stamps) {
      const key = stamp.toLocaleLowerCase('ru'), entry = members.get(key) ?? { stamp, rows: [] }
      entry.rows.push(row); members.set(key, entry)
    }
  }
  const project = (rows: WeldRow[], kind: 'common' | 'pvk', stamp?: string) => {
    const p = kind === 'common' ? percent : pvkPercent
    let demand = stampGroups.get(stamp?.toLocaleLowerCase('ru') ?? '')?.[kind] ?? emptyDemand(p)
    if (p === 100 && lineGroup) {
      const ids = rows.filter(row => physicalIds.has(row.id)).map(row => row.id)
      const fields = Object.fromEntries(idFields.map(field => [field, ids.filter(id => lineIds[kind][field].has(id))])) as Pick<LineProgramDemand, typeof idFields[number]>
      const repairExcess = demand.excessAssignments?.filter(entry => !physicalIds.has(entry.rowId)) ?? []
      fields.excessRowIds.push(...new Set(repairExcess.filter(entry => !entry.duplicate).map(entry => entry.rowId)))
      demand = { ...fields, percent: p, required: ids.length, baseRequired: ids.length, additionalRequired: 0,
        excessAssignments: [...ids.flatMap(id => lineExcess.get(`${kind}:${id}`) ?? []), ...repairExcess],
        actionableRequired: Math.min(ids.length, fields.coveredRowIds.length + fields.candidateRowIds.length),
        missing: Math.min(Math.max(0, ids.length - fields.coveredRowIds.length), fields.candidateRowIds.length) }
    }
    const compact = compactLineProgramDemand(demand), assigned = assignments(rows, kind)
    return { ...compact, reducible: reducible(rows, kind), assigned: assigned.total, accounting: { ...compact.accounting, assignments: assigned } }
  }
  const stampRows = [...members.values()].map(({ stamp, rows }) => ({ ...state(rows), stamp, scope: 'stamp' as const,
    fullControlRequired: stampGroups.get(stamp.toLocaleLowerCase('ru'))?.fullControlRequired ?? false,
    common: project(rows, 'common', stamp), pvk: project(rows, 'pvk', stamp) }))
  const unassigned = unstamped.length ? { ...state(unstamped), stamp: '', scope: 'unassigned' as const, fullControlRequired: false,
    common: project(unstamped, 'common'), pvk: project(unstamped, 'pvk') } : null
  const aggregate = (kind: 'common' | 'pvk') => {
    const demands = groups.map(group => group[kind])
    const assigned = assignments(eligible, kind)
    const coverage = demands.reduce((total, demand) => {
      const counts = getProgramDemandAccounting(demand).coverage
      for (const key of ['yesOnly', 'additionalOnly', 'mixed', 'other', 'total'] as const) total[key] += counts[key]
      return total
    }, { yesOnly: 0, additionalOnly: 0, mixed: 0, other: 0, total: 0 } satisfies ProgramCoverageAccounting)
    const ids = (field: typeof idFields[number]) => new Set(demands.flatMap(d => d[field])).size
    const sum = (field: 'required' | 'baseRequired' | 'additionalRequired' | 'actionableRequired' | 'missing') => demands.reduce((total, d) => total + d[field], 0)
    return { percent: kind === 'common' ? percent : pvkPercent, reducible: reducible(uniqueRows, kind), required: sum('required'), baseRequired: sum('baseRequired'), additionalRequired: sum('additionalRequired'), actionableRequired: sum('actionableRequired'), missing: sum('missing'),
      // Coverage is quota places, assignments are distinct physical joints (including plans).
      covered: demands.reduce((total, d) => total + Math.min(d.required, d.coveredRowIds.length), 0),
      assigned: assigned.total, accounting: { assignments: assigned, coverage }, additional: ids('additionalRowIds'), cancelled: ids('cancelledRowIds'), completed: ids('completedRowIds'), candidates: ids('candidateRowIds'),
      excess: groups.some(group => group[kind].excessAssignments) ? new Set(demands.flatMap(d => (d.excessAssignments ?? []).filter(e => !e.duplicate).map(e => `${e.rowId}:${e.method}`))).size : ids('excessRowIds'),
      duplicateAssignments: groups.some(group => group[kind].excessAssignments) ? new Set(demands.flatMap(d => (d.excessAssignments ?? []).filter(e => e.duplicate).map(e => `${e.rowId}:${e.method}`))).size : ids('duplicateAssignmentRowIds') }
  }
  return { recordCounts: countProgramRows(uniqueRows), stampRows, unassigned, summary: { ...state(uniqueRows), stamp: '', scope: 'line' as const, fullControlRequired: false, common: aggregate('common'), pvk: aggregate('pvk') } }
}
