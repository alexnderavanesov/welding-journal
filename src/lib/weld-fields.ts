export type FieldKind = 'text' | 'date' | 'number' | 'boolean'

export type WeldField = {
  key: string
  dbName: string
  label: string
  kind: FieldKind
  group: FieldGroup
  visible?: boolean
}

export type FieldGroup =
  | 'Общее'
  | 'Стык'
  | 'Материалы'
  | 'Сварка'
  | 'Клейма'
  | 'Контроль'
  | 'Статусы/отчетность'

export const WELD_FIELDS = [
  { key: 'weldDate', dbName: 'weld_date', label: 'Дата сварки', kind: 'date', group: 'Общее', visible: true },
  { key: 'projectTitle', dbName: 'project_title', label: 'Проект/Титул', kind: 'text', group: 'Общее', visible: true },
  { key: 'subtitleCode', dbName: 'subtitle_code', label: 'Шифр/Подтитул', kind: 'text', group: 'Общее' },
  { key: 'line', dbName: 'line', label: 'Линия', kind: 'text', group: 'Общее', visible: true },
  { key: 'groupName', dbName: 'group_name', label: 'Группа', kind: 'text', group: 'Общее', visible: true },
  { key: 'category', dbName: 'category', label: 'Категория', kind: 'text', group: 'Общее', visible: true },
  { key: 'pstoRequired', dbName: 'psto_required', label: 'наличие ПСТО', kind: 'text', group: 'Контроль', visible: true },
  { key: 'weldControlPercent', dbName: 'weld_control_percent', label: 'Контроль швов, (%)', kind: 'number', group: 'Контроль' },
  { key: 'isometry', dbName: 'isometry', label: 'Изометрия', kind: 'text', group: 'Стык', visible: true },
  { key: 'sheet', dbName: 'sheet', label: 'Лист', kind: 'number', group: 'Стык' },
  { key: 'revisionNumber', dbName: 'revision_number', label: '№ Изм.', kind: 'number', group: 'Стык' },
  { key: 'jointZone', dbName: 'joint_zone', label: 'Зона стыка', kind: 'text', group: 'Стык' },
  { key: 'jointNominal', dbName: 'joint_nominal', label: 'Ном. стыка', kind: 'number', group: 'Стык' },
  { key: 'indexCode', dbName: 'index_code', label: 'Индкес', kind: 'text', group: 'Стык' },
  { key: 'rwJoint', dbName: 'rw_joint', label: 'R/W стыка', kind: 'text', group: 'Стык' },
  { key: 'joint', dbName: 'joint', label: 'Стык', kind: 'text', group: 'Стык', visible: true },
  { key: 'spoolNumber', dbName: 'spool_number', label: 'Номер спула', kind: 'number', group: 'Стык', visible: true },
  { key: 'spool', dbName: 'spool', label: 'Спул', kind: 'text', group: 'Стык' },
  { key: 'spoolId', dbName: 'spool_id', label: 'ID cпула', kind: 'text', group: 'Стык' },
  { key: 'status', dbName: 'status', label: 'Статус', kind: 'text', group: 'Статусы/отчетность', visible: true },
  { key: 'revisionActuality', dbName: 'revision_actuality', label: 'Актуал-ть (по изм.)', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'orderCode1', dbName: 'order_code_1', label: 'Код заказа 1', kind: 'text', group: 'Материалы' },
  { key: 'orderCode2', dbName: 'order_code_2', label: 'Код заказа 2', kind: 'text', group: 'Материалы' },
  { key: 'element1', dbName: 'element_1', label: 'Элемент 1', kind: 'text', group: 'Материалы' },
  { key: 'element2', dbName: 'element_2', label: 'Элемент 2', kind: 'text', group: 'Материалы' },
  { key: 'materialId1', dbName: 'material_id_1', label: 'ID материала 1', kind: 'text', group: 'Материалы' },
  { key: 'materialId2', dbName: 'material_id_2', label: 'ID материала 2', kind: 'text', group: 'Материалы' },
  { key: 'material1', dbName: 'material_1', label: 'Материал 1', kind: 'text', group: 'Материалы' },
  { key: 'material2', dbName: 'material_2', label: 'Материал 2', kind: 'text', group: 'Материалы' },
  { key: 'weldingMethod', dbName: 'welding_method', label: 'Способ сварки', kind: 'text', group: 'Сварка', visible: true },
  { key: 'connectionType', dbName: 'connection_type', label: 'Тип соедин.', kind: 'text', group: 'Сварка' },
  { key: 'd1', dbName: 'd1', label: 'D1', kind: 'number', group: 'Сварка' },
  { key: 'd2', dbName: 'd2', label: 'D2', kind: 'number', group: 'Сварка' },
  { key: 't1', dbName: 't1', label: 'T1', kind: 'number', group: 'Сварка' },
  { key: 't2', dbName: 't2', label: 'T2', kind: 'number', group: 'Сварка' },
  { key: 'wdi', dbName: 'wdi', label: 'WDI', kind: 'number', group: 'Сварка' },
  { key: 'responsible', dbName: 'responsible', label: 'Ответственный', kind: 'text', group: 'Сварка', visible: true },
  { key: 'stamp1K', dbName: 'stamp_1_k', label: 'Кл. #1 [К]', kind: 'text', group: 'Клейма' },
  { key: 'stamp1Zo', dbName: 'stamp_1_zo', label: 'Кл. #1 [З+О]', kind: 'text', group: 'Клейма' },
  { key: 'stamp2K', dbName: 'stamp_2_k', label: 'Кл. #2 [К]', kind: 'text', group: 'Клейма' },
  { key: 'stamp2Zo', dbName: 'stamp_2_zo', label: 'Кл. #2 [З+О]', kind: 'text', group: 'Клейма' },
  { key: 'stamp1KFact', dbName: 'stamp_1_k_fact', label: 'Кл. #1 [К] (факт)', kind: 'text', group: 'Клейма' },
  { key: 'stamp1ZoFact', dbName: 'stamp_1_zo_fact', label: 'Кл. #1 [З+О] (факт)', kind: 'text', group: 'Клейма' },
  { key: 'stamp2KFact', dbName: 'stamp_2_k_fact', label: 'Кл. #2 [К] (факт)', kind: 'text', group: 'Клейма' },
  { key: 'stamp2ZoFact', dbName: 'stamp_2_zo_fact', label: 'Кл. #2 [З+О] (факт)', kind: 'text', group: 'Клейма' },
  { key: 'hasVik', dbName: 'has_vik', label: 'наличие ВИК', kind: 'boolean', group: 'Контроль', visible: true },
  { key: 'hasRk', dbName: 'has_rk', label: 'наличие РК', kind: 'boolean', group: 'Контроль', visible: true },
  { key: 'hasPvk', dbName: 'has_pvk', label: 'наличие ПВК', kind: 'boolean', group: 'Контроль', visible: true },
  { key: 'hasUzk', dbName: 'has_uzk', label: 'наличие УЗК', kind: 'boolean', group: 'Контроль' },
  { key: 'hasTvmt', dbName: 'has_tvmt', label: 'наличие ТВМТ', kind: 'boolean', group: 'Контроль' },
  { key: 'hasRfa', dbName: 'has_rfa', label: 'наличие РФА', kind: 'boolean', group: 'Контроль' },
  { key: 'hasStls', dbName: 'has_stls', label: 'наличие СТЛС', kind: 'boolean', group: 'Контроль' },
  { key: 'hasMkk', dbName: 'has_mkk', label: 'наличие МКК', kind: 'boolean', group: 'Контроль' },
  { key: 'vikRequest', dbName: 'vik_request', label: 'Заявка ВИК', kind: 'text', group: 'Контроль', visible: true },
  { key: 'rkRequest', dbName: 'rk_request', label: 'Заявка РК', kind: 'text', group: 'Контроль', visible: true },
  { key: 'pvkRequest', dbName: 'pvk_request', label: 'Заявка ПВК', kind: 'text', group: 'Контроль', visible: true },
  { key: 'uzkRequest', dbName: 'uzk_request', label: 'Заявка УЗК', kind: 'text', group: 'Контроль', visible: true },
  { key: 'pstoRequest', dbName: 'psto_request', label: 'Заявка ПСТО', kind: 'text', group: 'Контроль', visible: true },
  { key: 'tvmtRequest', dbName: 'tvmt_request', label: 'Заявка ТВМТ', kind: 'text', group: 'Контроль', visible: true },
  { key: 'rfaRequest', dbName: 'rfa_request', label: 'Заявка РФА', kind: 'text', group: 'Контроль', visible: true },
  { key: 'stlsRequest', dbName: 'stls_request', label: 'Заявка СТЛС', kind: 'text', group: 'Контроль', visible: true },
  { key: 'mkkRequest', dbName: 'mkk_request', label: 'Заявка МКК', kind: 'text', group: 'Контроль', visible: true },
  { key: 'pstoDate', dbName: 'psto_date', label: 'дата ПСТО', kind: 'date', group: 'Контроль', visible: true },
  { key: 'pstoResult', dbName: 'psto_result', label: 'результат ПСТО', kind: 'text', group: 'Контроль' },
  { key: 'heatTreatmentDiagram', dbName: 'heat_treatment_diagram', label: 'диаграмма термообработки', kind: 'text', group: 'Контроль', visible: true },
  { key: 'pstoNote', dbName: 'psto_note', label: 'примечание', kind: 'text', group: 'Контроль', visible: true },
  { key: 'vikResult', dbName: 'vik_result', label: 'результат ВИК', kind: 'text', group: 'Контроль' },
  { key: 'rkResult', dbName: 'rk_result', label: 'результат РК', kind: 'text', group: 'Контроль' },
  { key: 'pvkResult', dbName: 'pvk_result', label: 'результат ПВК', kind: 'text', group: 'Контроль' },
  { key: 'uzkResult', dbName: 'uzk_result', label: 'результат УЗК', kind: 'text', group: 'Контроль' },
  { key: 'tvmtResult', dbName: 'tvmt_result', label: 'результат ТВМТ', kind: 'text', group: 'Контроль' },
  { key: 'rfaResult', dbName: 'rfa_result', label: 'результат РФА', kind: 'text', group: 'Контроль' },
  { key: 'stlsResult', dbName: 'stls_result', label: 'результат СТЛС', kind: 'text', group: 'Контроль' },
  { key: 'mkkResult', dbName: 'mkk_result', label: 'результат МКК', kind: 'text', group: 'Контроль' },
  { key: 'vikConclusionDate', dbName: 'vik_conclusion_date', label: 'Дата ВИК', kind: 'date', group: 'Контроль' },
  { key: 'vikConclusion', dbName: 'vik_conclusion', label: 'Заключение ВИК', kind: 'text', group: 'Контроль' },
  { key: 'rkConclusionDate', dbName: 'rk_conclusion_date', label: 'Дата РК', kind: 'date', group: 'Контроль' },
  { key: 'rkConclusion', dbName: 'rk_conclusion', label: 'Заключение РК', kind: 'text', group: 'Контроль' },
  { key: 'pvkConclusionDate', dbName: 'pvk_conclusion_date', label: 'Дата ПВК', kind: 'date', group: 'Контроль' },
  { key: 'pvkConclusion', dbName: 'pvk_conclusion', label: 'Заключение ПВК', kind: 'text', group: 'Контроль' },
  { key: 'uzkConclusionDate', dbName: 'uzk_conclusion_date', label: 'Дата УЗК', kind: 'date', group: 'Контроль' },
  { key: 'uzkConclusion', dbName: 'uzk_conclusion', label: 'Заключение УЗК', kind: 'text', group: 'Контроль' },
  { key: 'tvmtConclusionDate', dbName: 'tvmt_conclusion_date', label: 'Дата ТВМТ', kind: 'date', group: 'Контроль' },
  { key: 'tvmtConclusion', dbName: 'tvmt_conclusion', label: 'Заключение ТВМТ', kind: 'text', group: 'Контроль' },
  { key: 'rfaConclusionDate', dbName: 'rfa_conclusion_date', label: 'Дата РФА', kind: 'date', group: 'Контроль' },
  { key: 'rfaConclusion', dbName: 'rfa_conclusion', label: 'Заключение РФА', kind: 'text', group: 'Контроль' },
  { key: 'stlsConclusionDate', dbName: 'stls_conclusion_date', label: 'Дата СТЛС', kind: 'date', group: 'Контроль' },
  { key: 'stlsConclusion', dbName: 'stls_conclusion', label: 'Заключение СТЛС', kind: 'text', group: 'Контроль' },
  { key: 'mkkConclusionDate', dbName: 'mkk_conclusion_date', label: 'Дата МКК', kind: 'date', group: 'Контроль' },
  { key: 'mkkConclusion', dbName: 'mkk_conclusion', label: 'Заключение МКК', kind: 'text', group: 'Контроль' },
  { key: 'lnkDefectDescription', dbName: 'lnk_defect_description', label: 'Описание дефектов', kind: 'text', group: 'Контроль' },
  { key: 'lnkNote', dbName: 'lnk_note', label: 'Примечание', kind: 'text', group: 'Контроль' },
  { key: 'finalStatus', dbName: 'final_status', label: 'Итоговый статус', kind: 'text', group: 'Статусы/отчетность', visible: true },
  { key: 'boq', dbName: 'boq', label: 'BoQ сварка', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'ks3', dbName: 'ks3', label: 'КС3 сварка', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'createdAt', dbName: 'created_at', label: 'Внесен сварка', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'pstoBoq', dbName: 'psto_boq', label: 'BoQ ПСТО', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'pstoKs3', dbName: 'psto_ks3', label: 'КС3 ПСТО', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'pstoCreatedAt', dbName: 'psto_created_at', label: 'Внесен ПСТО', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'lnkCreatedAt', dbName: 'lnk_created_at', label: 'Внесен ЛНК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'vikBoq', dbName: 'vik_boq', label: 'BoQ ВИК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'vikKs3', dbName: 'vik_ks3', label: 'КС3 ВИК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'rkBoq', dbName: 'rk_boq', label: 'BoQ РК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'rkKs3', dbName: 'rk_ks3', label: 'КС3 РК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'pvkBoq', dbName: 'pvk_boq', label: 'BoQ ПВК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'pvkKs3', dbName: 'pvk_ks3', label: 'КС3 ПВК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'uzkBoq', dbName: 'uzk_boq', label: 'BoQ УЗК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'uzkKs3', dbName: 'uzk_ks3', label: 'КС3 УЗК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'tvmtBoq', dbName: 'tvmt_boq', label: 'BoQ ТВМТ', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'tvmtKs3', dbName: 'tvmt_ks3', label: 'КС3 ТВМТ', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'rfaBoq', dbName: 'rfa_boq', label: 'BoQ РФА', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'rfaKs3', dbName: 'rfa_ks3', label: 'КС3 РФА', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'stlsBoq', dbName: 'stls_boq', label: 'BoQ СТЛС', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'stlsKs3', dbName: 'stls_ks3', label: 'КС3 СТЛС', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'mkkBoq', dbName: 'mkk_boq', label: 'BoQ МКК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'mkkKs3', dbName: 'mkk_ks3', label: 'КС3 МКК', kind: 'text', group: 'Статусы/отчетность' },
] as const satisfies readonly WeldField[]

