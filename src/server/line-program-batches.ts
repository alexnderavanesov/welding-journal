import type { LineProgramRecord } from '@/lib/line-program'

// A line is indivisible: quotas, shared stamps and repair chains need its full
// population. Only the working set is batched; no rows or result lines are cut.
export const LINE_PROGRAM_BATCH_JOINT_TARGET = 10_000

export function partitionLineProgramBatches(
  programs: LineProgramRecord[],
  jointCounts: ReadonlyMap<number, number>,
) {
  const batches: LineProgramRecord[][] = []
  let batch: LineProgramRecord[] = [], joints = 0
  for (const program of programs) {
    const count = jointCounts.get(program.id) ?? 0
    if (batch.length && count > 0 && joints + count > LINE_PROGRAM_BATCH_JOINT_TARGET) {
      batches.push(batch)
      batch = []; joints = 0
    }
    batch.push(program)
    joints += count
  }
  if (batch.length) batches.push(batch)
  return batches
}
