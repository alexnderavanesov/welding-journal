import type { WeldRow } from './dispatcher-types'
import { getLineProgramOfficialStamps, getLineProgramRowDemand, isLineProgramControlRow, type LineProgramStampCalculation } from './line-program-calculation'
import { partitionProgramExcess, getProgramRemovalHints } from './line-program-excess'
import { programAssignment, programExcessEntries, PROGRAM_METHODS, type ProgramSelection } from './line-program-workspace'
import { programApprovalKey } from './program-control-approval'
import { programRowSearchText, programRowStatus } from './line-program-row-filters'

export const programScopeKey = (scope: Pick<ProgramSelection, 'stamp' | 'unassigned'>) => scope.unassigned ? 'unassigned:' : scope.stamp ? `stamp:${scope.stamp.toLocaleLowerCase('ru')}` : 'all:'

/** Index once per data refresh, not one full-line scan/query per expanded welder. */
export function createProgramRowSelector(rows: WeldRow[], calculations: readonly LineProgramStampCalculation[], lineId: number, approved: ReadonlySet<string>, hints = getProgramRemovalHints(lineId, rows, calculations, approved)) {
  const scopes = new Map<string, WeldRow[]>([['all:', rows]])
  for (const row of rows) if (isLineProgramControlRow(row)) {
    const stamps = getLineProgramOfficialStamps(row)
    for (const key of stamps.length ? stamps.map(stamp => programScopeKey({ stamp })) : ['unassigned:']) {
      const members = scopes.get(key) ?? []
      members.push(row); scopes.set(key, members)
    }
  }
  const entries = partitionProgramExcess(programExcessEntries(lineId, rows, calculations), approved)
  const demandIds = (group: LineProgramStampCalculation, kind: 'common' | 'pvk') => {
    const demand = group[kind]
    const ids = Object.fromEntries(Object.entries(demand).filter(([key]) => key.endsWith('RowIds')).map(([key, value]) => [key, new Set(value as number[])])) as Record<string, Set<number>>
    ids.missingRowIds = demand.missing > 0 ? ids.candidateRowIds : new Set()
    return ids
  }
  const groups = calculations.map(group => ({ ...group, commonIds: demandIds(group, 'common'), pvkIds: demandIds(group, 'pvk') }))
  const lineGroup = groups.find(group => group.scope === 'line')
  const stampGroups = new Map(groups.filter(group => group.scope !== 'line').map(group => [programScopeKey(group), group]))
  const cache = new Map<string, WeldRow[]>()
  const statuses = new Map(rows.map(row => [row.id, programRowStatus(row)]))
  const searchText = new Map(rows.map(row => [row.id, programRowSearchText(row)]))
  const filteredCache = new Map<string, { status: ProgramSelection['status']; search: string; rows: WeldRow[] }>()
  const selectBase = (selection: ProgramSelection): WeldRow[] => {
    const key = programScopeKey(selection), cacheKey = `${key}:${selection.kind ?? 'both'}:${selection.slice}`
    if (cache.has(cacheKey)) return cache.get(cacheKey)!
    const scoped = scopes.get(key) ?? []
    if (selection.slice === 'all') return scoped
    const kinds = selection.kind ? [selection.kind] : ['common', 'pvk'] as const
    const relevant = key === 'all:' ? groups : [lineGroup, stampGroups.get(key)].filter(group => !!group)
    const sources: Set<number>[] = []
    if (selection.slice === 'reduction') {
      const result = scoped.filter(row => [...(hints.get(row.id)?.keys() ?? [])].some(method => selection.kind === 'pvk' ? method === 'ПВК' : selection.kind === 'common' ? method !== 'ПВК' : true))
      cache.set(cacheKey, result); return result
    }
    if (selection.slice === 'approved' || selection.slice === 'excess') {
      sources.push(new Set((selection.slice === 'approved' ? entries.approved : entries.pending).filter(entry => kinds.includes(entry.kind)).map(entry => entry.rowId)))
      if (selection.slice === 'approved') sources.push(new Set(scoped.filter(row => isLineProgramControlRow(row) && kinds.some(kind => approved.has(programApprovalKey(row, kind, true)) || approved.has(programApprovalKey(row, kind, false)))).map(row => row.id)))
    } else if (selection.slice === 'assigned' || selection.slice === 'additional') {
      const result = scoped.filter(row => isLineProgramControlRow(row) && (selection.slice === 'assigned' ? kinds.some(kind => { const state = getLineProgramRowDemand(row, kind); return state.assigned || state.additional }) :
        (selection.kind === 'pvk' ? ['ПВК'] as const : selection.kind === 'common' ? ['РК', 'УЗК'] as const : PROGRAM_METHODS).some(method => programAssignment(row, method) === 'дополнительный')))
      cache.set(cacheKey, result); return result
    } else for (const group of relevant) for (const kind of kinds) {
      const ids = kind === 'common' ? group.commonIds : group.pvkIds
      if (selection.slice === 'missing') {
        sources.push(ids[`${selection.slice}RowIds`])
      } else {
        const field = selection.slice === 'covered' ? 'coveredRowIds' : selection.slice === 'results' ? 'completedRowIds' : selection.slice === 'cancelled' ? 'cancelledRowIds' : selection.slice === 'duplicates' ? 'duplicateAssignmentRowIds' : 'candidateRowIds'
        sources.push(ids[field])
      }
    }
    // The whole line uses one union; individual stamps check at most line + own group.
    const matches = key === 'all:' ? [new Set(sources.flatMap(ids => [...ids]))] : sources
    const result = scoped.filter(row => matches.some(ids => ids.has(row.id)))
    cache.set(cacheKey, result); return result
  }
  // Presentation filters reuse the loaded line. Searches are not retained in an unbounded cache.
  return (selection: ProgramSelection): WeldRow[] => {
    const scoped = selectBase(selection), needle = selection.search?.trim().toLocaleLowerCase('ru') ?? ''
    if (!selection.status && !needle) return scoped
    const key = `${programScopeKey(selection)}:${selection.kind ?? 'both'}:${selection.slice}`
    const cached = filteredCache.get(key)
    if (cached?.status === selection.status && cached?.search === needle) return cached.rows
    const filtered = scoped.filter(row => (!selection.status || statuses.get(row.id) === selection.status) &&
      (!needle || searchText.get(row.id)?.includes(needle)))
    filteredCache.set(key, { status: selection.status, search: needle, rows: filtered })
    return filtered
  }
}
