import { sql, type SQL } from 'drizzle-orm'

import type { requireDb } from '@/db'
import {
  linePrograms, pstoChainExceptions,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '@/db/schema'
import {
  getPstoLineIdentityKey,
  normalizePstoLineIdentity,
  PSTO_LINE_TABLE_FIELDS, PSTO_PROGRAM_LABELS,
  type PstoLineAssignmentFilter,
  type PstoLineAssignmentPageRequest,
  type PstoLineAssignmentPageResult,
  type PstoLineAssignmentSummary,
} from '@/lib/psto-line-assignment'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'

const CONTROL_ENABLED_VALUES_SQL = sql.join(
  CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES.map((value) => sql`${value}`),
  sql`, `,
)

type PstoLineAssignmentSummarySqlRow = {
  projectTitle: string
  subtitleCode: string
  line: string
  programState?: PstoLineAssignmentSummary['programState']
  exceptionCount?: number | string
  rowCount: number | string
  assignedCount: number | string
  cancelledCount: number | string
  historyRowCount: number | string
  removalHistoryRowCount?: number | string
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
      "historyRowCount", "removalHistoryRowCount",
      "preControlCount",
      "repeatCycleCount", "programState", "exceptionCount"
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
  const searchWhere = tableWhere(data)
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
        (count(*) filter (where "programState" = 'assigned'))::integer as "assignedCount",
        (count(*) filter (where "programState" = 'cancelled'))::integer as "cancelledCount",
        (count(*) filter (where "programState" = 'unassigned'))::integer as "unassignedCount",
        (count(*) filter (where
          "programState" = 'mixed'
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
    page: Number.isSafeInteger(request?.page) && request!.page! > 0 ? request!.page! : 1,
    pageSize,
    filters: normalizeFilters(request?.filters),
  }
}

function normalizeFilters(filters: Record<string, string> = {}) {
  return Object.fromEntries(Object.entries(filters).filter(([field, value]) => {
    if (!PSTO_LINE_TABLE_FIELDS.includes(field as typeof PSTO_LINE_TABLE_FIELDS[number]) || typeof value !== 'string' || value.length > 100_000) throw new Error('Некорректный фильтр программы ПСТО.')
    const parsed = parseWeldColumnChoiceFilter(value)
    if (parsed && parsed.kind !== 'values') throw new Error('Выберите значения фильтра.')
    return Boolean(value.trim())
  }))
}

function fieldSql(field: string): SQL {
  if (!PSTO_LINE_TABLE_FIELDS.includes(field as typeof PSTO_LINE_TABLE_FIELDS[number])) throw new Error('Неизвестный столбец программы ПСТО.')
  if (field === 'programState') return sql`case "programState" ${sql.join(Object.entries(PSTO_PROGRAM_LABELS).map(([key, label]) => sql`when ${key} then ${label}`), sql` `)} end`
  return sql`coalesce(${sql.identifier(field)}::text,'')`
}

function tableWhere(data: Required<PstoLineAssignmentPageRequest>, except?: string) {
  const clauses: SQL[] = [data.search ? sql`strpos(lower(concat_ws(' ', "projectTitle", "subtitleCode", line)),lower(${data.search})) > 0` : sql`true`]
  for (const [field, value] of Object.entries(data.filters)) {
    if (field === except) continue
    const column = fieldSql(field), parsed = parseWeldColumnChoiceFilter(value)
    clauses.push(parsed?.kind === 'values' ? sql`${column} = any(${sql.param(parsed.values)}::text[])` : sql`strpos(lower(${column}),lower(${value})) > 0`)
  }
  return sql.join(clauses, sql` and `)
}

export async function loadPstoLineFilterOptions(db: PstoLineAssignmentSummaryExecutor, request: PstoLineAssignmentPageRequest, field: string, match: string, offset: number) {
  const column = fieldSql(field), data = normalizePstoLineAssignmentPageRequest(request)
  const result = await db.execute<{ value: string; count: number }>(sql`${buildPstoLineAssignmentSummaryCte()}
    select ${column} as value, count(*)::integer as count from summaries
    where ${tableWhere(data, field)} and ${buildPstoLineAssignmentFilterWhere(data.filter)} and strpos(lower(${column}),lower(${match})) > 0
    group by 1 order by 1 limit 151 offset ${offset}`)
  return { options: result.rows.slice(0, 150).map(row => ({ ...row, label: row.value || '(Пусто)' })), next: result.rows.length > 150 ? offset + 150 : undefined }
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
        nullif(btrim(coalesce(${weldJoints.pstoExceptionBasis}, '')), '') is not null as is_exception,
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
    ), raw_summaries as (
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
        (count(*) filter (where has_history and not is_exception))::integer as "removalHistoryRowCount",
        coalesce(sum(pre_control_count), 0)::integer as "preControlCount",
        coalesce(sum(repeat_cycle_count), 0)::integer as "repeatCycleCount"
      from line_rows
      group by project_key, subtitle_key, line_key
    ), exception_counts as (
      select ${pstoChainExceptions.lineProgramId} as program_id, count(*)::integer as exception_count
      from ${pstoChainExceptions} where ${pstoChainExceptions.closedAt} is null group by ${pstoChainExceptions.lineProgramId}
    ), summaries as (
      select raw_summaries.*, coalesce(${linePrograms.pstoAssignment}, case
        when "assignedCount" = "rowCount" then 'assigned'
        when "cancelledCount" = "rowCount" then 'cancelled'
        when "assignedCount" = 0 and "cancelledCount" = 0 then 'unassigned'
        else 'mixed' end) as "programState", coalesce(exception_counts.exception_count, 0) as "exceptionCount"
      from raw_summaries left join ${linePrograms} on
        lower(btrim(${linePrograms.projectTitle})) = lower("projectTitle") and
        lower(btrim(${linePrograms.subtitleCode})) = lower("subtitleCode") and
        lower(btrim(${linePrograms.line})) = lower(raw_summaries."line")
      left join exception_counts on exception_counts.program_id = ${linePrograms.id}
    )`
}

function buildPstoLineAssignmentFilterWhere(filter: PstoLineAssignmentFilter) {
  if (filter === 'assigned') return sql`"programState" = 'assigned'`
  if (filter === 'cancelled') return sql`"programState" = 'cancelled'`
  if (filter === 'unassigned') return sql`"programState" = 'unassigned'`
  if (filter === 'partial') {
    return sql`
      "programState" = 'mixed'
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
      removalHistoryRowCount: 0,
      preControlCount: 0,
      repeatCycleCount: 0,
    }
    if (row.programState) current.programState = row.programState
    if (row.exceptionCount !== undefined) current.exceptionCount = normalizeSummaryCount(row.exceptionCount)
    current.rowCount += normalizeSummaryCount(row.rowCount)
    current.assignedCount += normalizeSummaryCount(row.assignedCount)
    current.cancelledCount += normalizeSummaryCount(row.cancelledCount)
    current.historyRowCount += normalizeSummaryCount(row.historyRowCount)
    current.removalHistoryRowCount! += normalizeSummaryCount(row.removalHistoryRowCount)
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
