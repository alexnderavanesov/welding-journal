import { and, asc, inArray, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { generatedDocuments } from '@/db/schema'
import { inheritDocumentSpecialists, type DocumentSpecialists } from '@/lib/document-specialists'
import { lockLayeredControlDocumentsForWeldChange } from './layered-control-documents'
import { lockSystemDocumentIndexes } from './system-document-index'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { writeDocumentSpecialists } from './specialists'

type Transfer = { type: string; title: string; date: string; targetStage: string; snapshot: DocumentSpecialists }
const conclusionTypes = ['system:lnkConclusionVik', 'system:lnkConclusionRk', 'system:lnkConclusionPvk', 'system:lnkConclusionUzk']

/** Capture before index synchronization can remove the source document. */
export async function planTransferredSpecialists(tx: Pick<SystemDocumentSequenceTransaction, 'select'>, rowIds: number[], target: 'primary' | 'beforeHeatTreatment', lock = false) {
  const sourceStage = target === 'primary' ? 'beforeHeatTreatment' : ''
  const targetStage = target === 'primary' ? '' : 'beforeHeatTreatment'
  const stage = sql<string>`coalesce(nullif(${generatedDocuments.sourceMetadata}, '')::jsonb->>'sourceKind', '')`
  const member = sql<boolean>`exists(select 1 from generated_document_weld_joints a where a.document_id = ${generatedDocuments.id} and a.weld_joint_id = any(${sql.param(rowIds)}::integer[]))`
  const metadata = sql`coalesce(nullif(${generatedDocuments.sourceMetadata}, ''), '{}')::jsonb`
  const positions = sql`case when jsonb_typeof(${metadata}->'sourcePositions') = 'array' then ${metadata}->'sourcePositions' else '[]'::jsonb end`
  // Hash ALL members, not just moved rows or their count. Include exact source
  // positions (relation IDs/methods/cycles); sorting ignores array order only.
  // The one query returns a fixed-size digest per document, never full weld rows.
  const membership = sql<string>`encode(sha256(convert_to(jsonb_build_array(
    coalesce((select jsonb_agg(a.weld_joint_id order by a.weld_joint_id)
      from generated_document_weld_joints a where a.document_id = ${generatedDocuments.id}), '[]'::jsonb),
    coalesce((select jsonb_agg(p.value order by p.value)
      from jsonb_array_elements(${positions}) as p(value)), '[]'::jsonb)
  )::text, 'UTF8')), 'hex')`
  const query = tx.select({ id: generatedDocuments.id, type: generatedDocuments.type, title: generatedDocuments.title, date: generatedDocuments.periodFrom,
    revision: generatedDocuments.specialistsRevision, updatedAt: generatedDocuments.updatedAt,
    snapshot: generatedDocuments.specialists, stage, member, membership }).from(generatedDocuments).where(and(
    inArray(generatedDocuments.type, conclusionTypes),
    sql`((${stage} = ${sourceStage} and ${member}) or ${stage} = ${targetStage})`,
    sql`exists(select 1 from generated_documents s join generated_document_weld_joints a on a.document_id=s.id
      where a.weld_joint_id=any(${sql.param(rowIds)}::integer[]) and coalesce(nullif(s.source_metadata, '')::jsonb->>'sourceKind', '')=${sourceStage}
      and s.type=${generatedDocuments.type} and s.title=${generatedDocuments.title} and s.period_from is not distinct from ${generatedDocuments.periodFrom})`,
  )).orderBy(asc(generatedDocuments.id))
  const documents = await (lock ? query.for('update') : query)
  const groups = new Map<string, typeof documents>()
  for (const document of documents) {
    const key = JSON.stringify([document.type, document.title, document.date])
    const group = groups.get(key) ?? []; group.push(document); groups.set(key, group)
  }
  const transfers: Transfer[] = []
  const conflicts: { title: string; date: string }[] = []
  for (const group of groups.values()) {
    if (!group.some(document => document.stage === sourceStage && document.member)) continue
    const { snapshot, conflict } = inheritDocumentSpecialists(group.map(document => document.snapshot))
    if (conflict) conflicts.push({ title: group[0].title, date: group[0].date ?? '' })
    if (conflict || snapshot.first || snapshot.second) transfers.push({ type: group[0].type, title: group[0].title, date: group[0].date ?? '', targetStage, snapshot })
  }
  const confirmation = createHash('sha256').update(JSON.stringify([target, [...rowIds].sort((a, b) => a - b), documents])).digest('hex')
  return { transfers, conflicts, confirmation }
}

export async function captureTransferredSpecialists(tx: SystemDocumentSequenceTransaction, rowIds: number[], target: 'primary' | 'beforeHeatTreatment', confirmation?: string): Promise<Transfer[]> {
  if (!rowIds.length) return []
  await lockLayeredControlDocumentsForWeldChange(tx)
  await lockSystemDocumentIndexes(tx)
  const plan = await planTransferredSpecialists(tx, rowIds, target, true)
  if (plan.conflicts.length && confirmation !== plan.confirmation) throw new Error('При переносе объединяются заключения с разными специалистами или удостоверениями. Ничего не изменено. Обновите проверку специалистов и подтвердите очистку обеих ролей.')
  return plan.transfers
}

export async function restoreTransferredSpecialists(tx: SystemDocumentSequenceTransaction, transfers: Transfer[]) {
  if (!transfers.length) return
  const result = await tx.execute(sql`select d.id, n.ordinal from generated_documents d
    join jsonb_to_recordset(${JSON.stringify(transfers.map(({ snapshot: _snapshot, ...target }, ordinal) => ({ ...target, ordinal })))}::jsonb)
      as n(type text, title text, date text, "targetStage" text, ordinal integer)
      on d.type=n.type and d.title=n.title and coalesce(d.period_from::text, '')=n.date
      and coalesce(nullif(d.source_metadata, '')::jsonb->>'sourceKind', '')=n."targetStage" order by d.id for update of d`)
  if (result.rows.length !== transfers.length || new Set(result.rows.map(row => Number(row.ordinal))).size !== transfers.length) throw new Error('Не удалось сохранить специалистов переносимых заключений. Ничего не изменено.')
  await writeDocumentSpecialists(tx, result.rows.map(row => ({ id: Number(row.id), snapshot: transfers[Number(row.ordinal)].snapshot })))
}
