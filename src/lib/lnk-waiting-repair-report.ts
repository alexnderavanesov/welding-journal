import { LNK_METHODS } from './lnk-report-config'
import { PRE_HEAT_TREATMENT_REPORT_FIELDS } from './pre-heat-treatment-report-fields'
import { getPrimaryRejectedLnkResult } from './repeated-joint-task-helpers'
import type { WeldRow } from './dispatcher-types'
import { FIELD_BY_KEY, type WeldField, type WeldFieldKey } from './weld-fields'

// Report-only labels and values never enter the journal's editable field catalogue.
const columns = [
  ['projectTitle', 'Проект'], ['subtitleCode', 'Шифр'], ['line', 'Линия'], ['isometry', 'Изометрия'],
  ['groupName', 'Группа трубопровода'], ['category', 'Категория трубопровода'], ['joint', 'Номер стыка'],
  ['weldingMethod', 'Способ сварки'], ['connectionType', 'Тип соединения'],
  ['d1', 'Диаметр 1-го элемента, мм'], ['t1', 'Толщина стенки 1-го элемента, мм'],
  ['d2', 'Диаметр 2-го элемента, мм'], ['t2', 'Толщина стенки 2-го элемента, мм'],
  ['actualStamps', 'Фактическое клеймо сварщика'], ['controlMethod', 'Вид НК с негодным результатом'],
  ['requestName', '№ заявки'], ['weldDate', 'Дата сварки'], ['requestDate', 'Дата заявки'],
  ['controlDate', 'Дата контроля'], ['result', 'Результат'], ['defectDescription', 'Описание дефектов'],
  ['conclusionName', 'Заключение'], ['requestOrganization', 'Организация, подавшая заявку'],
  ['inspectorStamp', 'Клеймо дефектоскописта'], ['nextJoint', 'Новое имя стыка'], ['lnkNote', 'Примечание ЛНК'],
] as const

export const LNK_WAITING_REPAIR_FIELDS: WeldField[] = columns.map(([key, label]) => ({
  key, label, dbName: key, group: 'Контроль',
  kind: FIELD_BY_KEY.get(key as WeldFieldKey)?.kind ?? (key === 'requestDate' || key === 'controlDate' ? 'date' : 'text'),
}))

// Follow the same rejection (including the exact duplicate-control record) that
// determines the continuation. A different stage can have its own good result.
export function getWaitingRepairControl(row: WeldRow) {
  const rejection = getPrimaryRejectedLnkResult(row)
  if (!rejection) return null
  const common = { result: rejection.result, controlMethod: rejection.method.code }
  const method = LNK_METHODS.find(item => item.resultKey === rejection.method.resultKey)
  if (method) return { ...common, requestName: row[method.requestKey], requestDate: row[method.requestDateKey],
    controlDate: row[method.conclusionDateKey], conclusionName: row[method.conclusionKey],
    defectDescription: row[method.defectDescriptionKey], documentId: row.systemDocumentIds?.[method.conclusionKey] }

  const pre = row.preHeatTreatmentControls?.find(control => `preHeatTreatment:${control.id}` === rejection.method.resultKey)
  if (pre) {
    const field = PRE_HEAT_TREATMENT_REPORT_FIELDS.find(item => item.methodCode === pre.method && item.valueKey === 'conclusionName')
    return { ...common, requestName: pre.requestName, requestDate: pre.requestDate,
      controlDate: pre.conclusionDate, conclusionName: pre.conclusionName, defectDescription: pre.defectDescription,
      documentId: field && row.systemDocumentIds?.[field.fieldKey] }
  }

  const duplicate = row.duplicateControls?.find(control => `duplicate:${control.id}` === rejection.method.resultKey)
  return duplicate ? { ...common, controlDate: duplicate.controlDate, conclusionName: duplicate.conclusion,
    documentId: undefined } : null
}
