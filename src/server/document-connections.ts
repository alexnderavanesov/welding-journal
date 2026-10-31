import { createServerFn } from '@tanstack/react-start'
import { eq, or, sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
import { generatedDocuments, generatedDocumentWeldJoints, preHeatTreatmentControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import { getSystemDocumentTemplateId, SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '@/lib/system-document-template-types'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { normalizeSystemDocumentReference } from './system-documents'
import { buildGeneratedDocumentReferenceWhere, matchesSourcedSystemDocumentReference, parseSystemDocumentMetadata } from './system-document-index'
import { requirePermission } from './access-context'
import { documentArea } from './access-document-policy'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

const pageSize = 30
const psto = { code: 'ПСТО', requestKey: 'pstoRequest', requestDateKey: 'pstoRequestDate', conclusionKey: 'heatTreatmentDiagram', conclusionDateKey: 'pstoDate', resultKey: 'pstoResult' } as const
const methods = [...ALL_LNK_FIELD_METHODS, psto]

function storedReference(row: { id: number; type: string; title: string; date: string | null; metadata: unknown }): SystemDocumentReference {
  const profile = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.find(profile => `system:${profile.id}` === row.type)
  if (!profile) throw new Error('Связи доступны для заявок и заключений.')
  const metadata = typeof row.metadata === 'string' ? parseSystemDocumentMetadata(row.metadata) : row.metadata as ReturnType<typeof parseSystemDocumentMetadata>
  const methodCode = row.type.includes('tvmt') ? 'ТВМТ' : metadata?.methodCode
  return { documentId: row.id, type: profile.documentType, title: row.title, date: row.date ?? '', ...(methodCode ? { methodCode } : {}), ...(metadata?.sourceKind ? { sourceKind: metadata.sourceKind } : {}), ...(metadata?.cycleSequences?.length ? { cycleSequences: metadata.cycleSequences } : {}) }
}
async function resolveSource(tx: SystemDocumentSequenceTransaction, reference: SystemDocumentReference) {
  const rows = await tx.select({ id: generatedDocuments.id, type: generatedDocuments.type, title: generatedDocuments.title, date: generatedDocuments.periodFrom, metadata: generatedDocuments.sourceMetadata, rowCount: generatedDocuments.rowCount }).from(generatedDocuments)
    .where(reference.documentId ? eq(generatedDocuments.id, reference.documentId) : or(buildGeneratedDocumentReferenceWhere([reference]), reference.methodCode === 'ТВМТ' ? sql`${generatedDocuments.type} = ${reference.type === 'lnkRequest' ? 'system:lnkRequest' : 'system:lnkConclusionOther'} and ${generatedDocuments.title} = ${reference.title} and coalesce(${generatedDocuments.periodFrom}::text, '') = ${reference.date} and ${generatedDocuments.sourceMetadata}::jsonb->>'methodCode' = 'ТВМТ'` : undefined))
  const candidates = reference.documentId ? rows : rows.filter(row => matchesSourcedSystemDocumentReference(row.metadata, reference) || reference.sourceKind === 'pstoCycle' && !parseSystemDocumentMetadata(row.metadata)?.sourceKind && (!reference.cycleSequences?.length || reference.cycleSequences.every(sequence => sequence === 1)))
  if (candidates.length !== 1) throw new Error('Документ не найден или его состав неоднозначен. Обновите список документов.')
  const source = candidates[0], actual = storedReference(source)
  // The stored type is authoritative even when a caller supplies another type or method.
  await requirePermission(`${actual.methodCode === 'ТВМТ' ? 'psto' : documentArea(actual.type)}.view`)
  return { source, actual }
}

function positionSql(documentId: number, reference: SystemDocumentReference, metadata: ReturnType<typeof parseSystemDocumentMetadata>) {
  const selectedMethods = methods.filter(method => reference.type.startsWith('psto') ? method.code === 'ПСТО' : reference.type === 'lnkConclusion' ? method.code === reference.methodCode : (method.code === 'ТВМТ') === (reference.methodCode === 'ТВМТ') && method.code !== 'ПСТО')
  if (!selectedMethods.length) throw new Error('Не удалось определить вид контроля документа.')
  const types = (method: typeof methods[number]) => [
    `system:${getSystemDocumentTemplateId({ type: method.code === 'ПСТО' ? 'pstoRequest' : 'lnkRequest', methodCode: method.code })}`,
    `system:${getSystemDocumentTemplateId({ type: method.code === 'ПСТО' ? 'pstoConclusion' : 'lnkConclusion', methodCode: method.code })}`,
  ]
  const primaryValues = selectedMethods.map(method => {
    const [requestType, resultType] = types(method)
    return sql`(${method.code}, ${weldJoints[method.requestKey]}, ${weldJoints[method.requestDateKey]}::text, ${weldJoints[method.conclusionKey]}, ${weldJoints[method.conclusionDateKey]}::text, ${weldJoints[method.resultKey]}, ${requestType}, ${resultType})`
  })
  const cycleMethods = selectedMethods.filter(method => method.code === 'ПСТО' || method.code === 'ТВМТ') as Array<typeof psto | Extract<typeof ALL_LNK_FIELD_METHODS[number], { code: 'ТВМТ' }>>
  const cycleValues = cycleMethods.map(method => {
    const [requestType, resultType] = types(method)
    const value = (key: typeof method.requestKey | typeof method.requestDateKey | typeof method.conclusionKey | typeof method.conclusionDateKey | typeof method.resultKey): SQL => sql`case when (p->>'sequence')::integer = 1 then ${weldJoints[key]}::text else ${pstoRepeatCycles[key]}::text end`
    return sql`(${method.code}, ${value(method.requestKey)}, ${value(method.requestDateKey)}, ${value(method.conclusionKey)}, ${value(method.conclusionDateKey)}, ${value(method.resultKey)}, ${requestType}, ${resultType})`
  })
  const valueColumns = sql`v(method, request_name, request_date, conclusion_name, conclusion_date, result, request_type, result_type)`
  const sourcePositions = JSON.stringify(metadata?.sourcePositions ?? [])
  return sql`
    raw_positions as (
      select ${weldJoints.id} as weld_id, case when v.method in ('ПСТО','ТВМТ') then 'cycle' else 'primary' end as stage,
        ${weldJoints.id} as relation_id, 1 as sequence, v.*
      from ${generatedDocumentWeldJoints} a join ${weldJoints} on ${weldJoints.id} = a.weld_joint_id
      cross join lateral (values ${sql.join(primaryValues, sql`,`)}) ${valueColumns}
      where a.document_id = ${documentId} and ${!metadata?.sourceKind}
      union all
      select c.weld_joint_id, 'beforeHeatTreatment', c.id, 0, c.method, c.request_name, c.request_date::text, c.conclusion_name, c.conclusion_date::text, c.result,
        'system:lnkRequest', case c.method when 'ВИК' then 'system:lnkConclusionVik' when 'РК' then 'system:lnkConclusionRk' when 'УЗК' then 'system:lnkConclusionUzk' when 'ПВК' then 'system:lnkConclusionPvk' end
      from jsonb_array_elements(${sourcePositions}::jsonb) p join ${preHeatTreatmentControls} c on c.id = (p->>'relationId')::integer and c.weld_joint_id = (p->>'weldJointId')::integer and c.method = p->>'methodCode'
      join ${generatedDocumentWeldJoints} a on a.document_id = ${documentId} and a.weld_joint_id = c.weld_joint_id
      where p->>'kind' = 'beforeHeatTreatment' and c.method = any(${sql.param(selectedMethods.map(method => method.code))}::text[])
      ${cycleValues.length ? sql`union all
      select ${weldJoints.id}, 'cycle', (p->>'relationId')::integer, (p->>'sequence')::integer, v.*
      from jsonb_array_elements(${sourcePositions}::jsonb) p
      join ${weldJoints} on ${weldJoints.id} = (p->>'weldJointId')::integer
      join ${generatedDocumentWeldJoints} a on a.document_id = ${documentId} and a.weld_joint_id = ${weldJoints.id}
      left join ${pstoRepeatCycles} on ${pstoRepeatCycles.id} = (p->>'relationId')::integer and ${pstoRepeatCycles.weldJointId} = ${weldJoints.id} and ${pstoRepeatCycles.sequence} = (p->>'sequence')::integer
      cross join lateral (values ${sql.join(cycleValues, sql`,`)}) ${valueColumns}
      where p->>'kind' in ('pstoCycle','pstoRepeat') and (((p->>'sequence')::integer = 1 and (p->>'relationId')::integer = ${weldJoints.id}) or ((p->>'sequence')::integer >= 2 and ${pstoRepeatCycles.id} is not null))` : sql``}
    ), positions as materialized (
      select distinct *, regexp_replace(lower(btrim(coalesce(result,''))), ' · назначение отменено$', '') as normalized_result, concat(weld_id, ':', stage, ':', relation_id, ':', method) as position_key
      from raw_positions where btrim(coalesce(${reference.type.endsWith('Request') ? sql`request_name` : sql`conclusion_name`}, '')) = ${reference.title}
        and coalesce(${reference.type.endsWith('Request') ? sql`request_date` : sql`conclusion_date`}, '') = ${reference.date}
    )`
}

export const getDocumentConnections = createServerFn({ method: 'POST' }).validator((input: { reference: SystemDocumentReference; page?: number }) => ({ reference: normalizeSystemDocumentReference(input?.reference), page: Math.max(0, Math.min(1_000_000, Math.floor(Number(input?.page) || 0))) })).handler(async ({ data }) => {
  await requirePermission('documents.view')
  return requireDb().transaction(async tx => {
    const { source, actual } = await resolveSource(tx, data.reference)
    const metadata = parseSystemDocumentMetadata(source.metadata)
    const isRequest = actual.type.endsWith('Request')
    const result = await tx.execute(sql`
      with ${positionSql(source.id, actual, metadata)},
      candidate_docs as materialized (
        select d.id, case when d.type = 'system:lnkConclusionOther' and d.source_metadata::jsonb->>'methodCode' = 'ТВМТ' then 'system:tvmtConclusion' when d.type = 'system:lnkRequest' and d.source_metadata::jsonb->>'methodCode' = 'ТВМТ' then 'system:tvmtRequest' else d.type end as type, d.title, d.period_from as date, d.source_metadata::jsonb as facts,
          jsonb_build_object('sourceKind', d.source_metadata::jsonb->'sourceKind', 'methodCode', d.source_metadata::jsonb->'methodCode', 'cycleSequences', d.source_metadata::jsonb->'cycleSequences') as metadata
        from ${generatedDocuments} d join (select distinct ${isRequest ? sql`result_type` : sql`request_type`} as type,
          btrim(coalesce(${isRequest ? sql`conclusion_name` : sql`request_name`}, '')) as title,
          coalesce(${isRequest ? sql`conclusion_date` : sql`request_date`}, '') as date from positions) wanted
          on (d.type = wanted.type or wanted.type = 'system:tvmtConclusion' and d.type = 'system:lnkConclusionOther' and d.source_metadata::jsonb->>'methodCode' = 'ТВМТ' or wanted.type = 'system:tvmtRequest' and d.type = 'system:lnkRequest' and d.source_metadata::jsonb->>'methodCode' = 'ТВМТ') and d.title = wanted.title and coalesce(d.period_from::text, '') = wanted.date
      ), target_positions as materialized (
        select d.id, a.weld_joint_id as weld_id, a.weld_joint_id as relation_id, 1 as sequence,
          case when d.type like 'system:psto%' or d.type like 'system:tvmt%' then 'cycle' else 'primary' end as stage, null::text as method
        from candidate_docs d join ${generatedDocumentWeldJoints} a on a.document_id = d.id where coalesce(d.facts->>'sourceKind', '') = ''
        union all
        select d.id, (p->>'weldJointId')::integer, (p->>'relationId')::integer,
          case when p->>'kind' = 'beforeHeatTreatment' then 0 else (p->>'sequence')::integer end,
          case when p->>'kind' = 'beforeHeatTreatment' then 'beforeHeatTreatment' else 'cycle' end,
          case when p->>'kind' = 'beforeHeatTreatment' then p->>'methodCode' else null end
        from candidate_docs d cross join lateral jsonb_array_elements(coalesce(d.facts->'sourcePositions','[]'::jsonb)) p
        join ${generatedDocumentWeldJoints} a on a.document_id = d.id and a.weld_joint_id = (p->>'weldJointId')::integer
        where (d.facts->>'sourceKind' = 'beforeHeatTreatment' and p->>'kind' = 'beforeHeatTreatment')
          or (d.facts->>'sourceKind' in ('pstoCycle','pstoRepeat') and p->>'kind' in ('pstoCycle','pstoRepeat'))
      ), links as materialized (
        select p.position_key, d.id, d.type, d.title, d.date, d.metadata
        from positions p join target_positions target on target.weld_id = p.weld_id and target.relation_id = p.relation_id and target.sequence = p.sequence
          and target.stage = p.stage and (target.method is null or target.method = p.method)
        join candidate_docs d on d.id = target.id and d.type = ${isRequest ? sql`p.result_type` : sql`p.request_type`}
          and d.title = btrim(coalesce(${isRequest ? sql`p.conclusion_name` : sql`p.request_name`}, '')) and coalesce(d.date::text, '') = coalesce(${isRequest ? sql`p.conclusion_date` : sql`p.request_date`}, '')
      ), grouped as (select id, type, title, date, metadata, count(distinct position_key)::integer as positions from links group by id, type, title, date, metadata),
      page as (select * from grouped order by date desc nulls last, title, id limit ${pageSize} offset ${data.page * pageSize})
      select (select count(*)::integer from positions) as total,
        (select count(distinct weld_id)::integer from positions) as joints,
        (select count(*)::integer from positions where btrim(coalesce(conclusion_name,'')) <> '' and coalesce(conclusion_date,'') <> '' and case method when 'ПСТО' then normalized_result in ('проведено','проведено (отменен)','да') when 'ТВМТ' then normalized_result in ('годен','да','не годен','негоден','ремонт','вырез') else normalized_result in ('годен','ремонт','вырез','годен (отменен)') end) as completed,
        (select count(distinct position_key)::integer from links) as linked,
        (select count(*)::integer from grouped) as documents,
        coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb) as items
    `)
    const counts = result.rows[0] as { total: number; joints: number; completed: number; linked: number; documents: number; items: Array<{ id: number; type: string; title: string; date: string | null; metadata: unknown; positions: number }> }
    if (counts.joints !== source.rowCount || metadata?.sourcePositions.length && counts.total !== metadata.sourcePositions.length) throw new Error('Состав документа изменился или его связи неполны. Обновите данные перед просмотром связей.')
    return { reference: actual, isRequest, total: counts.total, completed: counts.completed, linked: counts.linked, documentCount: counts.documents, page: data.page, pageSize, items: counts.items.map(item => ({ reference: storedReference(item), positions: item.positions })) }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
})
