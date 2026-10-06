import { eq, sql } from 'drizzle-orm'
import { appSettings } from '@/db/schema'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { LINE_PROGRAM_TRANSITION_KEY } from '@/lib/release-contract'

export { LINE_PROGRAM_TRANSITION_KEY }
export const LINE_PROGRAM_BACKUP_PREFIX = `${LINE_PROGRAM_TRANSITION_KEY}:backup:`

/** Explicit, one-time data transition. Never called by reads or normal saves.
 * Caller must stop old writers, explicitly verify/authorize the target and own the transaction.
 * Backups and the marker commit atomically with changes; numbering is untouched.
 */
export async function transitionLinePrograms(tx: SystemDocumentSequenceTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LINE_PROGRAM_TRANSITION_KEY}))`)
  const [marker] = await tx.select().from(appSettings).where(eq(appSettings.key, LINE_PROGRAM_TRANSITION_KEY)).limit(1)
  if (marker) return { skipped: true }
  // Reject unknown FK consumers rather than silently cascading through them.
  const dependencies = await tx.execute(sql`select conrelid::regclass::text as consumer from pg_constraint
    where contype = 'f' and confrelid = 'generated_documents'::regclass
      and conrelid <> 'generated_document_weld_joints'::regclass`)
  if (dependencies.rows.length) throw new Error('Найдены дополнительные зависимости документов. Переход остановлен до проверки резервной копии.')
  await tx.execute(sql`lock table weld_joints, line_programs, generated_documents, generated_document_weld_joints in share row exclusive mode`)
  await tx.execute(sql`insert into line_program_transition_backups (key, value)
    select ${LINE_PROGRAM_BACKUP_PREFIX + 'line-before:'} || id::text, row_to_json(p)::text from line_programs p`)
  // One backup per affected row/document keeps payloads bounded and directly recoverable.
  await tx.execute(sql`insert into line_program_transition_backups (key, value)
    select ${LINE_PROGRAM_BACKUP_PREFIX + 'weld:'} || id::text,
      json_build_object('id', id, 'line_program_id', line_program_id, 'category', category, 'group_name', group_name,
        'weld_control_percent', weld_control_percent, 'pvk_control_percent', pvk_control_percent, 'has_vik', has_vik)::text
    from weld_joints`)
  await tx.execute(sql`insert into line_program_transition_backups (key, value)
    select ${LINE_PROGRAM_BACKUP_PREFIX + 'document:'} || d.id::text,
      json_build_object('document', row_to_json(d), 'assignments', coalesce(a.links, '[]'::json))::text
    from generated_documents d
    left join lateral (select json_agg(row_to_json(link)) as links from generated_document_weld_joints link where link.document_id = d.id) a on true
    where d.type in ('layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers')
      and d.source_metadata = ${JSON.stringify({ kind: 'layeredControl', version: 1 })}`)
  await tx.execute(sql`with grouped as (
    select lower(btrim(coalesce(project_title, ''))) as project_key,
      lower(btrim(coalesce(subtitle_code, ''))) as subtitle_key, lower(btrim(line)) as line_key,
      min(btrim(coalesce(project_title, ''))) as project_title, min(btrim(coalesce(subtitle_code, ''))) as subtitle_code, min(btrim(line)) as line,
      case when count(distinct lower(btrim(coalesce(category, '')))) = 1 then nullif(min(btrim(category)), '') end as category,
      case when count(distinct lower(btrim(coalesce(group_name, '')))) = 1 then nullif(min(btrim(group_name)), '') end as group_name,
      case when count(distinct coalesce(weld_control_percent::text, 'unknown')) = 1
        and min(weld_control_percent) between 0 and 100 then min(weld_control_percent) end as percent,
      count(distinct lower(btrim(coalesce(category, '')))) > 1 or
        count(distinct lower(btrim(coalesce(group_name, '')))) > 1 or
        count(distinct coalesce(weld_control_percent::text, 'unknown')) > 1 as conflict
    from weld_joints where nullif(btrim(line), '') is not null
    group by lower(btrim(coalesce(project_title, ''))), lower(btrim(coalesce(subtitle_code, ''))), lower(btrim(line)))
    insert into line_programs (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent, configuration_issue)
    select project_title, subtitle_code, line, category, group_name, percent, percent,
      case when conflict then 'СП-02: противоречивые исходные требования. Настройте программу линии.'
        when category is null or group_name is null or percent is null then 'СП-02: неполные исходные требования. Настройте программу линии.' end
    from grouped on conflict do nothing`)
  await tx.execute(sql`update weld_joints w set line_program_id = p.id, category = p.category, group_name = p.group_name,
    weld_control_percent = p.weld_control_percent, pvk_control_percent = p.pvk_control_percent, has_vik = 'да', updated_at = now()
    from line_programs p where lower(btrim(coalesce(w.project_title, ''))) = lower(btrim(p.project_title))
      and lower(btrim(coalesce(w.subtitle_code, ''))) = lower(btrim(p.subtitle_code)) and lower(btrim(w.line)) = lower(btrim(p.line))`)
  await tx.execute(sql`update weld_joints set has_vik = 'да', updated_at = now() where has_vik is distinct from 'да'`)
  await tx.execute(sql`delete from generated_documents d where d.type in ('layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers')
    and d.source_metadata = ${JSON.stringify({ kind: 'layeredControl', version: 1 })}
    and exists (select 1 from line_program_transition_backups b where b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'document:'} || d.id::text)
    and not exists (select 1 from generated_document_weld_joints a join weld_joints w on w.id = a.weld_joint_id
      where a.document_id = d.id and w.layered_control_assigned)`)
  // Recovery is allowed only while these rows/programs still have exactly this checkpoint.
  await tx.execute(sql`update line_program_transition_backups b set value =
    (b.value::jsonb || jsonb_build_object('afterUpdatedAt', w.updated_at))::text
    from weld_joints w where b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'weld:'} || w.id::text`)
  await tx.execute(sql`insert into line_program_transition_backups (key, value)
    select ${LINE_PROGRAM_BACKUP_PREFIX + 'line-after:'} || id::text, row_to_json(p)::text from line_programs p`)
  await tx.insert(appSettings).values({ key: LINE_PROGRAM_TRANSITION_KEY, value: JSON.stringify({ status: 'complete', completedAt: new Date().toISOString(), backupPrefix: LINE_PROGRAM_BACKUP_PREFIX }) })
  await markDispatcherTaskIndexDirty(tx, { fullRebuild: true })
  return { skipped: false }
}

/** Maintenance rollback of this transition, not a general rollback of later user work. */
export async function restoreLineProgramTransition(tx: SystemDocumentSequenceTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LINE_PROGRAM_TRANSITION_KEY}))`)
  const [marker] = await tx.select().from(appSettings).where(eq(appSettings.key, LINE_PROGRAM_TRANSITION_KEY)).limit(1)
  if (!marker) throw new Error('Нет завершённого перехода для восстановления.')
  if (JSON.parse(marker.value).status === 'restored') return { skipped: true }
  await tx.execute(sql`lock table weld_joints, line_programs, generated_documents, generated_document_weld_joints in share row exclusive mode`)
  const changed = await tx.execute(sql`select 1 from line_program_transition_backups b
    left join weld_joints w on b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'weld:'} || w.id::text
    where b.key like ${LINE_PROGRAM_BACKUP_PREFIX + 'weld:%'}
      and (w.id is null or b.value::jsonb ->> 'afterUpdatedAt' is null
        or (b.value::jsonb ->> 'afterUpdatedAt')::timestamptz is distinct from w.updated_at)
    union all
    select 1 from line_program_transition_backups b left join line_programs p
      on b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'line-after:'} || p.id::text
    where b.key like ${LINE_PROGRAM_BACKUP_PREFIX + 'line-after:%'} and b.value::jsonb is distinct from to_jsonb(p)
    union all
    select 1 from weld_joints w where not exists (select 1 from line_program_transition_backups b
      where b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'weld:'} || w.id::text)
    union all
    select 1 from line_programs p where not exists (select 1 from line_program_transition_backups b
      where b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'line-after:'} || p.id::text)
    limit 1`)
  if (changed.rows.length) throw new Error('После перехода данные изменились. Автоматическое восстановление остановлено: нельзя затереть последующую работу.')
  const documentsChanged = await tx.execute(sql`select 1 from line_program_transition_backups b
    join generated_documents d on d.id = (b.value::jsonb -> 'document' ->> 'id')::integer
    where b.key like ${LINE_PROGRAM_BACKUP_PREFIX + 'document:%'} and to_jsonb(d) is distinct from b.value::jsonb -> 'document'
    limit 1`)
  if (documentsChanged.rows.length) throw new Error('Резервные документы изменились после перехода. Требуется отдельная проверка восстановления.')
  const linksChanged = await tx.execute(sql`select 1 from line_program_transition_backups b
    join generated_documents d on d.id = (b.value::jsonb -> 'document' ->> 'id')::integer
    where b.key like ${LINE_PROGRAM_BACKUP_PREFIX + 'document:%'} and (
      exists (select 1 from generated_document_weld_joints a where a.document_id = d.id
        and not exists (select 1 from jsonb_array_elements(b.value::jsonb -> 'assignments') original where original = to_jsonb(a)))
      or exists (select 1 from jsonb_array_elements(b.value::jsonb -> 'assignments') original
        where not exists (select 1 from generated_document_weld_joints a where a.document_id = d.id and to_jsonb(a) = original)))
    limit 1`)
  if (linksChanged.rows.length) throw new Error('Связи резервных документов изменились после перехода. Автоматическое восстановление остановлено.')
  await tx.execute(sql`insert into generated_documents select restored.*
    from line_program_transition_backups b cross join lateral jsonb_populate_record(null::generated_documents, b.value::jsonb -> 'document') restored
    where b.key like ${LINE_PROGRAM_BACKUP_PREFIX + 'document:%'}
      and not exists (select 1 from generated_documents d where d.id = restored.id)`)
  await tx.execute(sql`insert into generated_document_weld_joints select restored.*
    from line_program_transition_backups b cross join lateral jsonb_populate_recordset(null::generated_document_weld_joints, b.value::jsonb -> 'assignments') restored
    where b.key like ${LINE_PROGRAM_BACKUP_PREFIX + 'document:%'}
      and not exists (select 1 from generated_document_weld_joints a where a.document_id = restored.document_id and a.weld_joint_id = restored.weld_joint_id)`)
  await tx.execute(sql`update weld_joints w set
    line_program_id = (b.value::jsonb ->> 'line_program_id')::integer,
    category = b.value::jsonb ->> 'category', group_name = b.value::jsonb ->> 'group_name',
    weld_control_percent = (b.value::jsonb ->> 'weld_control_percent')::numeric,
    pvk_control_percent = (b.value::jsonb ->> 'pvk_control_percent')::numeric,
    has_vik = b.value::jsonb ->> 'has_vik', updated_at = now()
    from line_program_transition_backups b where b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'weld:'} || w.id::text`)
  await tx.execute(sql`delete from line_programs p where exists (select 1 from line_program_transition_backups b
    where b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'line-after:'} || p.id::text)
    and not exists (select 1 from line_program_transition_backups b where b.key = ${LINE_PROGRAM_BACKUP_PREFIX + 'line-before:'} || p.id::text)`)
  await tx.update(appSettings).set({ value: JSON.stringify({ status: 'restored', restoredAt: new Date().toISOString(), backupPrefix: LINE_PROGRAM_BACKUP_PREFIX }), updatedAt: new Date() })
    .where(eq(appSettings.key, LINE_PROGRAM_TRANSITION_KEY))
  await markDispatcherTaskIndexDirty(tx, { fullRebuild: true })
  return { skipped: false }
}
