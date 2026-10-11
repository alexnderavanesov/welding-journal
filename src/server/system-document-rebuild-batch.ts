import { sql } from 'drizzle-orm'
import { generatedDocuments, weldJoints, pstoRepeatCycles, preHeatTreatmentControls } from '@/db/schema'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES, getSystemDocumentTemplateId, type SystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { getSystemDocumentNumber, type SystemDocumentReference } from '@/lib/system-document-types'
import { REBUILD_FACT_BYTES_LIMIT } from '@/lib/system-document-rebuild-batch'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'

const storageTypes = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map(profile => `system:${profile.id}`)
const metadata = sql`coalesce(${generatedDocuments.sourceMetadata}, '{}')::jsonb`
const systemScope = sql`${generatedDocuments.type} = any(${sql.param(storageTypes)}::text[])`

/** Stream global identity/number information only, never global weld facts or positions. */
export async function* readRebuildIdentities(tx: SystemDocumentSequenceTransaction, templateIds?: readonly SystemDocumentTemplateId[]) {
  const scope = templateIds ? sql`${generatedDocuments.type} = any(${sql.param(templateIds.map(id => `system:${id}`))}::text[])` : systemScope
  let afterId = 0
  const throughId = Number((await tx.execute(sql`select coalesce(max(${generatedDocuments.id}), 0) as id from ${generatedDocuments} where ${scope}`)).rows[0]?.id ?? 0)
  while (true) {
    const result = await tx.execute(sql`
      select ${generatedDocuments.id} as "documentId", ${generatedDocuments.type} as "storageType",
        ${generatedDocuments.title} as title, coalesce(${generatedDocuments.periodFrom}::text, '') as date,
        ${metadata}->>'methodCode' as "methodCode", ${metadata}->>'sourceKind' as "sourceKind",
        coalesce(${metadata}->'projects', '[]'::jsonb) as projects,
        coalesce(${metadata}->'subtitleCodes', '[]'::jsonb) as "subtitleCodes",
        coalesce(${metadata}->'lines', '[]'::jsonb) as lines
      from ${generatedDocuments} where ${scope} and ${generatedDocuments.id} > ${afterId} and ${generatedDocuments.id} <= ${throughId}
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

export async function loadRebuildOccupiedNumbers(tx: SystemDocumentSequenceTransaction, settings: RequestConclusionSettings, templateIds?: readonly SystemDocumentTemplateId[]) {
  const result = new Map<SystemDocumentTemplateId, Set<number>>()
  for await (const document of readRebuildIdentities(tx, templateIds)) {
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
export async function assertRebuildFactBudget(tx: SystemDocumentSequenceTransaction, rowIds: number[], cycleIds: number[] = [], controlIds: number[] = []) {
  const result = await tx.execute(sql`
    select coalesce((select sum(octet_length(jsonb_strip_nulls(to_jsonb(w))::text)) from ${weldJoints} w
      where ${buildNumberArrayMatch(sql`w.id`, rowIds)}), 0) +
      coalesce((select sum(octet_length(jsonb_strip_nulls(to_jsonb(c))::text)) from ${pstoRepeatCycles} c
      where ${buildNumberArrayMatch(sql`c.id`, cycleIds)}), 0) +
      coalesce((select sum(octet_length(to_jsonb(c)::text)) from ${preHeatTreatmentControls} c
      where ${buildNumberArrayMatch(sql`c.id`, controlIds)}), 0) as bytes
  `)
  if (Number(result.rows[0]?.bytes ?? 0) > REBUILD_FACT_BYTES_LIMIT) {
    throw new Error('Объём фактов этого пакета превышает безопасные 64 МиБ. Документы не изменены и не обрезаны. Уменьшите выбор документов.')
  }
}
