import { asc, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { generatedDocuments, generatedDocumentWeldJoints, weldJoints, welderStamps } from '@/db/schema'
import { buildNumberArrayMatch } from './weld-request-utils'
import { assertSecurityScope } from './security-functions'
import { requireContextPermission } from './access-payload'
import { buildSpecialistParticipant, buildWelderParticipants, normalizeParticipantKinds, PARTICIPANT_KINDS, sortUniqueParticipants, type ParticipantKind, type TemplateParticipant } from '@/lib/document-template-participants'
import { getSpecialistDocumentProfile, type SpecialistSnapshot } from '@/lib/document-specialists'

const CONCLUSION_TYPES = ['system:lnkConclusionVik', 'system:lnkConclusionRk', 'system:lnkConclusionUzk', 'system:lnkConclusionPvk', 'system:pstoConclusion', 'system:tvmtConclusion', 'layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers']
export function normalizeDocumentParticipantRequest(data: { rowIds: number[]; kinds: ParticipantKind[] }) {
  if (!Array.isArray(data?.rowIds) || data.rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Не удалось определить стыки документа.')
  if (!Array.isArray(data.kinds) || !data.kinds.length || data.kinds.some(kind => !PARTICIPANT_KINDS.includes(kind))) throw new Error('Выберите категории участников работ.')
  return { rowIds: [...new Set(data.rowIds)], kinds: normalizeParticipantKinds(data.kinds) }
}

export async function loadDocumentTemplateParticipants(input: { rowIds: number[]; kinds: ParticipantKind[] }) {
  const { rowIds, kinds } = normalizeDocumentParticipantRequest(input)
  await assertSecurityScope('entry')
  requireContextPermission('documents.view')
  if (kinds.includes('welder')) { requireContextPermission('welding.view'); requireContextPermission('references.view') }
  if (kinds.includes('thermist')) requireContextPermission('psto.view')
  if (kinds.includes('inspector')) requireContextPermission('lnk.view')
  if (!rowIds.length) return []
  return requireDb().transaction(async tx => {
    const participants: TemplateParticipant[] = []
    if (kinds.includes('welder')) {
      const stamps = await tx.execute<{ stamp: string }>(sql`select distinct btrim(s.stamp) as stamp from ${weldJoints}
        cross join lateral unnest(array[${weldJoints.stamp1K}, ${weldJoints.stamp1Z}, ${weldJoints.stamp1O}, ${weldJoints.stamp2K}, ${weldJoints.stamp2Z}, ${weldJoints.stamp2O}]) s(stamp)
        where ${buildNumberArrayMatch(weldJoints.id, rowIds)} and btrim(coalesce(s.stamp, '')) <> ''`)
      const registry = await tx.select({ id: welderStamps.id, welderName: welderStamps.welderName, naksStamp: welderStamps.naksStamp, internalStamp: welderStamps.internalStamp }).from(welderStamps).orderBy(asc(welderStamps.id))
      participants.push(...buildWelderParticipants(stamps.rows.map(row => row.stamp), registry.map(row => ({ id: row.id, welderName: row.welderName ?? '', naksStamp: row.naksStamp ?? '', internalStamp: row.internalStamp ?? '' }))))
    }
    const types = CONCLUSION_TYPES.filter(type => kinds.includes(getSpecialistDocumentProfile(type)!.kind))
    if (types.length) {
      // Select distinct stored performers, not whole document contents or a row
      // per position. Only first is the executor; second is never included.
      const snapshots = await tx.execute<{ type: string; performer: SpecialistSnapshot }>(sql`
        select distinct ${generatedDocuments.type} as type, ${generatedDocuments.specialists}->'first' as performer
        from ${generatedDocuments}
        where ${generatedDocuments.type} = any(${sql.param(types)}::text[])
          and ${generatedDocuments.specialists}->'first' is not null
          and exists (select 1 from ${generatedDocumentWeldJoints}
            where ${generatedDocumentWeldJoints.documentId} = ${generatedDocuments.id}
              and ${buildNumberArrayMatch(generatedDocumentWeldJoints.weldJointId, rowIds)})`)
      for (const row of snapshots.rows) {
        const person = buildSpecialistParticipant(getSpecialistDocumentProfile(row.type)!.kind, row.performer)
        if (person) participants.push(person)
      }
    }
    return sortUniqueParticipants(participants)
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
