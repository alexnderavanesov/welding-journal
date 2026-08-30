import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getPreHeatTreatmentControl,
  isPreHeatTreatmentMethodNoNeed,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import { parseRkExposureDescription } from '@/lib/rk-exposure'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

type PreHeatTreatmentReportValueKey =
  | 'requestName'
  | 'requestDate'
  | 'result'
  | 'conclusionDate'
  | 'conclusionName'
  | 'defectDescription'
  | 'exposureScheme'

export type PreHeatTreatmentReportFieldDescriptor = {
  fieldKey: WeldFieldKey
  methodCode: PreHeatTreatmentLnkMethodCode
  valueKey: PreHeatTreatmentReportValueKey
}

export const PRE_HEAT_TREATMENT_REPORT_FIELDS = [
  { fieldKey: 'preVikRequest', methodCode: 'ВИК', valueKey: 'requestName' },
  { fieldKey: 'preVikRequestDate', methodCode: 'ВИК', valueKey: 'requestDate' },
  { fieldKey: 'preVikResult', methodCode: 'ВИК', valueKey: 'result' },
  { fieldKey: 'preVikConclusionDate', methodCode: 'ВИК', valueKey: 'conclusionDate' },
  { fieldKey: 'preVikConclusion', methodCode: 'ВИК', valueKey: 'conclusionName' },
  { fieldKey: 'preRkRequest', methodCode: 'РК', valueKey: 'requestName' },
  { fieldKey: 'preRkRequestDate', methodCode: 'РК', valueKey: 'requestDate' },
  { fieldKey: 'preRkResult', methodCode: 'РК', valueKey: 'result' },
  { fieldKey: 'preRkConclusionDate', methodCode: 'РК', valueKey: 'conclusionDate' },
  { fieldKey: 'preRkConclusion', methodCode: 'РК', valueKey: 'conclusionName' },
  { fieldKey: 'preRkExposureScheme', methodCode: 'РК', valueKey: 'exposureScheme' },
  { fieldKey: 'preRkDefectDescription', methodCode: 'РК', valueKey: 'defectDescription' },
  { fieldKey: 'preUzkRequest', methodCode: 'УЗК', valueKey: 'requestName' },
  { fieldKey: 'preUzkRequestDate', methodCode: 'УЗК', valueKey: 'requestDate' },
  { fieldKey: 'preUzkResult', methodCode: 'УЗК', valueKey: 'result' },
  { fieldKey: 'preUzkConclusionDate', methodCode: 'УЗК', valueKey: 'conclusionDate' },
  { fieldKey: 'preUzkConclusion', methodCode: 'УЗК', valueKey: 'conclusionName' },
  { fieldKey: 'prePvkRequest', methodCode: 'ПВК', valueKey: 'requestName' },
  { fieldKey: 'prePvkRequestDate', methodCode: 'ПВК', valueKey: 'requestDate' },
  { fieldKey: 'prePvkResult', methodCode: 'ПВК', valueKey: 'result' },
  { fieldKey: 'prePvkConclusionDate', methodCode: 'ПВК', valueKey: 'conclusionDate' },
  { fieldKey: 'prePvkConclusion', methodCode: 'ПВК', valueKey: 'conclusionName' },
] as const satisfies readonly PreHeatTreatmentReportFieldDescriptor[]

export const PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS = PRE_HEAT_TREATMENT_REPORT_FIELDS
  .map((field) => field.fieldKey)

export const PRE_HEAT_TREATMENT_REQUEST_FIELD_KEYS = new Set<WeldFieldKey>(
  PRE_HEAT_TREATMENT_REPORT_FIELDS
    .filter((field) => field.valueKey === 'requestName')
    .map((field) => field.fieldKey),
)

export const PRE_HEAT_TREATMENT_CONCLUSION_FIELD_KEYS = new Set<WeldFieldKey>(
  PRE_HEAT_TREATMENT_REPORT_FIELDS
    .filter((field) => field.valueKey === 'conclusionName')
    .map((field) => field.fieldKey),
)

const FIELD_BY_KEY = new Map<WeldFieldKey, PreHeatTreatmentReportFieldDescriptor>(
  PRE_HEAT_TREATMENT_REPORT_FIELDS.map((field) => [field.fieldKey, field]),
)

export function getPreHeatTreatmentReportField(fieldKey: WeldFieldKey) {
  return FIELD_BY_KEY.get(fieldKey)
}

export function getPreHeatTreatmentReportValue(row: WeldInput, fieldKey: WeldFieldKey) {
  const field = getPreHeatTreatmentReportField(fieldKey)
  if (!field) return undefined
  const control = getPreHeatTreatmentControl(row, field.methodCode)
  if (field.valueKey === 'result' && isPreHeatTreatmentMethodNoNeed(row, field.methodCode)) {
    return 'нет потребности'
  }
  if (field.valueKey === 'exposureScheme') {
    return control
      ? parseRkExposureDescription(control.defectDescription)
          .map((line) => line.coordinate)
          .filter(Boolean)
          .join(', ')
      : undefined
  }
  if (field.valueKey === 'defectDescription') {
    return control
      ? parseRkExposureDescription(control.defectDescription)
          .map((line) => line.description)
          .filter(Boolean)
          .join('; ')
      : undefined
  }
  return control?.[field.valueKey]
}

export function attachPreHeatTreatmentReportValues<Row extends { id: number }>(
  row: Row,
  controls: readonly PreHeatTreatmentControlRecord[],
): Row & Partial<Record<WeldFieldKey, unknown>> {
  const values: Partial<Record<WeldFieldKey, unknown>> = {}
  const carrier = { ...row, preHeatTreatmentControls: controls } as unknown as WeldRow
  for (const field of PRE_HEAT_TREATMENT_REPORT_FIELDS) {
    values[field.fieldKey] = getPreHeatTreatmentReportValue(carrier, field.fieldKey)
  }
  return { ...row, ...values }
}
