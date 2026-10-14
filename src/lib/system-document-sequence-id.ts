import { getSystemDocumentTemplateId, SYSTEM_DOCUMENT_TEMPLATE_PROFILES, type SystemDocumentTemplateId } from './system-document-template-types'
import type { SystemDocumentReference } from './system-document-types'

export const STAGED_DOCUMENT_TEMPLATE_IDS = ['lnkRequest', 'lnkConclusionVik', 'lnkConclusionRk', 'lnkConclusionUzk', 'lnkConclusionPvk'] as const
export type StagedDocumentTemplateId = typeof STAGED_DOCUMENT_TEMPLATE_IDS[number]
export type SystemDocumentSequenceId = SystemDocumentTemplateId | `${StagedDocumentTemplateId}:beforeHeatTreatment`
export type DocumentNumberStage = 'main' | 'beforeHeatTreatment'

export function supportsDocumentNumberStages(id: string): id is StagedDocumentTemplateId {
  return (STAGED_DOCUMENT_TEMPLATE_IDS as readonly string[]).includes(id)
}

export function sequenceIdForStage(id: SystemDocumentTemplateId, stage: DocumentNumberStage = 'main'): SystemDocumentSequenceId {
  if (stage === 'beforeHeatTreatment') {
    if (!supportsDocumentNumberStages(id)) throw new Error('У этого вида документа нет этапа «До ТО».')
    return `${id}:beforeHeatTreatment`
  }
  return id
}

export function getSystemDocumentSequenceId(reference: Pick<SystemDocumentReference, 'type' | 'methodCode' | 'sourceKind'>): SystemDocumentSequenceId {
  return sequenceIdForStage(getSystemDocumentTemplateId(reference), reference.sourceKind === 'beforeHeatTreatment' ? 'beforeHeatTreatment' : 'main')
}

export function getSequenceTemplateId(id: SystemDocumentSequenceId): SystemDocumentTemplateId {
  return id.split(':')[0] as SystemDocumentTemplateId
}

export const SYSTEM_DOCUMENT_SEQUENCE_IDS: SystemDocumentSequenceId[] = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.flatMap(({ id }) => supportsDocumentNumberStages(id) ? [id, sequenceIdForStage(id, 'beforeHeatTreatment')] : [id])

// The old shared key remains a frozen seed. Neither stage consumes it again.
export function systemDocumentCounterKey(id: SystemDocumentSequenceId) {
  return `system-document-next-number:${id}${supportsDocumentNumberStages(id) ? ':main' : ''}`
}

export function legacySystemDocumentCounterKey(id: SystemDocumentTemplateId) {
  return `system-document-next-number:${id}`
}
