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
  type PstoLineAssignmentFilter,
  type PstoLineAssignmentPageRequest,
  type PstoLineAssignmentPageResult,
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

type PstoLineAssignmentPageSqlRow = {
  rows: PstoLineAssignmentSummarySqlRow[] | string | null
  totalCount: number | string
  allCount: number | string
  assignedCount: number | string
  cancelledCount: number | string
  unassignedCount: number | string
  partialCount: number | string
  page: number | string
}

const PSTO_LINE_ASSIGNMENT_PAGE_SIZES = [25, 50, 100] as const

export async function loadPstoLineAssignmentSummaries(
  db: PstoLineAssignmentSummaryExecutor,
): Promise<PstoLineAssignmentSummary[]> {
  const result = await db.execute<PstoLineAssignmentSummarySqlRow>(sql`
    ${buildPstoLineAssignmentSummaryCte()}
    select
      "projectTitle",
      "subtitleCode",
      "line",
      "rowCount",
      "assignedCount",
      "cancelledCount",
      "historyRowCount",
      "preControlCount",
      "repeatCycleCount"
    from summaries
    order by "projectTitle", "subtitleCode", "line"
  `)

  return mergePstoLineAssignmentSummaryRows(result.rows)
}

export async function loadPstoLineAssignmentSummaryPage(
  db: PstoLineAssignmentSummaryExecutor,
  request: PstoLineAssignmentPageRequest | undefined,
): Promise<PstoLineAssignmentPageResult> {
  const data = normalizePstoLineAssignmentPageRequest(request)
  const searchWhere = data.search
    ? sql`lower(concat_ws(' ', "projectTitle", "subtitleCode", "line")) like ${`%${data.search.toLocaleLowerCase('ru-RU')}%`}`
    : sql`true`
  const filterWhere = buildPstoLineAssignmentFilterWhere(data.filter)
  const requestedOffset = sql`(
    least(
      ${data.page},
      greatest(ceil((select "totalCount" from filtered_count)::numeric / ${data.pageSize})::integer, 1)
    ) - 1
  ) * ${data.pageSize}`
  const result = await db.execute<PstoLineAssignmentPageSqlRow>(sql`
    ${buildPstoLineAssignmentSummaryCte()},
    filtered as (
      select *
      from summaries
      where ${searchWhere} and ${filterWhere}
    ),
    summary_counts as (
      select
        count(*)::integer as "allCount",
        (count(*) filter (where "assignedCount" = "rowCount"))::integer as "assignedCount",
        (count(*) filter (where "cancelledCount" = "rowCount"))::integer as "cancelledCount",
        (count(*) filter (where "assignedCount" = 0 and "cancelledCount" = 0))::integer as "unassignedCount",
        (count(*) filter (where
          "assignedCount" <> "rowCount"
          and "cancelledCount" <> "rowCount"
          and ("assignedCount" > 0 or "cancelledCount" > 0)
        ))::integer as "partialCount"
      from summaries
    ),
    filtered_count as (
      select count(*)::integer as "totalCount" from filtered
    ),
    paged as (
      select *
      from filtered
      order by "projectTitle", "subtitleCode", "line"
      limit ${data.pageSize}
      offset ${requestedOffset}
    )
    select
      coalesce((select jsonb_agg(to_jsonb(paged) order by "projectTitle", "subtitleCode", "line") from paged), '[]'::jsonb) as "rows",
      filtered_count."totalCount" as "totalCount",
      summary_counts."allCount" as "allCount",
      summary_counts."assignedCount" as "assignedCount",
      summary_counts."cancelledCount" as "cancelledCount",
      summary_counts."unassignedCount" as "unassignedCount",
      summary_counts."partialCount" as "partialCount",
      least(
        ${data.page},
        greatest(ceil(filtered_count."totalCount"::numeric / ${data.pageSize})::integer, 1)
      ) as "page"
    from summary_counts
    cross join filtered_count
  `)
  const row = result.rows[0]
  const totalCount = normalizeSummaryCount(row?.totalCount)
  const pageSize = data.pageSize
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  const page = Math.min(Math.max(1, normalizeSummaryCount(row?.page) || 1), pageCount)
  const rawRows = parsePstoLineAssignmentPageRows(row?.rows)

  return {
    rows: mergePstoLineAssignmentSummaryRows(rawRows),
    totalCount,
    page,
    pageSize,
    pageCount,
    counts: {
      all: normalizeSummaryCount(row?.allCount),
      assigned: normalizeSummaryCount(row?.assignedCount),
      cancelled: normalizeSummaryCount(row?.cancelledCount),
      unassigned: normalizeSummaryCount(row?.unassignedCount),
      partial: normalizeSummaryCount(row?.partialCount),
    },
  }
}