export type WeldFieldKey = (typeof WELD_FIELDS)[number]['key']
export type WeldInput = Partial<Record<WeldFieldKey, string | number | boolean | null>>

export const RESULT_STATUS_OPTIONS = ['годен', 'ремонт', 'вырез', 'ожидает', 'ожидает НК'] as const
export const PSTO_RESULT_STATUS_OPTIONS = ['проведено'] as const
export const FINAL_STATUS_OPTIONS = ['годен', 'не годен', 'ожидает', 'ошибка'] as const
export const RESULT_FIELD_KEYS = new Set<WeldFieldKey>([
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'pstoResult',
  'mkkResult',
  'finalStatus',
])

export const CONTROL_RESULT_PAIRS = [
  { enabledKey: 'hasVik', resultKey: 'vikResult' },
  { enabledKey: 'hasRk', resultKey: 'rkResult' },
  { enabledKey: 'hasPvk', resultKey: 'pvkResult' },
  { enabledKey: 'hasUzk', resultKey: 'uzkResult' },
  { enabledKey: 'hasTvmt', resultKey: 'tvmtResult' },
  { enabledKey: 'hasRfa', resultKey: 'rfaResult' },
  { enabledKey: 'hasStls', resultKey: 'stlsResult' },
  { enabledKey: 'hasMkk', resultKey: 'mkkResult' },
] as const satisfies ReadonlyArray<{ enabledKey: WeldFieldKey; resultKey: WeldFieldKey }>

