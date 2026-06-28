import { parseJointChainName } from '@/lib/joint-chain'
import { getDuplicateJointKey, compareJointChainRows } from '@/lib/repeated-joint-row-utils'
import type { RepeatedJointDuplicateCheckTask, WeldRow } from '@/lib/dispatcher-types'

export function buildDuplicateJointCheckTasks(rows: WeldRow[]): RepeatedJointDuplicateCheckTask[] {
  const groups = new Map<string, WeldRow[]>()
  for (const row of rows) {
    const key = getDuplicateJointKey(row)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  return [...groups.entries()].flatMap(([key, group]) => {
    if (group.length < 2) return []
    const sortedGroup = [...group].sort(compareJointChainRows)
    const row = sortedGroup[0]
    const sourceJoint = String(row.joint ?? '').trim()
    if (!sourceJoint) return []
    const baseJoint = parseJointChainName(sourceJoint).base || sourceJoint
    return [
      {
        kind: 'duplicate-check' as const,
        key: `duplicate-check:${key}`,
        row,
        sourceJoint,
        baseJoint,
        count: group.length,
      },
    ]
  })
}
