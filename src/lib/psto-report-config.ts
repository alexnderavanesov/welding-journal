import { FIELD_BY_KEY, MATERIAL_ADDITIONAL_FIELD_KEYS, type WeldField, type WeldFieldKey } from './weld-field-definitions'
import { LNK_CONCLUSION_FIELD_KEYS, LNK_REPORT_FIELD_KEYS } from './lnk-report-config'

export const HEAT_TREATMENT_EDITABLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
])
export const HEAT_TREATMENT_IMPORT_MATCH_FIELD_KEYS = new Set<WeldFieldKey>(['line', 'joint'])

export const PSTO_WAITING_REQUEST_FIELDS = [
  getReportField('projectTitle', 'ПСТО'),
  getReportField('subtitleCode', 'ПСТО'),
  getReportField('line', 'ПСТО'),
  getReportField('spool', 'ПСТО'),
  getReportField('joint', 'ПСТО'),
  getReportField('wdi', 'ПСТО'),
  getReportField('weldDate', 'ПСТО'),
  getReportField('status', 'ПСТО'),
] as unknown as WeldField[]

export const PSTO_RESULTS_FIELDS = [
  ...PSTO_WAITING_REQUEST_FIELDS.filter((field) => field.key !== 'status'),
  getReportField('pstoRequest', 'ПСТО'),
  getReportField('pstoDate', 'ПСТО'),
  getReportField('heatTreatmentDiagram', 'ПСТО'),
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
  ...MATERIAL_ADDITIONAL_FIELD_KEYS,
  'hasVik',
  'hasRk',
  'hasUzk',
  'hasPvk',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
  'vikRequest',
  'rkRequest',
  'uzkRequest',
  'pvkRequest',
  'tvmtRequest',
  'rfaRequest',
  'stlsRequest',
  'mkkRequest',
  'vikResult',
  'rkResult',
  'uzkResult',
  'pvkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'pstoBoq',
  'pstoKs3',
  'boq',
  'ks3',
  'createdAt',
  ...LNK_REPORT_FIELD_KEYS,
  ...LNK_CONCLUSION_FIELD_KEYS,
])

function getReportField(key: WeldFieldKey, group: string): WeldField {
  const field = FIELD_BY_KEY.get(key)
  if (!field) throw new Error(`Unknown PSTO report field: ${key}`)
  return { ...field, group, visible: true }
}