export function calculateFinalStatus(record: WeldInput) {
  const hasResultWithoutEnabledControl = CONTROL_RESULT_PAIRS.some(
    ({ enabledKey, resultKey }) =>
      !isEnabledControl(record[enabledKey]) && !isCancelledControl(record[enabledKey]) && normalizeResultStatus(record[resultKey]) !== null,
  )
  if (hasResultWithoutEnabledControl) return 'ошибка'

  const activeResults = CONTROL_RESULT_PAIRS.filter(({ enabledKey }) => isEnabledControl(record[enabledKey])).map(
    ({ resultKey }) => normalizeResultStatus(record[resultKey]),
  )

  if (activeResults.length === 0) return 'ожидает'
  if (activeResults.includes('вырез')) return 'не годен'
  if (activeResults.includes('ремонт')) return 'не годен'
  if (activeResults.every((result) => result === 'годен')) return 'годен'
  return 'ожидает'
}

export function normalizeResultStatus(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'да') return 'годен'
  if (text === 'проведено') return 'годен'
  const option = RESULT_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? null
}

export function normalizeFinalStatus(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return FINAL_STATUS_OPTIONS.includes(text as never) ? text : null
}

function isEnabledControl(value: unknown) {
  if (value === true) return true
  return String(value ?? '').trim().toLowerCase() === 'да'
}

