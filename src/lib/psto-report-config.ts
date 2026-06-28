import type { WeldField, WeldFieldKey } from './weld-field-definitions'
import { LNK_CONCLUSION_FIELD_KEYS, LNK_REPORT_FIELD_KEYS } from './lnk-report-config'

export const PSTO_EMPTY_RESULT_VALUE = '__empty__'

export const HEAT_TREATMENT_EDITABLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
])
export const HEAT_TREATMENT_IMPORT_MATCH_FIELD_KEYS = new Set<WeldFieldKey>(['line', 'joint'])

export const PSTO_WAITING_REQUEST_FIELDS = [
  { key: 'projectTitle', label: 'Проект/Титул', kind: 'text', group: 'ПСТО', visible: true },
  { key: 'subtitleCode', label: 'Шифр/Подтитул', kind: 'text', group: 'ПСТО', visible: true },
  { key: 'line', label: 'Линия', kind: 'text', group: 'ПСТО', visible: true },
  { key: 'spool', label: 'Спул', kind: 'text', group: 'ПСТО', visible: true },
  { key: 'joint', label: 'Стык', kind: 'text', group: 'ПСТО', visible: true },
  { key: 'wdi', label: 'WDI', kind: 'number', group: 'ПСТО', visible: true },
  { key: 'weldDate', label: 'Дата сварки', kind: 'date', group: 'ПСТО', visible: true },
  { key: 'status', label: 'Статус', kind: 'text', group: 'ПСТО', visible: true },
] as unknown as WeldField[]

export const PSTO_RESULTS_FIELDS = [
  ...PSTO_WAITING_REQUEST_FIELDS.filter((field) => field.key !== 'status'),
  { key: 'pstoRequest', label: 'Номер заявки ПСТО', kind: 'text', group: 'ПСТО', visible: true },
  { key: 'pstoDate', label: 'Дата', kind: 'date', group: 'ПСТО', visible: true },
  { key: 'heatTreatmentDiagram', label: 'Номер диаграммы', kind: 'text', group: 'ПСТО', visible: true },
] as unknown as WeldField[]

export const PSTO_SECTION_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
])

export const HEAT_TREATMENT_HIDDEN_FIELD_KEYS = new Set<WeldFieldKey>([
  'hasVik',
  'hasRk',
  'hasPvk',
  'hasUzk',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
  'vikRequest',
  'rkRequest',
  'pvkRequest',
  'uzkRequest',
  'tvmtRequest',
  'rfaRequest',
  'stlsRequest',
  'mkkRequest',
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'boq',
  'ks3',
  'createdAt',
  ...LNK_REPORT_FIELD_KEYS,
  ...LNK_CONCLUSION_FIELD_KEYS,
])

