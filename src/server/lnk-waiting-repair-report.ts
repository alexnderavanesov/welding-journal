import { sql } from 'drizzle-orm'
import type { requireDb } from '@/db'
import { dispatcherTaskPages, generatedDocuments, weldJointProgramStates, weldJoints } from '@/db/schema'
import { parseDispatcherTaskIndexPayload } from '@/lib/dispatcher-task-index-payload'
import { getWaitingRepairControl } from '@/lib/lnk-waiting-repair-report'
import { getStampSelectValue } from '@/lib/weld-form-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildNumberArrayMatch } from './weld-request-utils'

type ReportDb = Pick<ReturnType<typeof requireDb>, 'select' | 'execute'>

// Resolve the physical work once, before pagination. The rejected source and
// its continuation may be on different pages or even have the same joint name.
export async function loadPendingRepairNames(db: ReportDb, state: { repeatedTasks: string }) {
  const payload = parseDispatcherTaskIndexPayload(state.repeatedTasks)
  const pending = new Set<number>()
  const coils = new Map<number, readonly number[]>()
  if (payload.tasksTruncated) {
    // The compact dispatcher snapshot only contains its first tasks. The
    // published pages contain the complete set from the same transaction.
    const missing = await db.execute<{ id: number; kind: 'create' | 'coil' }>(sql`
      select distinct (task->'row'->>'id')::int as id, task->>'kind' as kind from ${dispatcherTaskPages}
      cross join lateral jsonb_array_elements(tasks::jsonb) task where task->>'kind' in ('create', 'coil')
    `)
    for (const task of missing.rows) addCreation(task.id, task.kind)
  } else {
    for (const task of payload.tasks) {
      if (task.kind === 'create' || task.kind === 'coil') addCreation(task.row.id, task.kind)
    }
  }
  function addCreation(sourceId: number, kind: 'create' | 'coil') {
    if (kind === 'coil') coils.set(sourceId, [])
    else pending.add(sourceId)
  }
  for (const link of payload.chainContinuations) {
    if (link.kind === 'coil') coils.set(link.sourceRowId, link.targetRowIds)
  }

  const links = payload.chainContinuations.filter(link => link.kind !== 'coil' && link.targetRowIds.length === 1)
  // Persisted parent IDs survive renames. Prefer them to inferred names, and
  // suppress an old pending task if its actual child has since been welded.
  // Fetch each endpoint by its unique ID before testing its scope or date.
  // After a bulk import those filters may still have obsolete table statistics.
  const outstanding = await db.execute<{ id: number; joint: string }>(sql`
    with saved_children as (
      select s.source_row_id as source_id, s.weld_joint_id as target_id, s.kind, s.coil_side,
        parent.weld_date is not null as parent_welded
      from ${weldJointProgramStates} s
      cross join lateral (select project_title, subtitle_code, line from ${weldJoints} where id=s.weld_joint_id limit 1) child
      cross join lateral (select project_title, subtitle_code, line, weld_date from ${weldJoints} where id=s.source_row_id limit 1) parent
      where s.kind in ('repair','coil') and s.source_row_id <> s.weld_joint_id
        and (lower(trim(coalesce(parent.project_title,''))), lower(trim(coalesce(parent.subtitle_code,''))), lower(trim(coalesce(parent.line,''))))
          = (lower(trim(coalesce(child.project_title,''))), lower(trim(coalesce(child.subtitle_code,''))), lower(trim(coalesce(child.line,''))))
    ), saved as (
      select source_id, target_id from saved_children where kind='repair'
    ), links as (
      select saved.*, false as same_name from saved
      union all
      select l.source_id, l.target_id, l.same_name from unnest(${sql.param(links.map(link => link.sourceRowId))}::int[],
        ${sql.param(links.map(link => link.targetRowIds[0]))}::int[],
        ${sql.param(links.map(link => link.kind === 'official-joint'))}::boolean[]) l(source_id, target_id, same_name)
      left join ${weldJointProgramStates} stored on stored.weld_joint_id=l.target_id
      where l.same_name or (stored.weld_joint_id is null
        and not exists (select 1 from saved where saved.source_id=l.source_id)
        and not exists (select 1 from saved where saved.target_id=l.target_id))
    ), unwelded as (
      select distinct on (target.id) source.id, target.joint
      from links
      cross join lateral (select id, joint, weld_date, revision_actuality from ${weldJoints} where id=links.target_id limit 1) target
      cross join lateral (select id, weld_date from ${weldJoints} where id=links.source_id limit 1) source
      where target.weld_date is null and lower(trim(coalesce(target.revision_actuality,''))) <> 'не актуален'
        and source.weld_date is not null
      order by target.id, links.same_name desc, source.weld_date desc, source.id desc
    ), repairs as (
      select id, joint from unwelded
      union all
      select missing.id, '-' from unnest(${sql.param([...pending])}::int[]) missing(id)
      where not exists (select 1 from links where links.source_id=missing.id)
    ), coil_work as (${coilRepairRows(coils)})
    select repairs.id, repairs.joint from repairs
    left join ${weldJointProgramStates} source on source.weld_joint_id=repairs.id
    left join ${weldJointProgramStates} root on root.weld_joint_id=coalesce(source.physical_root_id,repairs.id)
    where not coalesce(root.replaced_by_coil,false)
      and not exists (select 1 from coil_work where coil_work.id=repairs.id)
    union all
    select id, joint from coil_work where joint is not null
  `)
  return new Map(outstanding.rows.map(row => [row.id, row.joint]))
}