function isCancelledControl(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'отменен'
}

const EXCLUDED_EXCEL_FIELD_KEYS = new Set(['materialId1', 'materialId2', 'createdAt', 'pstoCreatedAt', 'lnkCreatedAt'])

export const EXCEL_FIELDS = WELD_FIELDS.filter((field) => !EXCLUDED_EXCEL_FIELD_KEYS.has(field.key))
export const FULL_EXCEL_HEADERS = EXCEL_FIELDS.map((field) => field.label)
export const LEGACY_EXCEL_HEADERS = EXCEL_FIELDS.filter((field) => field.key !== 'spoolId').map((field) => field.label)
const HIDDEN_TABLE_FIELD_KEYS = new Set(['jointZone', 'jointNominal', 'indexCode', 'rwJoint', 'spoolNumber'])

const TABLE_LAYOUT = [
  {
    section: 'Проект',
    columns: [
      'Проект/Титул',
      'Шифр/Подтитул',
      'Линия',
      'Группа',
      'Категория',
      'Контроль швов, (%)',
      'Изометрия',
      'Лист',
      '№ Изм.',
      'Актуал-ть (по изм.)',
    ],
  },
  { section: 'Спул', columns: ['Спул', 'ID cпула'] },
  { section: 'Стык', columns: ['Стык', 'Статус'] },
  {
    section: 'Материалы',
    columns: [
      'Код заказа 1',
      'Код заказа 2',
      'Элемент 1',
      'Элемент 2',
      'Материал 1',
      'Материал 2',
    ],
  },
  {
    section: 'Сварка',
    columns: ['Способ сварки', 'Тип соедин.', 'D1', 'D2', 'T1', 'T2', 'WDI', 'Дата сварки', 'Ответственный'],
  },
  {
    section: 'Клейма',
    columns: [
      'Кл. #1 [К]',
      'Кл. #1 [З+О]',
      'Кл. #2 [К]',
      'Кл. #2 [З+О]',
      'Кл. #1 [К] (факт)',
      'Кл. #1 [З+О] (факт)',
      'Кл. #2 [К] (факт)',
      'Кл. #2 [З+О] (факт)',
    ],
  },
  {
    section: 'Контроль',
    columns: [
      'наличие ВИК',
      'наличие РК',
      'наличие ПВК',
      'наличие УЗК',
      'наличие ПСТО',
      'наличие ТВМТ',
      'наличие РФА',
      'наличие СТЛС',
      'наличие МКК',
    ],
  },
  {
    section: 'Заявки',
    columns: [
      'Заявка ВИК',
      'Заявка РК',
      'Заявка ПВК',
      'Заявка УЗК',
      'Заявка ПСТО',
      'Заявка ТВМТ',
      'Заявка РФА',
      'Заявка СТЛС',
      'Заявка МКК',
      'дата ПСТО',
    ],
  },
  {
    section: 'Результат',
    columns: [
      'результат ВИК',
      'результат РК',
      'результат ПВК',
      'результат УЗК',
      'результат ПСТО',
      'диаграмма термообработки',
      'результат ТВМТ',
      'результат РФА',
      'результат СТЛС',
      'результат МКК',
      'примечание',
      'Итоговый статус',
    ],
  },
  {
    section: 'Заключения',
    columns: [
      'Дата ВИК',
      'Заключение ВИК',
      'Дата РК',
      'Заключение РК',
      'Дата ПВК',
      'Заключение ПВК',
      'Дата УЗК',
      'Заключение УЗК',
      'Дата ТВМТ',
      'Заключение ТВМТ',
      'Дата РФА',
      'Заключение РФА',
      'Дата СТЛС',
      'Заключение СТЛС',
      'Дата МКК',
      'Заключение МКК',
      'Описание дефектов',
      'Примечание',
    ],
  },
  {
    section: 'Прочее',
    columns: [
      'BoQ сварка',
      'КС3 сварка',
      'Внесен сварка',
      'BoQ ПСТО',
      'КС3 ПСТО',
      'Внесен ПСТО',
      'Внесен ЛНК',
      'BoQ ВИК',
      'КС3 ВИК',
      'BoQ РК',
      'КС3 РК',
      'BoQ ПВК',
      'КС3 ПВК',
      'BoQ УЗК',
      'КС3 УЗК',
      'BoQ ТВМТ',
      'КС3 ТВМТ',
      'BoQ РФА',
      'КС3 РФА',
      'BoQ СТЛС',
      'КС3 СТЛС',
      'BoQ МКК',
      'КС3 МКК',
    ],
  },
] as const

