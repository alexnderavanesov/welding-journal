import { TECHNOLOGY_CARD_REASON } from '@/lib/dispatcher-check-reasons'
import { isTConnectionType } from '@/lib/connection-type'
import type { RepeatedJointCheckTask, WeldRow } from '@/lib/dispatcher-types'
import type { createTechnologyCardReview } from '@/lib/technology-card-review'

export function buildTechnologyCardTasks(rows: WeldRow[], review: ReturnType<typeof createTechnologyCardReview>): RepeatedJointCheckTask[] {
  const tasks: RepeatedJointCheckTask[] = []
  for (const row of rows) {
    if (!String(row.weldDate ?? '').trim() || isTConnectionType(row.connectionType)) continue
    const result = review(row)
    if (result.status === 'valid') continue
    tasks.push({ kind: 'check', key: `technology-card:${row.id}`, row, sourceRow: row,
      sourceJoint: String(row.joint ?? ''), targetJoint: String(row.joint ?? ''), baseJoint: String(row.joint ?? ''),
      suffix: 'R', reason: TECHNOLOGY_CARD_REASON, details: result.message })
  }
  return tasks
}
