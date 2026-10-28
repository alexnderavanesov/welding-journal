import { sql, type SQL } from 'drizzle-orm'
import { generatedDocuments } from '@/db/schema'
import { GENERATED_DOCUMENT_TYPES } from '@/lib/generated-document-types'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

// An editor token, not a persistent business revision or an export field.
export const DOCUMENT_VERSION_SELECT = sql<string>`${generatedDocuments}.xmin::text`

/** Link-only writers must lock/touch parents BEFORE changing their children.
 * One scoped statement, including legacy shared layered documents. No backfill.
 */
export async function touchDocumentMembershipParents(tx: Pick<SystemDocumentSequenceTransaction, 'execute'>, documentIds: readonly number[]) {
  if (!documentIds.length) return
  await touchParents(tx, sql`${generatedDocuments.id} = any(${sql.param([...new Set(documentIds)])}::integer[])`)
}

/** Capture parents before FK cascades erase the links used to find them. */
export async function touchEditableDocumentParentsForWeldDeletion(tx: Pick<SystemDocumentSequenceTransaction, 'execute'>, weldIds: readonly number[]) {
  // A removed membership invalidates both manual delete confirmations and layered editors.
  await touchParentsForWelds(tx, weldIds, GENERATED_DOCUMENT_TYPES)
}

/** Run after system-index locks, before the cascade. Also covers old sourced
 * parents whose metadata cannot identify the deleted position reliably.
 */
export async function touchSystemDocumentParentsForWeldDeletion(tx: Pick<SystemDocumentSequenceTransaction, 'execute'>, weldIds: readonly number[]) {
  await touchParentsForWelds(tx, weldIds, ['system:lnkConclusionVik', 'system:lnkConclusionRk',
    'system:lnkConclusionPvk', 'system:lnkConclusionUzk', 'system:pstoConclusion', 'system:tvmtConclusion'])
}

async function touchParentsForWelds(tx: Pick<SystemDocumentSequenceTransaction, 'execute'>, weldIds: readonly number[], types: readonly string[]) {
  if (!weldIds.length) return
  await touchParents(tx, sql`${generatedDocuments.type} = any(${sql.param([...types])}::text[])
    and exists(select 1 from generated_document_weld_joints a
      where a.document_id = ${generatedDocuments.id} and a.weld_joint_id = any(${sql.param([...new Set(weldIds)])}::integer[]))`)
}

async function touchParents(tx: Pick<SystemDocumentSequenceTransaction, 'execute'>, where: SQL) {
  await tx.execute(sql`update ${generatedDocuments} as d
    set updated_at = greatest(clock_timestamp(), d.updated_at + interval '1 millisecond')
    from (select ${generatedDocuments.id} from ${generatedDocuments}
      where ${where} order by ${generatedDocuments.id} for update) locked
    where d.id = locked.id`)
}
