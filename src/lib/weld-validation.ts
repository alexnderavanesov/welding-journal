import { getRequiredRootStampMessage } from '@/lib/weld-import-export'
import { hasReservedJointSystemPart, normalizeJointName, validateManualJointName } from '@/lib/joint-name'
import { getSystemIndexSummaryText } from '@/lib/system-index-settings'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { getDateInputValidationReason, getTodayIsoDate, parseDateLikeToIso } from '@/lib/date-format'
import { LEGACY_CONTROL_REPLACEMENT_VALUE } from '@/lib/control-availability-values'
import { DEFAULT_SAVE_CHECK_SETTINGS, type SaveCheckSettings } from '@/lib/save-check-settings'

export function validateManualJointNameForSave(
  value: WeldDraft,
  rows: WeldRow[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  validateDateFieldsForSave(value, saveCheckSettings)

  const currentJoint = normalizeJointName(value.joint)
  const previousRow = value.id ? rows.find((row) => row.id === value.id) : null
  const previousJoint = normalizeJointName(previousRow?.joint)
  if (value.id && currentJoint === previousJoint) return

  if (saveCheckSettings.systemJointRenameProtection && previousRow && hasReservedJointSystemPart(previousRow.joint)) {
    throw new Error(`Стык с системными индексами ${getSystemIndexSummaryText()} нельзя переименовывать вручную. Используйте подсказки диспетчера задач.`)
  }

  if (!saveCheckSettings.manualJointName) return

  const error = validateManualJointName(value.joint)
  if (error) throw new Error(error)
}

export function validateWeldDateForSave(value: unknown) {
  const reason = getDateInputValidationReason(value, 'Дата сварки', { disallowFuture: true })
  if (reason) throw new Error(reason)
}

export function validateDateFieldsForSave(
  record: WeldInput,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.dateFormat && !saveCheckSettings.weldDateNotFuture) return

  for (const fieldKey of dateFieldKeys) {
    const field = FIELD_BY_KEY.get(fieldKey)
    if (saveCheckSettings.dateFormat) {
      const reason = getDateInputValidationReason(record[fieldKey], field?.label ?? 'Дата', {
        disallowFuture: fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture,
      })
      if (reason) throw new Error(reason)
      continue
    }

    if (fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture && isFutureDateLike(record[fieldKey])) {
      throw new Error('Дата сварки не может быть позже сегодняшней.')
    }
  }
}

export function validateRequiredRootStampForSave(
  record: WeldInput,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.requiredRootStampWithWeldDate) return

  const message = getRequiredRootStampMessage(record)
  if (message) throw new Error(`Сохранение невозможно: ${message}`)
}

export function normalizeLegacyControlAvailabilityForSave(record: WeldInput) {
  normalizeLegacyControlAvailability(record)
}

function normalizeLegacyControlAvailability(record: WeldInput) {
  for (const fieldKey of legacyControlAvailabilityFieldKeys) {
    if (String(record[fieldKey] ?? '').trim().toLowerCase() === LEGACY_CONTROL_REPLACEMENT_VALUE.toLowerCase()) {
      record[fieldKey] = 'дополнительный' as never
    }
  }
}

export function validateRequiredRootStampsForImport(
  records: WeldInput[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.requiredRootStampWithWeldDate) return

  const invalidRecord = records
    .map((record, index) => ({ record, index, message: getRequiredRootStampMessage(record) }))
    .find((item) => item.message)

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(`Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${invalidRecord.message}`)
}

export function normalizeLegacyControlAvailabilityForImport(records: WeldInput[]) {
  for (const record of records) {
    normalizeLegacyControlAvailability(record)
  }
}

export function validateManualJointNamesForImport(
  records: WeldInput[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.manualJointName) return

  const invalidRecord = records
    .map((record, index) => ({ record, index, error: validateManualJointName(record.joint) }))
    .find((item) => item.error)

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(`Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${invalidRecord.error}`)
}

export function validateWeldDatesForImport(
  records: WeldInput[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.dateFormat && !saveCheckSettings.weldDateNotFuture) return

  const invalidRecord = records
    .flatMap((record, index) =>
      dateFieldKeys.map((fieldKey) => {
        const field = FIELD_BY_KEY.get(fieldKey)
        const reason = saveCheckSettings.dateFormat
          ? getDateInputValidationReason(record[fieldKey], field?.label ?? 'Дата', {
              disallowFuture: fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture,
            })
          : fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture && isFutureDateLike(record[fieldKey])
            ? 'Дата сварки не может быть позже сегодняшней.'
            : ''
        return { record, index, reason }
      }),
    )
    .find((item) => item.reason)

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(`Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${invalidRecord.reason}`)
}

const dateFieldKeys = [...FIELD_BY_KEY.entries()]
  .filter(([, field]) => field.kind === 'date')
  .map(([fieldKey]) => fieldKey as WeldFieldKey)

function isFutureDateLike(value: unknown) {
  const isoDate = parseDateLikeToIso(value)
  return Boolean(isoDate && isoDate > getTodayIsoDate())
}

const legacyControlAvailabilityFieldKeys = [
  'pstoRequired',
  'hasVik',
  'hasRk',
  'hasUzk',
  'hasPvk',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
] as const
