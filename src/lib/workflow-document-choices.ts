import type { SystemDocumentType } from './system-document-types'

export type WorkflowDocumentChoice = { key: string; label: string; type: SystemDocumentType; stage?: string; method?: string }
export const LNK_CONCLUSION_DOCUMENTS: WorkflowDocumentChoice[] = [{ key: 'lnk-results', label: 'Заключения ЛНК', type: 'lnkConclusion', stage: 'Основной' }]
export const LNK_REQUEST_DOCUMENTS: WorkflowDocumentChoice[] = [{ key: 'lnk-requests', label: 'Заявки ЛНК', type: 'lnkRequest', stage: 'Основной' }]
export const PSTO_REQUEST_DOCUMENTS: WorkflowDocumentChoice[] = [{ key: 'psto-requests', label: 'Заявки ПСТО', type: 'pstoRequest' }]
export const PSTO_DOCUMENTS: WorkflowDocumentChoice[] = [
  ...PSTO_REQUEST_DOCUMENTS,
  { key: 'psto-results', label: 'Диаграммы ПСТО', type: 'pstoConclusion' },
  { key: 'tvmt-requests', label: 'Заявки ТВМТ', type: 'lnkRequest', method: 'ТВМТ' },
  { key: 'tvmt-results', label: 'Заключения ТВМТ', type: 'lnkConclusion', method: 'ТВМТ' },
]

