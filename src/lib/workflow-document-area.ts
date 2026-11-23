import { isSystemDocumentType, type SystemDocumentReference, type SystemDocumentType } from './system-document-types'
import { getSystemDocumentTemplateId, SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from './system-document-template-types'

export type WorkflowDocumentArea = 'lnk' | 'psto'

/** A primary LNK request is identified by name/date across all its methods. */
export function assertWholeWorkflowDocumentReference(reference: SystemDocumentReference) {
  const method = String(reference.methodCode ?? '').trim().toLocaleUpperCase('ru-RU')
  if (reference.type === 'lnkRequest' && reference.sourceKind !== 'beforeHeatTreatment' && method && method !== 'ТВМТ') {
    throw new Error('Реквизиты общей заявки ЛНК меняются сразу для всех видов контроля. Откройте заявку целиком.')
  }
}

export function requireWorkflowDocumentArea(value: unknown): WorkflowDocumentArea {
  if (value !== 'lnk' && value !== 'psto') throw new Error('Неизвестная рабочая область документа.')
  return value
}

export function workflowDocumentStorageArea(storageType: string): WorkflowDocumentArea {
  const profile = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.find(item => `system:${item.id}` === storageType)
  if (!profile) throw new Error('Неизвестный тип рабочего документа.')
  return profile.id.startsWith('psto') || profile.id.startsWith('tvmt') ? 'psto' : 'lnk'
}

export function workflowDocumentReferenceArea(value: unknown): WorkflowDocumentArea {
  const reference = value as SystemDocumentReference | undefined
  if (!isSystemDocumentType(reference?.type)) throw new Error('Неизвестный тип рабочего документа.')
  return workflowDocumentStorageArea(`system:${getSystemDocumentTemplateId(reference!)}`)
}

export function workflowDocumentStorageTypes(type: SystemDocumentType, area: WorkflowDocumentArea) {
  const types = SYSTEM_DOCUMENT_TEMPLATE_PROFILES
    .filter(profile => profile.documentType === type && workflowDocumentStorageArea(`system:${profile.id}`) === area)
    .map(profile => `system:${profile.id}`)
  if (!types.length) throw new Error('Этот тип документа недоступен в выбранной рабочей области.')
  return types
}
