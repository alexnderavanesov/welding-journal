import { sql } from 'drizzle-orm'
import { generatedDocuments } from '@/db/schema'
import { documentOperationIdentity } from '@/lib/system-document-operation'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { getSystemDocumentTemplateId, SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '@/lib/system-document-template-types'
import { lockLayeredControlDocumentsForWeldChange } from './layered-control-documents'
import { initializeSystemDocumentIndexesInTransaction, lockSystemDocumentIndexes } from './system-document-index'
import { requireDb } from '@/db'
import type { DocumentGroupingCommand } from '@/lib/document-grouping-command'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Cold index initialization takes its own locks before the mutation's row locks. */
export async function prepareDocumentCreationIndex(command?: DocumentGroupingCommand) {
  if (command) await requireDb().transaction(initializeSystemDocumentIndexesInTransaction)
}

/** Call after counters and record locks, before any index/name changes. */
export async function assertNewDocumentNamesAvailable(tx: SystemDocumentSequenceTransaction, references: SystemDocumentReference[]) {
  const candidates = references.filter(reference => reference.title.trim())
  if (!candidates.length) return
  await lockLayeredControlDocumentsForWeldChange(tx)
  await lockSystemDocumentIndexes(tx)
  const result = await tx.execute(sql`
    select distinct d.type, d.title, d.period_from::text as date,
      d.source_metadata::jsonb->>'methodCode' as method, d.source_metadata::jsonb->>'sourceKind' as source
    from ${generatedDocuments} d join jsonb_to_recordset(${JSON.stringify(candidates.map(r => ({ type: `system:${getSystemDocumentTemplateId(r)}`, date: r.date, name: r.title.trim().toLocaleLowerCase('ru-RU') })))}::jsonb) as n(type text, date date, name text)
      on d.type = n.type and d.period_from = n.date and lower(btrim(d.title)) = n.name
  `)
  const identities = new Set(result.rows.map(row => documentOperationIdentity({ type: SYSTEM_DOCUMENT_TEMPLATE_PROFILES.find(p => `system:${p.id}` === row.type)!.documentType,
    title: String(row.title), date: String(row.date), methodCode: String(row.method ?? '') || undefined, sourceKind: row.source as SystemDocumentReference['sourceKind'],
  }, String(row.title))))
  for (const reference of candidates) if (identities.has(documentOperationIdentity(reference, reference.title))) throw new Error(`Название «${reference.title}» уже занято документом этого вида и даты. Выберите другое имя или явно добавьте позиции в существующую заявку.`)
}