// A surviving side identifies an unfinished replacement even after a rename or
// deletion of its mate. A completed replacement supersedes inferred repairs.
function coilRepairRows(coils: ReadonlyMap<number, readonly number[]>) {
  const pairs = [...coils.values()]
  return sql`
    with candidates as (
      select * from unnest(${sql.param([...coils.keys()])}::int[], ${sql.param(pairs.map(ids => ids[0] ?? null))}::int[],
        ${sql.param(pairs.map(ids => ids[1] ?? null))}::int[]) c(id, first_id, second_id)
    ), saved_pairs as (
      select source_id, max(target_id) filter (where coil_side=1) as first_id,
        max(target_id) filter (where coil_side=2) as second_id
      from saved_children where kind='coil' and parent_welded
      group by source_id having count(*)=count(distinct coil_side)
    ), resolved as (
      select coalesce(c.id,p.source_id) as id, coalesce(p.first_id,c.first_id) as first_id,
        coalesce(p.second_id,c.second_id) as second_id
      from candidates c full join saved_pairs p on p.source_id=c.id
    )
    select c.id, case
      when coalesce(root.replaced_by_coil,false) or (
        (a.weld_date is not null or lower(trim(coalesce(a.revision_actuality,''))) = 'не актуален')
        and (b.weld_date is not null or lower(trim(coalesce(b.revision_actuality,''))) = 'не актуален')
      ) then null
      when a.id is null or b.id is null then 'Замена катушкой'
      else a.joint || ', ' || b.joint end as joint
    from resolved c
    left join ${weldJoints} a on a.id=c.first_id
    left join ${weldJoints} b on b.id=c.second_id
    left join ${weldJointProgramStates} source on source.weld_joint_id=c.id
    left join ${weldJointProgramStates} root on root.weld_joint_id=coalesce(source.physical_root_id,c.id)
  `
}

function formatActualStamps(row: WeldRow) {
  const first = getStampSelectValue(row.stamp1KFact)
  const second = getStampSelectValue(row.stamp1ZFact)
  if (!first) return second
  if (!second || first.toUpperCase() === second.toUpperCase()) return first
  return `${first}/${second}`
}

export async function projectWaitingRepairRows(db: ReportDb, rows: WeldRow[], pending: ReadonlyMap<number, string>) {
  const positions = rows.flatMap(row => {
    const control = getWaitingRepairControl(row)
    return control ? [{ row, control }] : []
  })
  const documentIds = [...new Set(positions.flatMap(({ control }) => control.documentId ? [control.documentId] : []))]
  const signatures = documentIds.length ? await db.select({ id: generatedDocuments.id,
    stamp: sql<string | null>`${generatedDocuments.specialists}->'first'->>'stamp'` }).from(generatedDocuments)
    .where(buildNumberArrayMatch(generatedDocuments.id, documentIds)) : []
  const stamps = new Map(signatures.map(doc => [doc.id, doc.stamp]))
  return positions.map(({ row, control }) => ({
    ...row, ...control,
    actualStamps: formatActualStamps(row),
    inspectorStamp: control.documentId ? stamps.get(control.documentId) : '',
    requestOrganization: 'ЮМС', nextJoint: pending.get(row.id),
  }))
}
