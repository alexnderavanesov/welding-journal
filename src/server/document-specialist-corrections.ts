import { sql } from 'drizzle-orm'
import { inheritDocumentSpecialists, type DocumentSpecialists } from '@/lib/document-specialists'
import { lockLayeredControlDocumentsForWeldChange } from './layered-control-documents'
import { lockSystemDocumentIndexes } from './system-document-index'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { writeDocumentSpecialists } from './specialists'

type Document = { id: number; type: string; title: string; date: string; snapshot: DocumentSpecialists | null; revision: number; positions: string[]; total: number; membership?: string }
const types = ['system:lnkConclusionVik', 'system:lnkConclusionRk', 'system:lnkConclusionPvk', 'system:lnkConclusionUzk', 'system:pstoConclusion', 'system:tvmtConclusion']

/** Narrow, batched snapshot of the touched positions, including individual cycles.
 * Run before a correction removes/recreates documents, never for a stage transfer.
 */
export async function captureCorrectedDocumentSpecialists(tx: SystemDocumentSequenceTransaction, rowIds: number[]) {
  if (!rowIds.length) return { rowIds, documents: [] as Document[] }
  await lockLayeredControlDocumentsForWeldChange(tx)
  await lockSystemDocumentIndexes(tx)
  return { rowIds, documents: await loadDocuments(tx, rowIds) }
}

async function loadDocuments(tx: SystemDocumentSequenceTransaction, rowIds: number[]): Promise<Document[]> {
  const metadata = sql`coalesce(nullif(d.source_metadata, ''), '{}')::jsonb`
  const positions = sql`case when jsonb_typeof(${metadata}->'sourcePositions')='array' then ${metadata}->'sourcePositions' else '[]'::jsonb end`
  const result = await tx.execute(sql`select d.id, d.type, d.title, coalesce(d.period_from::text, '') as date,
    d.specialists as snapshot, d.specialists_revision as revision,
    md5(${positions}::text || coalesce((select string_agg(a.weld_joint_id::text, ',' order by a.weld_joint_id)
      from generated_document_weld_joints a where a.document_id=d.id), '')) as membership,
    case when jsonb_array_length(${positions}) > 0
      then jsonb_array_length(${positions}) else d.row_count end as total,
    case when jsonb_array_length(${positions}) > 0 then
      array(select concat_ws(':', d.type, p->>'weldJointId',
        case when p->>'kind'='beforeHeatTreatment' then 'beforeHeatTreatment' else 'cycle' end,
        coalesce(p->>'sequence', '1'))
        from jsonb_array_elements(${positions}) p
        where (p->>'weldJointId')::integer=any(${sql.param(rowIds)}::integer[]) order by 1)
      else array(select concat_ws(':', d.type, a.weld_joint_id,
        case when d.type in ('system:pstoConclusion','system:tvmtConclusion') then 'cycle' else '' end, '1')
        from generated_document_weld_joints a where a.document_id=d.id and a.weld_joint_id=any(${sql.param(rowIds)}::integer[]) order by 1)
      end as positions
    from generated_documents d where d.type=any(${sql.param(types)}::text[])
      and exists(select 1 from generated_document_weld_joints a where a.document_id=d.id and a.weld_joint_id=any(${sql.param(rowIds)}::integer[]))
    order by d.id for update of d`)
  return result.rows as Document[]
}

export function planCorrectedDocumentSpecialists(before: Document[], after: Document[]) {
  const byPosition = new Map<string, Map<number, Document>>()
  for (const document of before) for (const position of document.positions) {
    const sources = byPosition.get(position) ?? new Map<number, Document>()
    sources.set(document.id, document); byPosition.set(position, sources)
  }
  return after.flatMap(document => {
    const sources = new Map<number, Document>()
    for (const position of document.positions) for (const source of byPosition.get(position)?.values() ?? []) sources.set(source.id, source)
    if (!sources.size) return []
    // A destination may already contain other welds. Its existing blank pair is
    // also a real assignment state, not permission to overwrite silently.
    if (!sources.has(document.id) && (document.total > document.positions.length || document.snapshot?.first || document.snapshot?.second)) sources.set(document.id, document)
    const inherited = inheritDocumentSpecialists([...sources.values()].map(source => source.snapshot))
    const unchanged = !inheritDocumentSpecialists([document.snapshot, inherited.snapshot]).conflict
    return unchanged && !inherited.conflict ? [] : [{ document, sources: [...sources.values()], ...inherited }]
  })
}

export async function restoreCorrectedDocumentSpecialists(tx: SystemDocumentSequenceTransaction, captured: Awaited<ReturnType<typeof captureCorrectedDocumentSpecialists>>, confirmation?: string) {
  if (!captured.documents.length) return
  // This helper is reachable from shared dialog imports in development. Load
  // Node crypto only inside the server operation, never while opening a dialog.
  const { createHash } = await import('node:crypto')
  const changes = planCorrectedDocumentSpecialists(captured.documents, await loadDocuments(tx, captured.rowIds))
  const conflicts = changes.filter(change => change.conflict)
  // Newly recreated IDs/timestamps vary after a rollback. Bind consent to the
  // original versions, exact resulting identities and positions instead.
  const fingerprint = createHash('sha256').update(JSON.stringify(conflicts.map(change => ({
    type: change.document.type, title: change.document.title, date: change.document.date, positions: change.document.positions, total: change.document.total, membership: change.document.membership,
    sources: change.sources.map(source => ({ type: source.type, title: source.title, date: source.date, revision: source.revision, snapshot: source.snapshot, positions: source.positions, total: source.total, membership: source.membership })),
  })))).digest('hex')
  if (conflicts.length && confirmation !== fingerprint) throw new Error(`Исправление объединяет заключения с разными специалистами или удостоверениями. После подтверждения обе роли объединённых документов будут очищены. Пока ничего не сохранено. [specialist-confirmation:${fingerprint}]`)
  await writeDocumentSpecialists(tx, changes.map(change => ({ id: change.document.id, snapshot: change.snapshot })))
}
