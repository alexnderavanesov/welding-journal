import { and, eq, or, sql } from 'drizzle-orm'
import { lineSchemeAnnotations, lineSchemeDimensions, lineSchemePoints } from '@/db/schema'
import { schemeDimensionEnds, type SchemeDimensionChanges } from '@/lib/line-schemes'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Called after point writes in the same locked revision transaction. Any
 * invalid endpoint rolls the points and all dimensions back together. */
export async function saveSchemeDimensions(tx: SystemDocumentSequenceTransaction, revisionId: string, changes: SchemeDimensionChanges | undefined, movedPages: string[], movedAnnotations: string[] = []) {
  const upsert = changes?.upsert ?? [], remove = changes?.remove ?? []
  const ids = [...upsert.map(item => item.id), ...remove]
  const existing = ids.length ? await tx.select().from(lineSchemeDimensions).where(sql`${lineSchemeDimensions.id} = any(${sql.param(ids)}::text[])`) : []
  if (existing.some(item => item.revisionId !== revisionId)) throw new Error('Размер относится к другой редакции.')
  const byId = new Map(existing.map(item => [item.id, item]))
  for (const item of upsert) {
    const prior = byId.get(item.id)
    if (prior && (schemeDimensionEnds(prior).join() !== schemeDimensionEnds(item).join())) throw new Error('Нельзя перепривязать размер к другим точкам.')
  }
  // A direct API move to a different sheet cannot strand a saved dimension.
  const affected = movedPages.length || movedAnnotations.length ? await tx.select().from(lineSchemeDimensions).where(and(eq(lineSchemeDimensions.revisionId, revisionId), or(
    sql`${lineSchemeDimensions.fromPointId} = any(${sql.param(movedPages)}::text[])`, sql`${lineSchemeDimensions.toPointId} = any(${sql.param(movedPages)}::text[])`,
    sql`${lineSchemeDimensions.fromAnnotationId} = any(${sql.param(movedAnnotations)}::text[])`, sql`${lineSchemeDimensions.toAnnotationId} = any(${sql.param(movedAnnotations)}::text[])`,
  ))) : []
  const removed = new Set(remove), changing = new Set(upsert.map(item => item.id))
  const checked = [...upsert, ...affected.filter(item => !removed.has(item.id) && !changing.has(item.id))]
  const pointIds = [...new Set(checked.flatMap(item => [item.fromPointId, item.toPointId].filter((id): id is string => !!id)))]
  const points = pointIds.length ? await tx.select({ id: lineSchemePoints.id, revisionId: lineSchemePoints.revisionId, page: lineSchemePoints.page }).from(lineSchemePoints)
    .where(sql`${lineSchemePoints.id} = any(${sql.param(pointIds)}::text[])`) : []
  const annotationIds = [...new Set(checked.flatMap(item => [item.fromAnnotationId, item.toAnnotationId].filter((id): id is string => !!id)))]
  const annotations = annotationIds.length ? await tx.select({ id: lineSchemeAnnotations.id, revisionId: lineSchemeAnnotations.revisionId, page: lineSchemeAnnotations.page }).from(lineSchemeAnnotations)
    .where(sql`${lineSchemeAnnotations.id} = any(${sql.param(annotationIds)}::text[])`) : []
  const endpoints = new Map<string, { id: string; revisionId: string; page: number }>([...points.map(point => [`p:${point.id}`, point] as const), ...annotations.map(a => [`a:${a.id}`, a] as const)])
  for (const item of checked) {
    const [from, to] = schemeDimensionEnds(item), a = endpoints.get(from), b = endpoints.get(to)
    if (!a || !b || a.revisionId !== revisionId || b.revisionId !== revisionId || a.page !== item.page || b.page !== item.page) throw new Error('Размер должен соединять две существующие точки одного листа этой редакции.')
  }
  if (remove.length) await tx.delete(lineSchemeDimensions).where(and(eq(lineSchemeDimensions.revisionId, revisionId), sql`${lineSchemeDimensions.id} = any(${sql.param(remove)}::text[])`))
  for (let offset = 0; offset < upsert.length; offset += 1000) {
    const batch = upsert.slice(offset, offset + 1000)
    const saved = await tx.insert(lineSchemeDimensions).values(batch.map(item => ({ ...item, revisionId }))).onConflictDoUpdate({ target: lineSchemeDimensions.id,
      set: { page: sql`excluded.page`, distanceMm: sql`excluded.distance_mm`, offsetX: sql`excluded.offset_x`, offsetY: sql`excluded.offset_y`, color: sql`excluded.color`, strokeWidth: sql`excluded.stroke_width` },
      setWhere: and(eq(lineSchemeDimensions.revisionId, revisionId), sql`${lineSchemeDimensions.fromPointId} is not distinct from excluded.from_point_id`, sql`${lineSchemeDimensions.toPointId} is not distinct from excluded.to_point_id`, sql`${lineSchemeDimensions.fromAnnotationId} is not distinct from excluded.from_annotation_id`, sql`${lineSchemeDimensions.toAnnotationId} is not distinct from excluded.to_annotation_id`),
    }).returning({ id: lineSchemeDimensions.id })
    if (saved.length !== batch.length) throw new Error('Идентификатор размера уже занят другой разметкой. Изменения не сохранены.')
  }
}
