import { normalizeDateLikeForStorage, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getPreHeatTreatmentControl,
  getPreHeatTreatmentControls,
  getRejectedPreHeatTreatmentControls,
  isPreHeatTreatmentLnkMethodCode,
  PRE_HEAT_TREATMENT_LNK_METHODS,
  requiresPreHeatTreatmentLnk,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import {
  getLnkRepairForbiddenReason,
  isLnkRepairForbidden,
} from '@/lib/lnk-result-rules'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { RkExposureTableSettings } from '@/lib/other-settings'
import { hasPrimaryPstoHistory } from '@/lib/psto-line-assignment'
import { applyRkExposureResultTransition } from '@/lib/rk-exposure'

export const PRE_HEAT_TREATMENT_RESULT_OPTIONS = ['годен', 'ремонт', 'вырез'] as const

export type PreHeatTreatmentControlWrite = Omit<PreHeatTreatmentControlRecord, 'id'> & {
  id?: number
}

export function getPreHeatTreatmentRequestBlockReason(
  row: WeldRow,
  rawMethodCode: string,
) {
  const methodCode = normalizeMethodCode(rawMethodCode)
  if (!isPreHeatTreatmentLnkMethodCode(methodCode)) {
    return `${methodCode || 'Выбранный метод'} не выполняется как НК до ТО.`
  }
  if (!requiresPreHeatTreatmentLnk(row)) {
    return 'НК до ТО доступен только на линии с ПСТО.'
  }
  const method = PRE_HEAT_TREATMENT_LNK_METHODS.find((candidate) => candidate.code === methodCode)!
  if (!isControlEnabledValue(row[method.enabledKey])) return `${methodCode} не назначен.`
  if (getRejectedPreHeatTreatmentControls(row).length > 0) {
    return 'Уже сохранен негодный результат НК до ТО.'
  }
  const current = getPreHeatTreatmentControl(row, methodCode)
  if (text(current?.requestName) || hasFinalResult(current?.result)) {
    return `${methodCode} до ТО уже входит в заявку или имеет результат.`
  }
  return ''
}

export function canCreatePreHeatTreatmentRequest(
  row: WeldRow,
  methodCode: string,
) {
  return !getPreHeatTreatmentRequestBlockReason(row, methodCode)
}

export function getPreHeatTreatmentResultBlockReason(
  row: WeldRow,
  rawMethodCode: string,
) {
  const methodCode = normalizeMethodCode(rawMethodCode)
  if (!isPreHeatTreatmentLnkMethodCode(methodCode)) return 'Выберите вид НК до ТО.'
  if (!requiresPreHeatTreatmentLnk(row)) {
    return 'НК до ТО доступен только на линии с ПСТО.'
  }
  const current = getPreHeatTreatmentControl(row, methodCode)
  if (!current || !text(current.requestName)) return `Сначала создайте заявку ${methodCode} до ТО.`
  if (hasFinalResult(current.result)) return `Результат ${methodCode} до ТО уже сохранен.`
  const rejected = getRejectedPreHeatTreatmentControls(row)
  if (rejected.length > 0) {
    return `НК до ТО уже имеет негодный результат: ${rejected.map(({ methodCode: code }) => code).join(', ')}.`
  }
  if (methodCode !== 'ВИК') {
    const vik = getPreHeatTreatmentControl(row, 'ВИК')
    if (text(vik?.result).toLocaleLowerCase('ru-RU') !== 'годен') {
      return 'Сначала внесите годный результат ВИК до ТО.'
    }
  }
  return ''
}

export function canAddPreHeatTreatmentResult(
  row: WeldRow,
  methodCode: string,
) {
  return !getPreHeatTreatmentResultBlockReason(row, methodCode)
}

export function buildPreHeatTreatmentRequestWrites({
  row,
  methodCodes,
  requestName,
  requestDate,
}: {
  row: WeldRow
  methodCodes: string[]
  requestName: string
  requestDate: string
}): PreHeatTreatmentControlWrite[] {
  const name = requestName.trim()
  if (!name) throw new Error('Укажите наименование заявки НК до ТО.')
  const date = requireDate(requestDate, 'Укажите дату заявки НК до ТО.')
  const methodBlockReason = methodCodes
    .map((methodCode) => getPreHeatTreatmentRequestBlockReason(row, methodCode))
    .find(Boolean)
  if (methodBlockReason) throw new Error(`Стык ${formatJoint(row)}: ${methodBlockReason}`)
  assertNotBeforeWeld(row, date, 'Дата заявки НК до ТО')
  assertNotAfterPsto(row, date, 'Дата заявки НК до ТО')

  const methods = [...new Set(methodCodes.map(normalizeMethodCode))]
  if (methods.length === 0) throw new Error('Выберите хотя бы один вид НК до ТО.')
  return methods.map((methodCode) => {
    if (!isPreHeatTreatmentLnkMethodCode(methodCode)) {
      throw new Error(`Метод ${methodCode || '-'} не выполняется как НК до ТО.`)
    }
    const current = getPreHeatTreatmentControl(row, methodCode)
    return {
      ...(current ?? { weldJointId: row.id, method: methodCode }),
      weldJointId: row.id,
      method: methodCode,
      requestName: name,
      requestDate: date,
      result: 'ожидает НК',
    }
  })
}

export function buildPreHeatTreatmentResultWrite({
  row,
  methodCode: rawMethodCode,
  controlDate,
  result,
  conclusionName,
  defectDescription,
  rkExposureConfirmedDiameter,
  rkExposureTable = null,
}: {
  row: WeldRow
  methodCode: string
  controlDate: string
  result: string
  conclusionName: string
  defectDescription?: string
  rkExposureConfirmedDiameter?: number | null
  rkExposureTable?: RkExposureTableSettings | null
}): PreHeatTreatmentControlWrite {
  const methodCode = normalizeMethodCode(rawMethodCode)
  if (!isPreHeatTreatmentLnkMethodCode(methodCode)) {
    throw new Error('Выберите вид НК до ТО.')
  }
  const blockReason = getPreHeatTreatmentResultBlockReason(row, methodCode)
  if (blockReason) throw new Error(`Стык ${formatJoint(row)}: ${blockReason}`)
  const current = getPreHeatTreatmentControl(row, methodCode)
  if (!current) throw new Error(`Стык ${formatJoint(row)}: позиция НК до ТО не найдена.`)
  const date = requireDate(controlDate, 'Укажите дату контроля НК до ТО.')
  assertNotBeforeWeld(row, date, 'Дата НК до ТО')
  assertNotBefore(
    date,
    current.requestDate,
    `Стык ${formatJoint(row)}: дата НК до ТО не может быть раньше даты заявки.`,
  )
  assertNotAfterPsto(row, date, 'Дата НК до ТО')
  assertPreHeatTreatmentVikOrder(row, methodCode, date)

  const normalizedResult = text(result).toLocaleLowerCase('ru-RU')
  if (!PRE_HEAT_TREATMENT_RESULT_OPTIONS.includes(normalizedResult as never)) {
    throw new Error('Выберите результат НК до ТО.')
  }
  if (normalizedResult === 'ремонт' && isLnkRepairForbidden(row)) {
    throw new Error(
      `Стык ${formatJoint(row)}: результат «ремонт» нельзя сохранить: ${getLnkRepairForbiddenReason(row)}.`,
    )
  }
  const name = conclusionName.trim()
  if (!name) throw new Error('Укажите наименование заключения НК до ТО.')

  const exposureRecord = methodCode === 'РК'
    ? applyRkExposureResultTransition({
        ...row,
        rkResult: current.result,
        lnkDefectDescription: defectDescription ?? current.defectDescription,
        rkExposureConfirmedDiameter:
          rkExposureConfirmedDiameter === undefined
            ? current.rkExposureConfirmedDiameter
            : rkExposureConfirmedDiameter,
      }, normalizedResult, rkExposureTable)
    : null

  return {
    ...current,
    weldJointId: row.id,
    method: methodCode,
    result: normalizedResult,
    conclusionDate: date,
    conclusionName: name,
    defectDescription: methodCode === 'РК'
      ? text(exposureRecord?.lnkDefectDescription)
      : text(defectDescription),
    ...(methodCode === 'РК'
      ? { rkExposureConfirmedDiameter: exposureRecord?.rkExposureConfirmedDiameter ?? null }
      : {}),
  }
}

export function buildPreHeatTreatmentResultCorrectionWrite({
  row,
  control,
  controlDate,
  result,
  conclusionName,
  rkExposureTable = null,
}: {
  row: WeldRow
  control: PreHeatTreatmentControlRecord
  controlDate: string
  result: string
  conclusionName: string
  rkExposureTable?: RkExposureTableSettings | null
}): PreHeatTreatmentControlWrite {
  const methodCode = normalizeMethodCode(control.method)
  if (!isPreHeatTreatmentLnkMethodCode(methodCode)) throw new Error('Вид НК до ТО не определен.')
  if (!text(control.requestName)) throw new Error(`Стык ${formatJoint(row)}: у ${methodCode} до ТО нет заявки.`)

  const date = requireDate(controlDate, 'Укажите дату контроля НК до ТО.')
  assertNotBeforeWeld(row, date, 'Дата НК до ТО')
  assertNotBefore(
    date,
    control.requestDate,
    `Стык ${formatJoint(row)}: дата НК до ТО не может быть раньше даты заявки.`,
  )
  assertNotAfterPsto(row, date, 'Дата НК до ТО')
  assertPreHeatTreatmentVikOrder(row, methodCode, date)

  const normalizedResult = text(result).toLocaleLowerCase('ru-RU')
  const currentResult = text(control.result).toLocaleLowerCase('ru-RU')
  if (!PRE_HEAT_TREATMENT_RESULT_OPTIONS.includes(normalizedResult as never)) {
    throw new Error('Выберите результат НК до ТО.')
  }
  if (normalizedResult === 'ремонт' && isLnkRepairForbidden(row)) {
    throw new Error(`Стык ${formatJoint(row)}: результат «ремонт» нельзя сохранить: ${getLnkRepairForbiddenReason(row)}.`)
  }
  if (normalizedResult !== currentResult && normalizedResult !== 'годен' && hasDownstreamPsto(row)) {
    throw new Error(
      `Стык ${formatJoint(row)}: нельзя установить «${normalizedResult}» для НК до ТО, пока сохранены последующие этапы ПСТО/ТВМТ.`,
    )
  }
  if (methodCode === 'ВИК' && normalizedResult !== currentResult && normalizedResult !== 'годен') {
    const dependentMethods = getDependentPreHeatTreatmentResultMethods(row)
    if (dependentMethods.length > 0) {
      throw new Error(
        `Стык ${formatJoint(row)}: результат ВИК до ТО нельзя изменить, пока сохранены результаты: ${dependentMethods.join(', ')}.`,
      )
    }
  }
  const name = conclusionName.trim()
  if (!name) throw new Error('Укажите наименование заключения НК до ТО.')

  const exposureRecord = methodCode === 'РК'
    ? applyRkExposureResultTransition({
        ...row,
        rkResult: control.result,
        lnkDefectDescription: control.defectDescription,
        rkExposureConfirmedDiameter: control.rkExposureConfirmedDiameter,
      }, normalizedResult, rkExposureTable)
    : null

  return {
    ...control,
    result: normalizedResult,
    conclusionDate: date,
    conclusionName: name,
    ...(methodCode === 'РК' ? {
      defectDescription: text(exposureRecord?.lnkDefectDescription),
      rkExposureConfirmedDiameter: exposureRecord?.rkExposureConfirmedDiameter ?? null,
    } : {}),
  }
}

export function buildPreHeatTreatmentRequestCorrectionWrite({
  row,
  control,
  requestName,
  requestDate,
}: {
  row: WeldRow
  control: PreHeatTreatmentControlRecord
  requestName: string
  requestDate: string
}): PreHeatTreatmentControlWrite {
  const methodCode = normalizeMethodCode(control.method)
  if (!isPreHeatTreatmentLnkMethodCode(methodCode)) throw new Error('Вид НК до ТО не определен.')
  const name = requestName.trim()
  if (!name) throw new Error('Укажите наименование заявки НК до ТО.')
  const date = requireDate(requestDate, 'Укажите дату заявки НК до ТО.')
  assertNotBeforeWeld(row, date, 'Дата заявки НК до ТО')
  assertNotBefore(
    parseDateLikeToIso(control.conclusionDate) ?? date,
    date,
    `Стык ${formatJoint(row)}: дата заявки НК до ТО не может быть позже даты контроля.`,
  )
  assertNotAfterPsto(row, date, 'Дата заявки НК до ТО')
  return {
    ...control,
    requestName: name,
    requestDate: date,
  }
}

export function getPreHeatTreatmentRequestRemovalBlockReason(
  row: WeldRow,
  control: PreHeatTreatmentControlRecord,
) {
  if (
    hasFinalResult(control.result) ||
    text(control.conclusionDate) ||
    text(control.conclusionName)
  ) {
    return 'Сначала удалите результат и заключение НК до ТО.'
  }
  if (hasDownstreamPsto(row)) {
    return 'Заявку НК до ТО нельзя удалить, пока сохранены последующие этапы ПСТО/ТВМТ.'
  }
  return ''
}

export function getPreHeatTreatmentResultRemovalBlockReason(
  row: WeldRow,
  control: PreHeatTreatmentControlRecord,
) {
  if (hasDownstreamPsto(row)) {
    return 'Результат НК до ТО нельзя удалить, пока сохранены заявка, результат ПСТО, ТВМТ или повторный цикл.'
  }
  if (normalizeMethodCode(control.method) !== 'ВИК') return ''
  const dependentMethods = getDependentPreHeatTreatmentResultMethods(row)
  return dependentMethods.length > 0
    ? `Результат ВИК до ТО нельзя удалить, пока сохранены результаты: ${dependentMethods.join(', ')}.`
    : ''
}

function getDependentPreHeatTreatmentResultMethods(row: WeldRow) {
  return getPreHeatTreatmentControls(row)
    .filter((candidate) => normalizeMethodCode(candidate.method) !== 'ВИК' && hasFinalResult(candidate.result))
    .map((candidate) => normalizeMethodCode(candidate.method))
}

function hasDownstreamPsto(row: WeldRow) {
  return hasPrimaryPstoHistory(row) || (row.pstoRepeatCycles?.length ?? 0) > 0
}

function assertPreHeatTreatmentVikOrder(
  row: WeldRow,
  methodCode: PreHeatTreatmentLnkMethodCode,
  date: string,
) {
  if (methodCode === 'ВИК') {
    const laterControl = PRE_HEAT_TREATMENT_LNK_METHODS
      .filter((method) => method.code !== 'ВИК')
      .map((method) => getPreHeatTreatmentControl(row, method.code))
      .find((control) => {
        const controlDate = parseDateLikeToIso(control?.conclusionDate)
        return controlDate && date > controlDate
      })
    if (laterControl) {
      throw new Error(`Стык ${formatJoint(row)}: ВИК до ТО должен быть выполнен не позже остальных видов НК до ТО.`)
    }
    return
  }
  const vik = getPreHeatTreatmentControl(row, 'ВИК')
  const vikDate = parseDateLikeToIso(vik?.conclusionDate)
  if (!vik || text(vik.result).toLocaleLowerCase('ru-RU') !== 'годен' || !vikDate) {
    throw new Error(`Стык ${formatJoint(row)}: сначала внесите годный результат ВИК до ТО.`)
  }
  if (date < vikDate) {
    throw new Error(`Стык ${formatJoint(row)}: ${methodCode} до ТО не может быть раньше ВИК до ТО.`)
  }
}

function assertNotBeforeWeld(row: WeldRow, date: string, label: string) {
  assertNotBefore(
    date,
    row.weldDate,
    `Стык ${formatJoint(row)}: ${label.toLowerCase()} не может быть раньше даты сварки.`,
  )
}

function assertNotAfterPsto(row: WeldRow, date: string, label: string) {
  const pstoDate = parseDateLikeToIso(row.pstoDate)
  if (pstoDate && date > pstoDate) {
    throw new Error(`Стык ${formatJoint(row)}: ${label.toLowerCase()} не может быть позже даты ПСТО.`)
  }
}

function assertNotBefore(date: string, minimum: unknown, message: string) {
  const minimumDate = parseDateLikeToIso(minimum)
  if (minimumDate && date < minimumDate) throw new Error(message)
}

function requireDate(value: string, message: string) {
  const date = normalizeDateLikeForStorage(value)
  if (!date) throw new Error(message)
  return date
}

function hasFinalResult(value: unknown) {
  return PRE_HEAT_TREATMENT_RESULT_OPTIONS.includes(
    text(value).toLocaleLowerCase('ru-RU') as never,
  )
}

function normalizeMethodCode(value: unknown) {
  return text(value).toLocaleUpperCase('ru-RU')
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function formatJoint(row: WeldRow) {
  return text(row.joint) || `ID ${row.id}`
}