export function normalizePstoLineAssignmentPageRequest(
  request: PstoLineAssignmentPageRequest | undefined,
): Required<PstoLineAssignmentPageRequest> {
  const filter: PstoLineAssignmentFilter =
    request?.filter === 'assigned' ||
    request?.filter === 'cancelled' ||
    request?.filter === 'unassigned' ||
    request?.filter === 'partial'
      ? request.filter
      : 'all'
  const requestedPageSize = Math.floor(Number(request?.pageSize))
  const pageSize = PSTO_LINE_ASSIGNMENT_PAGE_SIZES.includes(
    requestedPageSize as (typeof PSTO_LINE_ASSIGNMENT_PAGE_SIZES)[number],
  )
    ? requestedPageSize
    : 25
  return {
    search: String(request?.search ?? '').trim().slice(0, 200),
    filter,
    page: Math.max(1, Math.floor(Number(request?.page)) || 1),
    pageSize,
  }
}

function buildPstoLineAssignmentSummaryCte() {
  return sql`
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
    ), line_rows as (
      select
        lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) as project_key,
        lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) as subtitle_key,
        lower(btrim(coalesce(${weldJoints.line}, ''))) as line_key,
        btrim(coalesce(${weldJoints.projectTitle}, '')) as project_title,
        btrim(coalesce(${weldJoints.subtitleCode}, '')) as subtitle_code,
        btrim(coalesce(${weldJoints.line}, '')) as line,
        ${weldJoints.pstoRequired} as psto_required,
        (
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
        ) as has_history,
        coalesce(pre_counts.relation_count, 0) as pre_control_count,
        coalesce(repeat_counts.relation_count, 0) as repeat_cycle_count
      from ${weldJoints}
      left join pre_counts on pre_counts.weld_joint_id = ${weldJoints.id}
      left join repeat_counts on repeat_counts.weld_joint_id = ${weldJoints.id}
      where btrim(coalesce(${weldJoints.line}, '')) <> ''
    ), summaries as (
      select
        min(project_title) as "projectTitle",
        min(subtitle_code) as "subtitleCode",
        min(line) as "line",
        count(*)::integer as "rowCount",
        (count(*) filter (
          where lower(btrim(coalesce(psto_required, ''))) in (${CONTROL_ENABLED_VALUES_SQL})
        ))::integer as "assignedCount",
        (count(*) filter (
          where lower(btrim(coalesce(psto_required, ''))) = 'отменен'
        ))::integer as "cancelledCount",
        (count(*) filter (where has_history))::integer as "historyRowCount",
        coalesce(sum(pre_control_count), 0)::integer as "preControlCount",
        coalesce(sum(repeat_cycle_count), 0)::integer as "repeatCycleCount"
      from line_rows
      group by project_key, subtitle_key, line_key
    )`
}

function buildPstoLineAssignmentFilterWhere(filter: PstoLineAssignmentFilter) {
  if (filter === 'assigned') return sql`"assignedCount" = "rowCount"`
  if (filter === 'cancelled') return sql`"cancelledCount" = "rowCount"`
  if (filter === 'unassigned') return sql`"assignedCount" = 0 and "cancelledCount" = 0`
  if (filter === 'partial') {
    return sql`
      "assignedCount" <> "rowCount"
      and "cancelledCount" <> "rowCount"
      and ("assignedCount" > 0 or "cancelledCount" > 0)
    `
  }
  return sql`true`
}

function parsePstoLineAssignmentPageRows(
  value: PstoLineAssignmentPageSqlRow['rows'],
): PstoLineAssignmentSummarySqlRow[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as PstoLineAssignmentSummarySqlRow[] : []
  } catch {
    return []
  }
}

function mergePstoLineAssignmentSummaryRows(rows: PstoLineAssignmentSummarySqlRow[]) {
  const summaries = new Map<string, PstoLineAssignmentSummary>()
  for (const row of rows) {
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

function normalizeSummaryCount(value: unknown) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}
