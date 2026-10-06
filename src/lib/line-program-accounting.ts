import type { LineProgramDemand } from './line-program-calculation'

export type ProgramAssignmentAccounting = { yesOnly: number; additionalOnly: number; mixed: number; total: number }
export type ProgramCoverageAccounting = ProgramAssignmentAccounting & { other: number }

/** Disjoint buckets: a yes + additional combination contributes one physical joint. */
export function getProgramDemandAccounting(demand: Pick<LineProgramDemand, 'assignedRowIds' | 'additionalRowIds' | 'coveredRowIds'>) {
  const yes = new Set(demand.assignedRowIds), additional = new Set(demand.additionalRowIds)
  const count = (ids: Iterable<number>) => {
    const result: ProgramCoverageAccounting = { yesOnly: 0, additionalOnly: 0, mixed: 0, other: 0, total: 0 }
    for (const id of ids) {
      result.total++
      if (yes.has(id) && additional.has(id)) result.mixed++
      else if (yes.has(id)) result.yesOnly++
      else if (additional.has(id)) result.additionalOnly++
      else result.other++
    }
    return result
  }
  return { assignments: count(new Set([...yes, ...additional])), coverage: count(new Set(demand.coveredRowIds)) }
}

export function formatProgramAssignmentAccounting(counts: ProgramAssignmentAccounting) {
  return `только «да»: ${counts.yesOnly} + только «доп»: ${counts.additionalOnly} + «да» и «доп» на одном стыке: ${counts.mixed} = ${counts.total}`
}
