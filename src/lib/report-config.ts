import type { WeldField, WeldFieldKey } from '@/lib/weld-fields'

export const WELDER_STAMP_WELD_TYPE_OPTIONS = ['РАД', 'РД', 'МП'] as const
export const WELDER_STAMP_EXPIRY_REMINDER_DAYS = 7
export const DAY_IN_MS = 24 * 60 * 60 * 1000
export const COLLAPSED_SECTIONS_STORAGE_PREFIX = 'welding-tracker-collapsed-sections'
export const HIGHLIGHT_DURATION_MS = 30000

export const HEAT_TREATMENT_EDITABLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
])
export const HEAT_TREATMENT_IMPORT_MATCH_FIELD_KEYS = new Set<WeldFieldKey>(['line', 'joint'])

export const OFFICIAL_WELDER_STAMP_FIELD_KEYS = [
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'stamp2K',
  'stamp2Z',
  'stamp2O',
] as const satisfies readonly WeldFieldKey[]
export const FACTUAL_WELDER_STAMP_FIELD_KEYS = [
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
] as const satisfies readonly WeldFieldKey[]
export const FACTUAL_WELDER_STAMP_FIELD_KEY_SET = new Set<WeldFieldKey>(FACTUAL_WELDER_STAMP_FIELD_KEYS)
export const WELDER_STAMP_FIELD_KEYS_FOR_DISPLAY: readonly WeldFieldKey[] = [
  ...OFFICIAL_WELDER_STAMP_FIELD_KEYS,
  ...FACTUAL_WELDER_STAMP_FIELD_KEYS,
]

export const PSTO_EMPTY_RESULT_VALUE = '__empty__'

export const LNK_METHODS = [
  { code: 'ВИК', enabledKey: 'hasVik', requestKey: 'vikRequest', resultKey: 'vikResult', conclusionDateKey: 'vikConclusionDate', conclusionKey: 'vikConclusion' },
  { code: 'РК', enabledKey: 'hasRk', requestKey: 'rkRequest', resultKey: 'rkResult', conclusionDateKey: 'rkConclusionDate', conclusionKey: 'rkConclusion' },
  { code: 'ПВК', enabledKey: 'hasPvk', requestKey: 'pvkRequest', resultKey: 'pvkResult', conclusionDateKey: 'pvkConclusionDate', conclusionKey: 'pvkConclusion' },
  { code: 'УЗК', enabledKey: 'hasUzk', requestKey: 'uzkRequest', resultKey: 'uzkResult', conclusionDateKey: 'uzkConclusionDate', conclusionKey: 'uzkConclusion' },
  { code: 'ТВМТ', enabledKey: 'hasTvmt', requestKey: 'tvmtRequest', resultKey: 'tvmtResult', conclusionDateKey: 'tvmtConclusionDate', conclusionKey: 'tvmtConclusion' },
  { code: 'РФА', enabledKey: 'hasRfa', requestKey: 'rfaRequest', resultKey: 'rfaResult', conclusionDateKey: 'rfaConclusionDate', conclusionKey: 'rfaConclusion' },
  { code: 'СТЛС', enabledKey: 'hasStls', requestKey: 'stlsRequest', resultKey: 'stlsResult', conclusionDateKey: 'stlsConclusionDate', conclusionKey: 'stlsConclusion' },
  { code: 'МКК', enabledKey: 'hasMkk', requestKey: 'mkkRequest', resultKey: 'mkkResult', conclusionDateKey: 'mkkConclusionDate', conclusionKey: 'mkkConclusion' },
] as const satisfies ReadonlyArray<{
  code: string
  enabledKey: WeldFieldKey
  requestKey: WeldFieldKey
  resultKey: WeldFieldKey
  conclusionDateKey: WeldFieldKey
  conclusionKey: WeldFieldKey
}>

export const LNK_RESULT_OPTIONS = ['годен', 'ремонт', 'вырез'] as const
export const LNK_EMPTY_RESULT_VALUE = '__empty__'
export const LNK_CUSTOM_RESULT_VALUE = '__custom__'

export const LNK_WAITING_NK_FIELDS = [
  { key: 'projectTitle', label: 'Проект/Титул', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'subtitleCode', label: 'Шифр/Подтитул', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'line', label: 'Линия', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'spool', label: 'Спул', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'joint', label: 'Стык', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'wdi', label: 'WDI', kind: 'number', group: 'ЛНК', visible: true },
  { key: 'weldDate', label: 'Дата сварки', kind: 'date', group: 'ЛНК', visible: true },
  { key: 'requestName', label: 'Наименование заявки', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'controlMethod', label: 'Вид НК', kind: 'text', group: 'ЛНК', visible: true },
] as unknown as WeldField[]

export const LNK_CONCLUSIONS_FIELDS = [
  ...LNK_WAITING_NK_FIELDS,
  { key: 'controlDate', label: 'Дата контроля', kind: 'date', group: 'ЛНК', visible: true },
  { key: 'result', label: 'Результат', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'conclusionName', label: 'Наименование заключения', kind: 'text', group: 'ЛНК', visible: true },
] as unknown as WeldField[]

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

export const LNK_REPORT_FIELD_KEYS = new Set<WeldFieldKey>([
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
])

export const LNK_CONCLUSION_FIELD_KEYS = new Set<WeldFieldKey>([
  'vikConclusionDate',
  'vikConclusion',
  'rkConclusionDate',
  'rkConclusion',
  'pvkConclusionDate',
  'pvkConclusion',
  'uzkConclusionDate',
  'uzkConclusion',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'rfaConclusionDate',
  'rfaConclusion',
  'stlsConclusionDate',
  'stlsConclusion',
  'mkkConclusionDate',
  'mkkConclusion',
  'lnkDefectDescription',
  'lnkNote',
])

export const LNK_EDITABLE_REPORT_FIELD_KEYS = new Set<WeldFieldKey>([
  ...[...LNK_REPORT_FIELD_KEYS].filter((fieldKey) => fieldKey !== 'lnkCreatedAt'),
])
export const LNK_REQUEST_FIELD_KEYS = LNK_METHODS.map((method) => method.requestKey)
export const LNK_GENERATED_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_METHODS.flatMap((method) => [method.resultKey, method.conclusionDateKey, method.conclusionKey]),
  'lnkDefectDescription',
  'lnkNote',
  'lnkCreatedAt',
])
export const LNK_EDITABLE_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_EDITABLE_REPORT_FIELD_KEYS,
])
export const LNK_IMPORT_MATCH_FIELD_KEYS = new Set<WeldFieldKey>(['line', 'joint'])

export const PSTO_SECTION_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
])

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
