import { sql } from 'drizzle-orm'

import type { requireDb } from '@/db'
import {
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '@/db/schema'
import {
  getPstoLineIdentityKey,
  normalizePstoLineIdentity,
  type PstoLineAssignmentSummary,
} from '@/lib/psto-line-assignment'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'

const CONTROL_ENABLED_VALUES_SQL = sql.join(
  CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES.map((value) => sql`${value}`),
  sql`, `,
)

type PstoLineAssignmentSummarySqlRow = {
  projectTitle: string
  subtitleCode: string
  line: string
  rowCount: number | string
  assignedCount: number | string
  cancelledCount: number | string
  historyRowCount: number | string
  preControlCount: number | string
  repeatCycleCount: number | string
}

type PstoLineAssignmentSummaryExecutor = Pick<ReturnType<typeof requireDb>, 'execute'>

export async function loadPstoLineAssignmentSummaries(
  db: PstoLineAssignmentSummaryExecutor,
): Promise<PstoLineAssignmentSummary[]> {
  const result = await db.execute<PstoLineAssignmentSummarySqlRow>(sql`
    with pre_counts as (
      select
        ${preHeatTreatmentControls.weldJointId} as weld_joint_id,
        count(*)::integer as relation_count
      from ${preHeatTreatmentControls}
      group by ${preHeatTreatmentControls.weldJointId}
    ), repeat_counts as (
      select
        ${pstoRepeatCycles.weldJointId} as weld_joint_id,
        count(*)::integer as relation_count
      from ${pstoRepeatCycles}
      group by ${pstoRepeatCycles.weldJointId}
    )
    select
      btrim(coalesce(${weldJoints.projectTitle}, '')) as "projectTitle",
      btrim(coalesce(${weldJoints.subtitleCode}, '')) as "subtitleCode",
      btrim(coalesce(${weldJoints.line}, '')) as "line",
      count(*)::integer as "rowCount",
      (count(*) filter (
        where lower(btrim(coalesce(${weldJoints.pstoRequired}, ''))) in (${CONTROL_ENABLED_VALUES_SQL})
      ))::integer as "assignedCount",
      (count(*) filter (
        where lower(btrim(coalesce(${weldJoints.pstoRequired}, ''))) = 'отменен'
      ))::integer as "cancelledCount",
      (count(*) filter (
        where
          nullif(btrim(coalesce(${weldJoints.pstoRequest}, '')), '') is not null
          or ${weldJoints.pstoRequestDate} is not null
          or ${weldJoints.pstoDate} is not null
          or nullif(btrim(coalesce(${weldJoints.heatTreatmentDiagram}, '')), '') is not null
          or nullif(btrim(coalesce(${weldJoints.pstoNote}, '')), '') is not null
          or nullif(btrim(coalesce(${weldJoints.tvmtRequest}, '')), '') is not null
          or ${weldJoints.tvmtRequestDate} is not null
          or ${weldJoints.tvmtConclusionDate} is not null
          or nullif(btrim(coalesce(${weldJoints.tvmtConclusion}, '')), '') is not null
          or lower(btrim(coalesce(${weldJoints.pstoResult}, ''))) in ('проведено', 'проведено (отменен)', 'да')
          or (
            nullif(btrim(coalesce(${weldJoints.tvmtResult}, '')), '') is not null
            and lower(btrim(coalesce(${weldJoints.tvmtResult}, ''))) not like 'ожидает%'
          )
          or coalesce(pre_counts.relation_count, 0) > 0
          or coalesce(repeat_counts.relation_count, 0) > 0
      ))::integer as "historyRowCount",
      coalesce(sum(pre_counts.relation_count), 0)::integer as "preControlCount",
      coalesce(sum(repeat_counts.relation_count), 0)::integer as "repeatCycleCount"
    from ${weldJoints}
    left join pre_counts on pre_counts.weld_joint_id = ${weldJoints.id}
    left join repeat_counts on repeat_counts.weld_joint_id = ${weldJoints.id}
    where btrim(coalesce(${weldJoints.line}, '')) <> ''
    group by
      btrim(coalesce(${weldJoints.projectTitle}, '')),
      btrim(coalesce(${weldJoints.subtitleCode}, '')),
      btrim(coalesce(${weldJoints.line}, ''))
    order by
      btrim(coalesce(${weldJoints.projectTitle}, '')),
      btrim(coalesce(${weldJoints.subtitleCode}, '')),
      btrim(coalesce(${weldJoints.line}, ''))
  `)

  const summaries = new Map<string, PstoLineAssignmentSummary>()
  for (const row of result.rows) {
    const identity = normalizePstoLineIdentity(row)
    if (!identity.line) continue
    const key = getPstoLineIdentityKey(identity)
    const current = summaries.get(key) ?? {
      ...identity,
      key,
      rowCount: 0,
      assignedCount: 0,
      cancelledCount: 0,
      historyRowCount: 0,
      preControlCount: 0,
      repeatCycleCount: 0,
    }
    current.rowCount += normalizeSummaryCount(row.rowCount)
    current.assignedCount += normalizeSummaryCount(row.assignedCount)
    current.cancelledCount += normalizeSummaryCount(row.cancelledCount)
    current.historyRowCount += normalizeSummaryCount(row.historyRowCount)
    current.preControlCount += normalizeSummaryCount(row.preControlCount)
    current.repeatCycleCount += normalizeSummaryCount(row.repeatCycleCount)
    summaries.set(key, current)
  }
  return [...summaries.values()]
}

function normalizeSummaryCount(value: number | string) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}
