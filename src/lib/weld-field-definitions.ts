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
  { key: 'joint', dbName: 'joint', label: 'Стык', kind: 'text', group: 'Стык', visible: true },
  { key: 'spool', dbName: 'spool', label: 'Спул', kind: 'text', group: 'Стык' },
  { key: 'spoolId', dbName: 'spool_id', label: 'ID cпула', kind: 'text', group: 'Стык' },
  { key: 'status', dbName: 'status', label: 'Статус', kind: 'text', group: 'Статусы/отчетность', visible: true },
  { key: 'revisionActuality', dbName: 'revision_actuality', label: 'Актуальность по изм.', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'orderCode1', dbName: 'order_code_1', label: 'Код заказа 1', kind: 'text', group: 'Материалы' },
  { key: 'orderCode2', dbName: 'order_code_2', label: 'Код заказа 2', kind: 'text', group: 'Материалы' },
  { key: 'element1', dbName: 'element_1', label: 'Элемент 1', kind: 'text', group: 'Материалы' },
  { key: 'element2', dbName: 'element_2', label: 'Элемент 2', kind: 'text', group: 'Материалы' },
  { key: 'materialId1', dbName: 'material_id_1', label: 'ID материала 1', kind: 'text', group: 'Материалы' },
  { key: 'materialId2', dbName: 'material_id_2', label: 'ID материала 2', kind: 'text', group: 'Материалы' },
  { key: 'material1', dbName: 'material_1', label: 'Материал 1', kind: 'text', group: 'Материалы' },
  { key: 'material2', dbName: 'material_2', label: 'Материал 2', kind: 'text', group: 'Материалы' },
  { key: 'weldingMethod', dbName: 'welding_method', label: 'Тип сварки', kind: 'text', group: 'Сварка', visible: true },
  { key: 'connectionType', dbName: 'connection_type', label: 'Тип соедин.', kind: 'text', group: 'Сварка' },
  { key: 'd1', dbName: 'd1', label: 'D1', kind: 'number', group: 'Сварка' },
  { key: 'd2', dbName: 'd2', label: 'D2', kind: 'number', group: 'Сварка' },
  { key: 't1', dbName: 't1', label: 'T1', kind: 'number', group: 'Сварка' },
  { key: 't2', dbName: 't2', label: 'T2', kind: 'number', group: 'Сварка' },
  { key: 'wdi', dbName: 'wdi', label: 'WDI', kind: 'number', group: 'Сварка' },
  { key: 'responsible', dbName: 'responsible', label: 'Ответственный', kind: 'text', group: 'Сварка', visible: true },
  { key: 'stamp1K', dbName: 'stamp_1_k', label: 'Корень_1', kind: 'text', group: 'Клейма' },
  { key: 'stamp1Z', dbName: 'stamp_1_z', label: 'Заполнение_1', kind: 'text', group: 'Клейма' },
  { key: 'stamp1O', dbName: 'stamp_1_o', label: 'Облицовка_1', kind: 'text', group: 'Клейма' },
  { key: 'stamp1KFact', dbName: 'stamp_1_k_fact', label: 'Корень_1 - факт', kind: 'text', group: 'Клейма' },
  { key: 'stamp1ZFact', dbName: 'stamp_1_z_fact', label: 'Заполнение_1 - факт', kind: 'text', group: 'Клейма' },
  { key: 'stamp1OFact', dbName: 'stamp_1_o_fact', label: 'Облицовка_1 - факт', kind: 'text', group: 'Клейма' },
  { key: 'stamp2K', dbName: 'stamp_2_k', label: 'Корень_2', kind: 'text', group: 'Клейма' },
  { key: 'stamp2Z', dbName: 'stamp_2_z', label: 'Заполнение_2', kind: 'text', group: 'Клейма' },
  { key: 'stamp2O', dbName: 'stamp_2_o', label: 'Облицовка_2', kind: 'text', group: 'Клейма' },
  { key: 'stamp2KFact', dbName: 'stamp_2_k_fact', label: 'Корень_2 - факт', kind: 'text', group: 'Клейма' },
  { key: 'stamp2ZFact', dbName: 'stamp_2_z_fact', label: 'Заполнение_2 - факт', kind: 'text', group: 'Клейма' },
  { key: 'stamp2OFact', dbName: 'stamp_2_o_fact', label: 'Облицовка_2 - факт', kind: 'text', group: 'Клейма' },
  { key: 'hasVik', dbName: 'has_vik', label: 'наличие ВИК', kind: 'boolean', group: 'Контроль', visible: true },
  { key: 'hasRk', dbName: 'has_rk', label: 'наличие РК', kind: 'boolean', group: 'Контроль', visible: true },
  { key: 'hasUzk', dbName: 'has_uzk', label: 'наличие УЗК', kind: 'boolean', group: 'Контроль' },
  { key: 'hasPvk', dbName: 'has_pvk', label: 'наличие ПВК', kind: 'boolean', group: 'Контроль', visible: true },
  { key: 'hasTvmt', dbName: 'has_tvmt', label: 'наличие ТВМТ', kind: 'boolean', group: 'Контроль' },
  { key: 'hasRfa', dbName: 'has_rfa', label: 'наличие РФА', kind: 'boolean', group: 'Контроль' },
  { key: 'hasStls', dbName: 'has_stls', label: 'наличие СТЛС', kind: 'boolean', group: 'Контроль' },
  { key: 'hasMkk', dbName: 'has_mkk', label: 'наличие МКК', kind: 'boolean', group: 'Контроль' },
  { key: 'vikRequest', dbName: 'vik_request', label: 'Заявка ВИК', kind: 'text', group: 'Контроль', visible: true },
  { key: 'rkRequest', dbName: 'rk_request', label: 'Заявка РК', kind: 'text', group: 'Контроль', visible: true },
  { key: 'uzkRequest', dbName: 'uzk_request', label: 'Заявка УЗК', kind: 'text', group: 'Контроль', visible: true },
  { key: 'pvkRequest', dbName: 'pvk_request', label: 'Заявка ПВК', kind: 'text', group: 'Контроль', visible: true },
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
  { key: 'uzkResult', dbName: 'uzk_result', label: 'результат УЗК', kind: 'text', group: 'Контроль' },
  { key: 'pvkResult', dbName: 'pvk_result', label: 'результат ПВК', kind: 'text', group: 'Контроль' },
  { key: 'tvmtResult', dbName: 'tvmt_result', label: 'результат ТВМТ', kind: 'text', group: 'Контроль' },
  { key: 'rfaResult', dbName: 'rfa_result', label: 'результат РФА', kind: 'text', group: 'Контроль' },
  { key: 'stlsResult', dbName: 'stls_result', label: 'результат СТЛС', kind: 'text', group: 'Контроль' },
  { key: 'mkkResult', dbName: 'mkk_result', label: 'результат МКК', kind: 'text', group: 'Контроль' },
  { key: 'vikConclusionDate', dbName: 'vik_conclusion_date', label: 'Дата ВИК', kind: 'date', group: 'Контроль' },
  { key: 'vikConclusion', dbName: 'vik_conclusion', label: 'Заключение ВИК', kind: 'text', group: 'Контроль' },
  { key: 'rkConclusionDate', dbName: 'rk_conclusion_date', label: 'Дата РК', kind: 'date', group: 'Контроль' },
  { key: 'rkConclusion', dbName: 'rk_conclusion', label: 'Заключение РК', kind: 'text', group: 'Контроль' },
  { key: 'uzkConclusionDate', dbName: 'uzk_conclusion_date', label: 'Дата УЗК', kind: 'date', group: 'Контроль' },
  { key: 'uzkConclusion', dbName: 'uzk_conclusion', label: 'Заключение УЗК', kind: 'text', group: 'Контроль' },
  { key: 'pvkConclusionDate', dbName: 'pvk_conclusion_date', label: 'Дата ПВК', kind: 'date', group: 'Контроль' },
  { key: 'pvkConclusion', dbName: 'pvk_conclusion', label: 'Заключение ПВК', kind: 'text', group: 'Контроль' },
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
  { key: 'uzkBoq', dbName: 'uzk_boq', label: 'BoQ УЗК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'uzkKs3', dbName: 'uzk_ks3', label: 'КС3 УЗК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'pvkBoq', dbName: 'pvk_boq', label: 'BoQ ПВК', kind: 'text', group: 'Статусы/отчетность' },
  { key: 'pvkKs3', dbName: 'pvk_ks3', label: 'КС3 ПВК', kind: 'text', group: 'Статусы/отчетность' },
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

export function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const FIELD_BY_LABEL = new Map(WELD_FIELDS.map((field) => [normalizeHeader(field.label), field]))
export const FIELD_BY_KEY = new Map(WELD_FIELDS.map((field) => [field.key, field]))
