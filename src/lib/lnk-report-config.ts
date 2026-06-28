import type { WeldField, WeldFieldKey } from './weld-field-definitions'

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

