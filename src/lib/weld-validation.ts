import { getRequiredRootStampMessage } from '@/lib/weld-import-export'
import { hasReservedJointSystemPart, normalizeJointName, validateManualJointName } from '@/lib/joint-name'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'

export function validateManualJointNameForSave(value: WeldDraft, rows: WeldRow[]) {
  validateWeldDateForSave(value.weldDate)

  const currentJoint = normalizeJointName(value.joint)
  const previousRow = value.id ? rows.find((row) => row.id === value.id) : null
  const previousJoint = normalizeJointName(previousRow?.joint)
  if (value.id && currentJoint === previousJoint) return

  if (previousRow && hasReservedJointSystemPart(previousRow.joint)) {
    throw new Error('Стык с системными индексами R/W/Y нельзя переименовывать вручную. Используйте подсказки диспетчера задач.')
  }

  const error = validateManualJointName(value.joint)
  if (error) throw new Error(error)
}

export function validateWeldDateForSave(value: unknown) {
  if (!isFutureWeldDate(value)) return
  throw new Error('Дата сварки не может быть позже сегодняшней.')
}

export function validateRequiredRootStampForSave(record: WeldInput) {
  const message = getRequiredRootStampMessage(record)
  if (message) throw new Error(`Сохранение невозможно: ${message}`)
}

export function validateRequiredRootStampsForImport(records: WeldInput[]) {
  const invalidRecord = records
    .map((record, index) => ({ record, index, message: getRequiredRootStampMessage(record) }))
    .find((item) => item.message)

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(`Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${invalidRecord.message}`)
}

export function validateManualJointNamesForImport(records: WeldInput[]) {
  const invalidRecord = records
    .map((record, index) => ({ record, index, error: validateManualJointName(record.joint) }))
    .find((item) => item.error)

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(`Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${invalidRecord.error}`)
}

export function validateWeldDatesForImport(records: WeldInput[]) {
  const invalidRecord = records
    .map((record, index) => ({ record, index }))
    .find((item) => isFutureWeldDate(item.record.weldDate))

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(`Импорт остановлен: строка ${rowNumber}, стык "${joint}". Дата сварки не может быть позже сегодняшней.`)
}

export function isFutureWeldDate(value: unknown) {
  const date = String(value ?? '').trim()
  if (!date) return false
  return date > getTodayIsoDate()
}

export function getTodayIsoDate() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