function fieldByLabel(label: string) {
  const field = WELD_FIELDS.find((candidate) => candidate.label === label)
  if (!field) throw new Error(`Unknown weld field label: ${label}`)
  return field
}

export const VISIBLE_FIELD_SECTIONS = TABLE_LAYOUT.map(({ section, columns }) => ({
  section,
  fields: columns.map(fieldByLabel).filter((field) => !HIDDEN_TABLE_FIELD_KEYS.has(field.key)),
})).filter((group) => group.fields.length > 0)

export const VISIBLE_FIELDS = VISIBLE_FIELD_SECTIONS.flatMap((group) => group.fields)
export const VISIBLE_SECTION_END_FIELD_KEYS = new Set(
  VISIBLE_FIELD_SECTIONS.map((group) => group.fields.at(-1)?.key).filter((key): key is WeldFieldKey => Boolean(key)),
)
export const FIELD_GROUPS = [...new Set(WELD_FIELDS.map((field) => field.group))]

export const FIELD_BY_LABEL = new Map(WELD_FIELDS.map((field) => [normalizeHeader(field.label), field]))
export const FIELD_BY_KEY = new Map(WELD_FIELDS.map((field) => [field.key, field]))

export function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isKnownHeaderSet(headers: string[]) {
  const normalized = headers.map(normalizeHeader).filter(Boolean)
  const hasFull = FULL_EXCEL_HEADERS.every((header) => normalized.includes(header))
  const hasLegacy = LEGACY_EXCEL_HEADERS.every((header) => normalized.includes(header))
  return hasFull || hasLegacy
}
