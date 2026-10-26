import { sql } from 'drizzle-orm'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Explicit release preparation, never a page-read side effect. Preserve the
 * previous unanimous line decision before any joint can leave that line. Mixed
 * legacy lines remain unresolved; guessing a majority would alter assignments. */
export async function initializePstoLinePrograms(tx: Pick<SystemDocumentSequenceTransaction, 'execute'>) {
  await tx.execute(sql`lock table weld_joints, line_programs in share row exclusive mode`)
  const enabled = sql.join(CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES.map(value => sql`${value}`), sql`, `)
  const result = await tx.execute(sql`with decisions as (
    select lower(btrim(coalesce(project_title, ''))) as project_key,
      lower(btrim(coalesce(subtitle_code, ''))) as subtitle_key, lower(btrim(line)) as line_key,
      count(*) as n,
      count(*) filter (where lower(btrim(coalesce(psto_required, ''))) in (${enabled})) as assigned,
      count(*) filter (where lower(btrim(coalesce(psto_required, ''))) = 'отменен') as cancelled,
      max(psto_cancellation_date) as cancellation_date,
      max(nullif(btrim(psto_control_basis), '')) filter (where lower(btrim(coalesce(psto_required, ''))) = 'отменен') as cancellation_basis
    from weld_joints where nullif(btrim(line), '') is not null
    group by lower(btrim(coalesce(project_title, ''))), lower(btrim(coalesce(subtitle_code, ''))), lower(btrim(line))
  ), candidates as (
    select p.id, case when d.assigned = d.n then 'assigned' when d.cancelled = d.n then 'cancelled'
      when coalesce(d.assigned, 0) = 0 and coalesce(d.cancelled, 0) = 0 then 'unassigned' end as state,
      d.cancellation_date, d.cancellation_basis
    from line_programs p left join decisions d on d.project_key = lower(btrim(p.project_title))
      and d.subtitle_key = lower(btrim(p.subtitle_code)) and d.line_key = lower(btrim(p.line))
    where p.psto_assignment is null
  ), initialized as (
    update line_programs p set psto_assignment = c.state,
      psto_cancellation_date = case when c.state = 'cancelled' then c.cancellation_date end,
      psto_cancellation_basis = case when c.state = 'cancelled' then c.cancellation_basis end,
      updated_at = now()
    from candidates c where p.id = c.id and c.state is not null returning p.id
  ) select (select count(*)::integer from initialized) as initialized,
    (select count(*)::integer from candidates where state is null) as mixed`)
  return result.rows[0] as { initialized: number; mixed: number }
}
