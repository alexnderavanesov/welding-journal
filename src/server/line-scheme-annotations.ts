import { and, eq, sql } from 'drizzle-orm'
import { lineSchemeAnnotations } from '@/db/schema'
import type { SchemeChanges } from '@/lib/line-schemes'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** The caller holds the revision lock; annotations and dimensions commit together. */
export async function saveSchemeAnnotations(tx: SystemDocumentSequenceTransaction, revisionId: string, changes: SchemeChanges['annotations']) {
  if (!changes) return []
  const ids = [...changes.upsert.map(a => a.id), ...changes.remove]
  const existing = ids.length ? await tx.select({ id: lineSchemeAnnotations.id, revisionId: lineSchemeAnnotations.revisionId, page: lineSchemeAnnotations.page }).from(lineSchemeAnnotations)
    .where(sql`${lineSchemeAnnotations.id} = any(${sql.param(ids)}::text[])`) : []
  if (existing.some(a => a.revisionId !== revisionId)) throw new Error('Обозначение относится к другой редакции.')
  const prior = new Map(existing.map(a => [a.id, a]))
  if (changes.remove.length) await tx.delete(lineSchemeAnnotations).where(and(eq(lineSchemeAnnotations.revisionId, revisionId), sql`${lineSchemeAnnotations.id} = any(${sql.param(changes.remove)}::text[])`))
  for (let offset = 0; offset < changes.upsert.length; offset += 1000) {
    const batch = changes.upsert.slice(offset, offset + 1000)
    const result = await tx.insert(lineSchemeAnnotations).values(batch.map(a => ({ id: a.id, revisionId, page: a.page, x: a.x, y: a.y, shape: a.shape, label: a.label.trim(), note: a.note?.trim() ?? '', color: a.color, size: a.size, strokeWidth: a.strokeWidth, rotation: a.rotation })))
      .onConflictDoUpdate({ target: lineSchemeAnnotations.id, set: { page: sql`excluded.page`, x: sql`excluded.x`, y: sql`excluded.y`, shape: sql`excluded.shape`, label: sql`excluded.label`, note: sql`excluded.note`, color: sql`excluded.color`, size: sql`excluded.size`, strokeWidth: sql`excluded.stroke_width`, rotation: sql`excluded.rotation` }, setWhere: eq(lineSchemeAnnotations.revisionId, revisionId) }).returning({ id: lineSchemeAnnotations.id })
    if (result.length !== batch.length) throw new Error('Идентификатор обозначения занят другой редакцией. Изменения не сохранены.')
  }
  return changes.upsert.filter(a => prior.has(a.id) && prior.get(a.id)!.page !== a.page).map(a => a.id)
}
