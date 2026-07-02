import { FIELD_BY_KEY, WELD_FIELDS, type WeldField, type WeldFieldKey } from './weld-field-definitions'
import { LNK_CONCLUSION_FIELD_KEYS, LNK_METHODS, LNK_REPORT_FIELD_KEYS } from './lnk-report-config'

export const REPEATED_JOINT_CLEARED_FIELD_KEYS = new Set<WeldFieldKey>([
  'weldDate',
  'responsible',
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'stamp2K',
  'stamp2Z',
  'stamp2O',
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
  ...LNK_METHODS.flatMap((method) => [
    method.requestKey,
    method.resultKey,
    method.conclusionDateKey,
    method.conclusionKey,
  ]),
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
  'boq',
  'ks3',
  'createdAt',
  'pstoBoq',
  'pstoKs3',
  'pstoCreatedAt',
  'lnkCreatedAt',
  'vikBoq',
  'vikKs3',
  'rkBoq',
  'rkKs3',
  'pvkBoq',
  'pvkKs3',
  'uzkBoq',
  'uzkKs3',
  'tvmtBoq',
  'tvmtKs3',
  'rfaBoq',
  'rfaKs3',
  'stlsBoq',
  'stlsKs3',
  'mkkBoq',
  'mkkKs3',
  'lnkDefectDescription',
  'lnkNote',
  'finalStatus',
  'status',
])

export const ALWAYS_VISIBLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'projectTitle',
  'subtitleCode',
  'line',
  'weldControlPercent',
  'spool',
  'joint',
  'wdi',
  'weldDate',
  'finalStatus',
])

export const REQUEST_AND_RESULT_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_METHODS.flatMap((method) => [method.requestKey, method.resultKey]),
  'pstoRequest',
  'pstoResult',
])

export const WELDING_JOURNAL_BLOCKED_FIELD_KEYS = new Set<WeldFieldKey>([
  ...REQUEST_AND_RESULT_FIELD_KEYS,
  'status',
  'createdAt',
  'finalStatus',
])

export const WELDING_JOURNAL_HIDDEN_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
  'pstoCreatedAt',
  ...LNK_REPORT_FIELD_KEYS,
  ...LNK_CONCLUSION_FIELD_KEYS,
])

export const LNK_HIDDEN_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
  'pstoCreatedAt',
  'boq',
  'ks3',
  'createdAt',
])

export const WELD_STAMP_COMPLETION_GROUPS = [
  {
    index: 1,
    reason: 'дозаполнить клейма_1',
    fields: ['stamp1K', 'stamp1Z', 'stamp1O', 'stamp1KFact', 'stamp1ZFact', 'stamp1OFact'],
  },
  {
    index: 2,
    reason: 'дозаполнить клейма_2',
    fields: ['stamp2K', 'stamp2Z', 'stamp2O', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'],
  },
] as const satisfies ReadonlyArray<{ index: 1 | 2; reason: string; fields: readonly WeldFieldKey[] }>

export const UNOFFICIAL_REJECTED_WITH_COIL_REASON = 'катушка требует проверки после смены официальности'
export const REPAIR_FORBIDDEN_BY_DIAMETER_REASON = 'проверить ремонт по диаметру'
export const REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON = 'после двух ремонтов доступен только вырез'

const WELDING_JOURNAL_BASE_REPORT_FIELD_KEYS = [
  'projectTitle',
  'subtitleCode',
  'line',
  'weldControlPercent',
  'spool',
  'joint',
  'wdi',
  'weldDate',
  'status',
  'finalStatus',
] as const satisfies readonly WeldFieldKey[]

const WELDING_JOURNAL_CONTROL_STATE_FIELD_KEYS = [
  'hasVik',
  'hasRk',
  'hasPvk',
  'hasUzk',
  'pstoRequired',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
] as const satisfies readonly WeldFieldKey[]

const WELDING_JOURNAL_REQUEST_FIELD_KEYS = [
  ...LNK_METHODS.map((method) => method.requestKey),
  'pstoRequest',
] as const satisfies readonly WeldFieldKey[]

const WELDING_JOURNAL_RESULT_FIELD_KEYS = [
  ...LNK_METHODS.map((method) => method.resultKey),
  'pstoResult',
] as const satisfies readonly WeldFieldKey[]

const WELDING_JOURNAL_COMPLETION_FIELD_KEYS = [
  ...LNK_METHODS.flatMap((method) => [method.conclusionDateKey, method.conclusionKey]),
  'pstoDate',
  'heatTreatmentDiagram',
] as const satisfies readonly WeldFieldKey[]

function getFieldsByKeys(keys: readonly WeldFieldKey[]) {
  return keys.map((key) => FIELD_BY_KEY.get(key)).filter(Boolean) as WeldField[]
}

export const WELDING_JOURNAL_WAITING_WELD_FIELDS = getFieldsByKeys([
  'projectTitle',
  'subtitleCode',
  'line',
  'weldControlPercent',
  'spool',
  'spoolId',
  'joint',
  'materialId1',
  'materialId2',
  'element1',
  'element2',
  'material1',
  'material2',
  'weldingMethod',
  'connectionType',
  'd1',
  'd2',
  't1',
  't2',
  'wdi',
  'weldDate',
])

export const WELDING_JOURNAL_WAITING_REQUEST_FIELDS = getFieldsByKeys([
  ...WELDING_JOURNAL_BASE_REPORT_FIELD_KEYS,
  ...WELDING_JOURNAL_CONTROL_STATE_FIELD_KEYS,
  ...WELDING_JOURNAL_REQUEST_FIELD_KEYS,
])

export const WELDING_JOURNAL_WAITING_CONTROL_FIELDS = getFieldsByKeys([
  ...WELDING_JOURNAL_BASE_REPORT_FIELD_KEYS,
  ...WELDING_JOURNAL_CONTROL_STATE_FIELD_KEYS,
  ...WELDING_JOURNAL_REQUEST_FIELD_KEYS,
  ...WELDING_JOURNAL_RESULT_FIELD_KEYS,
])

const WELDING_JOURNAL_PREVIOUS_JOINT_FIELD = {
  key: 'previousJoint',
  dbName: 'previous_joint',
  label: 'Предшествующий стык',
  kind: 'text',
  group: 'Стык',
} as const satisfies WeldField

export const WELDING_JOURNAL_WAITING_REPAIR_FIELDS = [
  ...WELDING_JOURNAL_WAITING_WELD_FIELDS,
  WELDING_JOURNAL_PREVIOUS_JOINT_FIELD,
]

export const WELDING_JOURNAL_CANCELLED_ACCEPTED_FIELDS = getFieldsByKeys([
  ...WELDING_JOURNAL_BASE_REPORT_FIELD_KEYS,
  ...WELDING_JOURNAL_CONTROL_STATE_FIELD_KEYS,
  ...WELDING_JOURNAL_REQUEST_FIELD_KEYS,
  ...WELDING_JOURNAL_RESULT_FIELD_KEYS,
  ...WELDING_JOURNAL_COMPLETION_FIELD_KEYS,
])

export const WELDING_JOURNAL_SYSTEM_FIELDS = [...WELD_FIELDS]
