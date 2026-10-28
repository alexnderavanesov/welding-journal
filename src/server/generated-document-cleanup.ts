import { and, eq, notExists, sql } from 'drizzle-orm'
import { generatedDocuments, generatedDocumentWeldJoints } from '@/db/schema'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'

/** Capture memberships before source-position cleanup and FK cascades remove
 * them. Callers already hold the weld/line mutation locks. */
export async function loadGeneratedDocumentIdsForWeldDeletion(
  tx: SystemDocumentSequenceTransaction,
  weldJointIds: readonly number[],
) {
  if (weldJointIds.length === 0) return []
  const rows = await tx.selectDistinct({ id: generatedDocumentWeldJoints.documentId })
    .from(generatedDocumentWeldJoints)
    .where(buildNumberArrayMatch(generatedDocumentWeldJoints.weldJointId, weldJointIds))
  return rows.map(row => row.id)
}

/** Delete only documents emptied by this mutation. Unrelated legacy history
 * is not an implicit cleanup target, even if it has no surviving memberships. */
export async function deleteEmptyGeneratedDocuments(
  tx: SystemDocumentSequenceTransaction,
  documentIds: readonly number[],
) {
  if (documentIds.length === 0) return
  await tx.delete(generatedDocuments).where(and(
    buildNumberArrayMatch(generatedDocuments.id, documentIds),
    notExists(tx.select({ value: sql`1` }).from(generatedDocumentWeldJoints)
      .where(eq(generatedDocumentWeldJoints.documentId, generatedDocuments.id))),
  ))
}
