import { sql } from 'drizzle-orm'
import { generatedDocuments, generatedDocumentWeldJoints, weldJoints, pstoRepeatCycles } from '@/db/schema'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES, getSystemDocumentTemplateId, type SystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { getSystemDocumentNumber, type SystemDocumentReference } from '@/lib/system-document-types'
import { REBUILD_DOCUMENT_LIMIT, REBUILD_FACT_BYTES_LIMIT, selectRebuildBatch, type RebuildCursor, type RebuildCatalogSize } from '@/lib/system-document-rebuild-batch'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'

const storageTypes = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map(profile => `system:${profile.id}`)
const metadata = sql`coalesce(${generatedDocuments.sourceMetadata}, '{}')::jsonb`
const systemScope = sql`${generatedDocuments.type} = any(${sql.param(storageTypes)}::text[])`

export async function loadRebuildBatch(tx: SystemDocumentSequenceTransaction, requested?: RebuildCursor) {
  const cursor = requested ?? { afterId: 0, throughId: Number((await tx.execute(sql`
    select coalesce(max(${generatedDocuments.id}), 0) as id from ${generatedDocuments} where ${systemScope}
  `)).rows[0]?.id ?? 0) }
  // A cursor never includes newly generated documents from earlier batches.
  // Catalog size checks run in PostgreSQL before returning metadata/positions.
  const rows = await tx.execute(sql`
    select ${generatedDocuments.id} as "documentId", ${generatedDocuments.title} as title,
      greatest(${generatedDocuments.rowCount}, coalesce(jsonb_array_length(${metadata}->'sourcePositions'), 0),
        (select count(*) from ${generatedDocumentWeldJoints} where ${generatedDocumentWeldJoints.documentId} = ${generatedDocuments.id}))::integer as "positionCount",
      (coalesce(octet_length(${generatedDocuments.sourceMetadata}), 0) + octet_length(${generatedDocuments.title}) + octet_length(${generatedDocuments.fileName})) as "metadataBytes"
    from ${generatedDocuments}
    where ${systemScope} and ${generatedDocuments.id} > ${cursor.afterId} and ${generatedDocuments.id} <= ${cursor.throughId}
      and coalesce(${metadata}->>'sourceKind', '') <> 'beforeHeatTreatment'
    order by ${generatedDocuments.id} limit ${REBUILD_DOCUMENT_LIMIT + 1}
  `)
  // First reject/limit by the cheap catalog. Only these bounded candidates can
  // need a fact-size probe; the probe returns numbers, not the underlying data.
  const sizes = rows.rows as RebuildCatalogSize[]
  const preliminary = selectRebuildBatch(sizes, cursor)
  if (preliminary.documentIds.length) {
    const factSizes = await tx.execute(sql`
      select d.id as "documentId",
        coalesce((select sum(octet_length(jsonb_strip_nulls(to_jsonb(w))::text)) from ${generatedDocumentWeldJoints} a
          join ${weldJoints} w on w.id = a.weld_joint_id where a.document_id = d.id), 0) +
        coalesce((select sum(octet_length(jsonb_strip_nulls(to_jsonb(c))::text)) from
          jsonb_array_elements(coalesce(d.source_metadata::jsonb->'sourcePositions', '[]'::jsonb)) p
          join ${pstoRepeatCycles} c on c.id = (p->>'relationId')::integer
          where p->>'kind' = 'pstoRepeat' or (p->>'sequence')::integer >= 2), 0) as bytes
      from ${generatedDocuments} d where ${buildNumberArrayMatch(sql`d.id`, preliminary.documentIds)}
    `)
    const byId = new Map(factSizes.rows.map(row => [Number(row.documentId), Number(row.bytes)]))
    for (const entry of sizes) entry.factBytes = byId.get(entry.documentId)
  }
  // Do not admit unprobed candidates when an oversized one was skipped.
  const lastProbed = Math.max(cursor.afterId, ...preliminary.documentIds, ...preliminary.blocked.map(item => item.documentId))
  const finalSizes = sizes.filter(entry => entry.documentId <= lastProbed)
  const batch = selectRebuildBatch(finalSizes, cursor)
  if (!batch.nextCursor && preliminary.nextCursor) batch.nextCursor = preliminary.nextCursor
  return batch
}

/** Stream global identity/number information only, never global weld facts or positions. */
export async function* readRebuildIdentities(tx: SystemDocumentSequenceTransaction) {
  let afterId = 0
  const throughId = Number((await tx.execute(sql`select coalesce(max(${generatedDocuments.id}), 0) as id from ${generatedDocuments} where ${systemScope}`)).rows[0]?.id ?? 0)
  while (true) {
    const result = await tx.execute(sql`
      select ${generatedDocuments.id} as "documentId", ${generatedDocuments.type} as "storageType",
        ${generatedDocuments.title} as title, coalesce(${generatedDocuments.periodFrom}::text, '') as date,
        ${metadata}->>'methodCode' as "methodCode", ${metadata}->>'sourceKind' as "sourceKind",
        coalesce(${metadata}->'projects', '[]'::jsonb) as projects,
        coalesce(${metadata}->'subtitleCodes', '[]'::jsonb) as "subtitleCodes",
        coalesce(${metadata}->'lines', '[]'::jsonb) as lines
      from ${generatedDocuments} where ${systemScope} and ${generatedDocuments.id} > ${afterId} and ${generatedDocuments.id} <= ${throughId}
      order by ${generatedDocuments.id} limit 1000
    `)
    for (const raw of result.rows) {
      const row = raw as { documentId: number; storageType: string; title: string; date: string; methodCode?: string; sourceKind?: SystemDocumentReference['sourceKind']; projects: string[]; subtitleCodes: string[]; lines: string[] }
      const profile = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.find(profile => `system:${profile.id}` === row.storageType)!
      yield { ...row, type: profile.documentType } satisfies SystemDocumentReference
      afterId = row.documentId
    }
    if (result.rows.length < 1000) break
  }
}

export async function loadRebuildOccupiedNumbers(tx: SystemDocumentSequenceTransaction, settings: RequestConclusionSettings) {
  const result = new Map<SystemDocumentTemplateId, Set<number>>()
  for await (const document of readRebuildIdentities(tx)) {
    const number = Number(getSystemDocumentNumber(document, settings))
    if (!Number.isInteger(number) || number <= 0) continue
    const templateId = getSystemDocumentTemplateId(document)
    const numbers = result.get(templateId) ?? new Set<number>()
    numbers.add(number)
    result.set(templateId, numbers)
  }
  return result
}

/** Protect against unusually wide notes/legacy facts before materializing them in Node. */
export async function assertRebuildFactBudget(tx: SystemDocumentSequenceTransaction, rowIds: number[], cycleIds: number[] = []) {
  const result = await tx.execute(sql`
    select coalesce((select sum(octet_length(jsonb_strip_nulls(to_jsonb(w))::text)) from ${weldJoints} w
      where ${buildNumberArrayMatch(sql`w.id`, rowIds)}), 0) +
      coalesce((select sum(octet_length(jsonb_strip_nulls(to_jsonb(c))::text)) from ${pstoRepeatCycles} c
      where ${buildNumberArrayMatch(sql`c.id`, cycleIds)}), 0) as bytes
  `)
  if (Number(result.rows[0]?.bytes ?? 0) > REBUILD_FACT_BYTES_LIMIT) {
    throw new Error('Объём фактов этого пакета превышает безопасные 64 МиБ. Документы не изменены и не обрезаны. Требуется уменьшить область пересборки; обратитесь к администратору.')
  }
}
