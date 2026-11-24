import { eq, sql, type SQL } from 'drizzle-orm'
import { appSettings, generatedDocuments, weldJoints } from '@/db/schema'
import { SYSTEM_DOCUMENT_IDENTITY_TRANSITION_KEY } from '@/lib/release-contract'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '@/lib/system-document-template-types'
import { auditSql } from './audit-functions'
import { lockSystemDocumentIndexes } from './system-document-index'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Caller owns the transaction and (for a rename) the changed weld locks.
 * Refresh only derived registry identities, never document names/history or
 * memberships. Aggregate ALL members of each affected document, not just the
 * renamed line. No queries or metadata copies per weld/document in JS.
 */
export async function refreshSystemDocumentIdentityMetadata(
  tx: SystemDocumentSequenceTransaction,
  lineProgramId?: number,
) {
  await lockSystemDocumentIndexes(tx)
  const scope = sql`${generatedDocuments.type} = any(${sql.param(SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map(p => `system:${p.id}`))}::text[])
    ${lineProgramId === undefined ? sql`` : sql`and exists (
      select 1 from generated_document_weld_joints a
      join ${weldJoints} on ${weldJoints.id} = a.weld_joint_id
      where a.document_id = ${generatedDocuments.id} and ${weldJoints.lineProgramId} = ${lineProgramId}
    )`}`
  const values = (column: SQL) => sql`coalesce(jsonb_agg(distinct btrim(${column}) order by btrim(${column}))
    filter (where nullif(btrim(${column}), '') is not null), '[]'::jsonb)`
  const result = await auditSql(tx, [{ table: generatedDocuments, where: scope }], () => tx.execute(sql`
    with targets as materialized (
      select ${generatedDocuments.id} as id,
        coalesce(nullif(${generatedDocuments.sourceMetadata}, ''), '{}')::jsonb as metadata
      from ${generatedDocuments} where ${scope}
      order by ${generatedDocuments.id} for update
    ), identities as (
      select t.id, jsonb_build_object(
        'projects', ${values(sql`w.project_title`)},
        'subtitleCodes', ${values(sql`w.subtitle_code`)},
        'lines', ${values(sql`w.line`)}
      ) as value
      from targets t
      join generated_document_weld_joints a on a.document_id = t.id
      join weld_joints w on w.id = a.weld_joint_id
      group by t.id
    ), updated as (
      update generated_documents d
      set source_metadata = (t.metadata || i.value)::text,
        updated_at = greatest(clock_timestamp(), d.updated_at + interval '1 millisecond')
      from targets t join identities i on i.id = t.id
      where d.id = t.id and jsonb_typeof(t.metadata) = 'object'
        and not (t.metadata @> i.value and i.value @> jsonb_build_object(
          'projects', t.metadata -> 'projects',
          'subtitleCodes', t.metadata -> 'subtitleCodes',
          'lines', t.metadata -> 'lines'
        ))
      returning d.id
    )
    select (select count(*)::integer from updated) as updated,
      (select count(*)::integer from targets where jsonb_typeof(metadata) <> 'object') as invalid
  `))
  if (Number(result.rows[0]?.invalid)) {
    throw new Error('Некорректные метаданные системных документов. Обновление отменено; требуется проверка данных.')
  }
  return Number(result.rows[0]?.updated ?? 0)
}

/** One-time data repair in the existing explicit release transaction only.
 * A page read or application restart must never initiate this transition.
 */
export async function prepareSystemDocumentIdentityMetadata(tx: SystemDocumentSequenceTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${SYSTEM_DOCUMENT_IDENTITY_TRANSITION_KEY}))`)
  const [marker] = await tx.select().from(appSettings).where(eq(appSettings.key, SYSTEM_DOCUMENT_IDENTITY_TRANSITION_KEY)).limit(1)
  if (marker) {
    if (marker.value !== 'complete') throw new Error('Неизвестное состояние исправления реквизитов документов. Выпуск остановлен.')
    return { skipped: true, updated: 0 }
  }
  const updated = await refreshSystemDocumentIdentityMetadata(tx)
  await tx.insert(appSettings).values({ key: SYSTEM_DOCUMENT_IDENTITY_TRANSITION_KEY, value: 'complete' })
  return { skipped: false, updated }
}
