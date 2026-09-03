import {
  FIELD_BY_KEY,
  MATERIAL_ADDITIONAL_FIELD_KEYS,
  WELDING_MATERIAL_FIELD_KEYS,
  type WeldField,
  type WeldFieldKey,
} from './weld-field-definitions'
import { LNK_CONCLUSION_FIELD_KEYS, LNK_REPORT_FIELD_KEYS } from './lnk-report-config'
import { PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS } from '@/lib/pre-heat-treatment-report-fields'

export const HEAT_TREATMENT_EDITABLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
])
export const PSTO_WAITING_REQUEST_FIELDS = [
  getReportField('projectTitle', 'ПСТО'),
  getReportField('subtitleCode', 'ПСТО'),
  getReportField('line', 'ПСТО'),
  getReportField('spool', 'ПСТО'),
  getReportField('joint', 'ПСТО'),
  getReportField('wdi', 'ПСТО'),
  getReportField('weldDate', 'ПСТО'),
  getReportField('officiality', 'ПСТО'),
] as unknown as WeldField[]

export const PSTO_RESULTS_FIELDS = [
  ...PSTO_WAITING_REQUEST_FIELDS.filter((field) => field.key !== 'officiality'),
  getReportField('pstoRequest', 'ПСТО'),
  getReportField('pstoRequestDate', 'ПСТО'),
  getReportField('pstoDate', 'ПСТО'),
  getReportField('heatTreatmentDiagram', 'ПСТО'),
] as unknown as WeldField[]

export const PSTO_SECTION_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'pstoResult',
  'pstoCycleSummary',
  'heatTreatmentDiagram',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'pstoNote',
  'pstoCancellationDate',
  'pstoControlBasis',
])

export const PSTO_SECTION_FIELD_ORDER = [
  'pstoRequired',
  'pstoCycleSummary',
  'pstoRequest',
  'pstoRequestDate',
  'heatTreatmentDiagram',
  'pstoDate',
  'pstoResult',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtConclusion',
  'tvmtConclusionDate',
  'tvmtResult',
  'pstoNote',
  'pstoCancellationDate',
  'pstoControlBasis',
] as const satisfies readonly WeldFieldKey[]

export const HEAT_TREATMENT_HIDDEN_FIELD_KEYS = new Set<WeldFieldKey>([
  'layeredVikEdgesDocument',
  'layeredVikLayersDocument',
  'layeredPvkEdgesDocument',
  'layeredPvkLayersDocument',
  'layeredVikDocuments',
  'layeredPvkDocuments',
  ...PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS,
  ...MATERIAL_ADDITIONAL_FIELD_KEYS,
  ...WELDING_MATERIAL_FIELD_KEYS,
  'hasVik',
  'hasRk',
  'hasUzk',
  'hasPvk',
  'hasTvmt',
  'controlBasisSummary',
  'vikRequest',
  'vikRequestDate',
  'rkRequest',
  'rkRequestDate',
  'uzkRequest',
  'uzkRequestDate',
  'pvkRequest',
  'pvkRequestDate',
  'tvmtRequest',
  'tvmtRequestDate',
  'vikResult',
  'rkResult',
  'uzkResult',
  'pvkResult',
  'tvmtResult',
  'pstoBoq',
  'pstoKs3',
  'testTypes',
  'testContour',
  'testDate',
  'piDate',
  'testBoq',
  'piBoq',
  'testKs3',
  'piKs3',
  'weldingJournalNote',
  'jsrDocument',
  'checklistDocument',
  'zniDocument',
  'boq',
  'ks3',
  'createdAt',
  'weldingUpdatedAt',
  'rkExposureScheme',
  'rkExposureConfirmedDiameter',
  ...LNK_REPORT_FIELD_KEYS,
  ...LNK_CONCLUSION_FIELD_KEYS,
])

for (const fieldKey of [
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
] as const satisfies readonly WeldFieldKey[]) {
  HEAT_TREATMENT_HIDDEN_FIELD_KEYS.delete(fieldKey)
}

function getReportField(key: WeldFieldKey, group: string): WeldField {
  const field = FIELD_BY_KEY.get(key)
  if (!field) throw new Error(`Unknown PSTO report field: ${key}`)
  return { ...field, group: group as WeldField['group'], visible: true }
}
