import { sql, type SQL } from 'drizzle-orm'
import type { requireDb } from '@/db'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { PSTO_EXCEPTION_FIELDS, type PstoExceptionField, normalizePstoExceptionTableRequest } from '@/lib/psto-exception-table'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import { PSTO_PROGRAM_LABELS } from '@/lib/psto-line-assignment'

type Reader = Pick<ReturnType<typeof requireDb>, 'execute'>
type Request = ReturnType<typeof normalizePstoExceptionTableRequest>
export type PstoExceptionCandidate = { id: number; joint: string; projectTitle: string; subtitleCode: string; line: string; linePsto: string }
export type PstoExceptionEntry = Omit<PstoExceptionCandidate, 'joint'> & { rootJoint: string; required: boolean; basis: string }

function source(candidates: boolean) {
  if (!candidates) return sql`with source as (
    select e.id, e.root_joint as "rootJoint", e.required, e.basis,
      p.project_title as "projectTitle", p.subtitle_code as "subtitleCode", p.line,
      case p.psto_assignment when 'assigned' then ${PSTO_PROGRAM_LABELS.assigned}
        when 'cancelled' then ${PSTO_PROGRAM_LABELS.cancelled} when 'unassigned' then ${PSTO_PROGRAM_LABELS.unassigned}
        else ${PSTO_PROGRAM_LABELS.mixed} end as "linePsto"
    from psto_chain_exceptions e join line_programs p on p.id=e.line_program_id where e.closed_at is null
  )`
  // Only legacy/uninitialised programs need inference. Aggregate once by line,
  // never once per joint, and never infer the baseline from an individual exception.
  const enabled = sql.join(CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES.map(value => sql`${value}`), sql`, `)
  return sql`with legacy as (
    select lower(btrim(coalesce(w.project_title,''))) as project, lower(btrim(coalesce(w.subtitle_code,''))) as subtitle,
      lower(btrim(w.line)) as line,
      case when bool_and(lower(btrim(coalesce(w.psto_required,''))) in (${enabled})) then ${PSTO_PROGRAM_LABELS.assigned}
        when bool_and(lower(btrim(coalesce(w.psto_required,''))) = 'отменен') then ${PSTO_PROGRAM_LABELS.cancelled}
        when not bool_or(lower(btrim(coalesce(w.psto_required,''))) in (${enabled})) and
          not bool_or(lower(btrim(coalesce(w.psto_required,''))) = 'отменен')
          then ${PSTO_PROGRAM_LABELS.unassigned} else ${PSTO_PROGRAM_LABELS.mixed} end as required
    from weld_joints w left join line_programs p on
      lower(btrim(coalesce(w.project_title,'')))=lower(btrim(p.project_title)) and
      lower(btrim(coalesce(w.subtitle_code,'')))=lower(btrim(p.subtitle_code)) and lower(btrim(w.line))=lower(btrim(p.line))
    where p.psto_assignment is null and nullif(btrim(w.line),'') is not null
    group by 1,2,3
  ), source as (
    select w.id, coalesce(w.joint,'') as joint, coalesce(w.project_title,'') as "projectTitle",
      coalesce(w.subtitle_code,'') as "subtitleCode", w.line,
      case p.psto_assignment when 'assigned' then ${PSTO_PROGRAM_LABELS.assigned}
        when 'cancelled' then ${PSTO_PROGRAM_LABELS.cancelled} when 'unassigned' then ${PSTO_PROGRAM_LABELS.unassigned}
        else coalesce(l.required,${PSTO_PROGRAM_LABELS.mixed}) end as "linePsto"
    from weld_joints w left join line_programs p on
      lower(btrim(coalesce(w.project_title,'')))=lower(btrim(p.project_title)) and
      lower(btrim(coalesce(w.subtitle_code,'')))=lower(btrim(p.subtitle_code)) and lower(btrim(w.line))=lower(btrim(p.line))
    left join legacy l on lower(btrim(coalesce(w.project_title,'')))=l.project and lower(btrim(coalesce(w.subtitle_code,'')))=l.subtitle and lower(btrim(w.line))=l.line
    where nullif(btrim(w.line),'') is not null
  )`
}

function fieldSql(field: string, candidates: boolean): SQL {
  if (!PSTO_EXCEPTION_FIELDS.includes(field as PstoExceptionField) || (candidates ? ['rootJoint', 'required', 'basis'].includes(field) : field === 'joint')) throw new Error('Этот столбец недоступен в выбранной таблице.')
  if (field === 'required') return sql`case when required then 'Да' else 'Нет' end`
  if (field === 'rootJoint') return sql`upper("rootJoint")`
  return sql`coalesce(${sql.identifier(field)},'')`
}

function where(request: Request, candidates: boolean, except?: string) {
  const clauses: SQL[] = [sql`true`]
  if (request.search) clauses.push(sql`strpos(lower(concat_ws(' ', "projectTitle", "subtitleCode", line, ${sql.identifier(candidates ? 'joint' : 'rootJoint')}${candidates ? sql`` : sql`, basis`})), lower(${request.search})) > 0`)
  for (const [field, filter] of Object.entries(request.filters)) {
    if (field === except) continue
    const column = fieldSql(field, candidates), parsed = parseWeldColumnChoiceFilter(filter)
    if (parsed?.kind === 'values') clauses.push(parsed.values.length ? sql`${column} = any(${sql.param(parsed.values)}::text[])` : sql`false`)
    else clauses.push(sql`strpos(lower(${column}), lower(${filter})) > 0`)
  }
  return sql.join(clauses, sql` and `)
}

export async function readPstoExceptionTable<C extends boolean>(db: Reader, request: Request, candidates: C) {
  type Row = C extends true ? PstoExceptionCandidate : PstoExceptionEntry
  const result = await db.execute<{ rows: Row[]; totalCount: number; page: number }>(sql`${source(candidates)},
    filtered as (select * from source where ${where(request, candidates)}),
    total as (select count(*)::int as count from filtered),
    paging as (select count, least(${request.page}, greatest(0, (count-1)/${request.pageSize}))::int as page from total),
    selected as (select * from filtered order by ${candidates ? sql`joint, id` : sql`id desc`} limit ${request.pageSize} offset (select page from paging)*${request.pageSize})
    select coalesce((select json_agg(selected) from selected),'[]'::json) as rows, count as "totalCount", page from paging`)
  return { ...result.rows[0], pageSize: request.pageSize }
}

export async function readPstoExceptionFilterOptions(db: Reader, request: Request, candidates: boolean, field: string, search: string, offset: number) {
  const column = fieldSql(field, candidates)
  const result = await db.execute<{ value: string; count: number }>(sql`${source(candidates)}
    select ${column} as value, count(*)::int as count from source
    where ${where(request, candidates, field)} and strpos(lower(${column}), lower(${search})) > 0
    group by ${column} order by ${column} limit 151 offset ${offset}`)
  return { options: result.rows.slice(0, 150).map(row => ({ ...row, label: row.value || '(Пусто)' })), next: result.rows.length > 150 ? offset + 150 : undefined }
}
