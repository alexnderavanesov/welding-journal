import { getRequiredRootStampMessage } from '@/lib/weld-import-export'
import {
  hasReservedJointSystemPart,
  normalizeJointName,
  validateJointNameStructure,
  validateManualJointName,
} from '@/lib/joint-name'
import {
  getSystemIndexSummaryText,
  loadSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { getDateInputValidationReason } from '@/lib/date-format'
import { LEGACY_CONTROL_REPLACEMENT_VALUE } from '@/lib/control-availability-values'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  formatSaveCheckBlockReason,
  type SaveCheckSettingId,
  type SaveCheckSettings,
} from '@/lib/save-check-settings'
import { LNK_METHODS } from '@/lib/lnk-report-config'

export function validateManualJointNameForSave(
  value: WeldDraft,
  rows: WeldRow[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  systemIndexSettings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  validateDateFieldsForSave(value, saveCheckSettings)

  if (saveCheckSettings.manualJointName) {
    const structureError = validateJointNameStructure(value.joint, systemIndexSettings)
    if (structureError) throw new Error(formatSaveCheckBlockReason('manualJointName', structureError))
  }

  const currentJoint = normalizeJointName(value.joint)
  const previousRow = value.id ? rows.find((row) => row.id === value.id) : null
  const previousJoint = normalizeJointName(previousRow?.joint)
  if (value.id && currentJoint === previousJoint) return

  if (saveCheckSettings.systemJointRenameProtection && previousRow && hasReservedJointSystemPart(previousRow.joint, systemIndexSettings)) {
    throw new Error(formatSaveCheckBlockReason(
      'systemJointRenameProtection',
      `Стык с системными индексами ${getSystemIndexSummaryText(systemIndexSettings)} нельзя переименовывать вручную. Используйте подсказки диспетчера задач.`,
    ))
  }

  if (!saveCheckSettings.manualJointName) return

  const error = validateManualJointName(value.joint, systemIndexSettings)
  if (error) throw new Error(formatSaveCheckBlockReason('manualJointName', error))
}

export function validateWeldDateForSave(value: unknown) {
  const reason = getDateInputValidationReason(value, 'Дата сварки', { disallowFuture: true })
  if (reason) throw new Error(formatSaveCheckBlockReason(
    reason.toLocaleLowerCase('ru-RU').includes('позже сегодняшней') ? 'weldDateNotFuture' : 'dateFormat',
    reason,
  ))
}

export function validateDateFieldsForSave(
  record: WeldInput,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  for (const fieldKey of dateFieldKeys) {
    const field = FIELD_BY_KEY.get(fieldKey)
    const reason = getDateInputValidationReason(record[fieldKey], field?.label ?? 'Дата', {
      disallowFuture: fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture,
    })
    if (reason) throw new Error(formatSaveCheckBlockReason(getDateSaveCheckSettingId(fieldKey, reason), reason))
  }
}

export function validateRequiredRootStampForSave(
  record: WeldInput,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.requiredRootStampWithWeldDate) return

  const message = getRequiredRootStampMessage(record)
  if (message) {
    throw new Error(`Сохранение невозможно: ${formatSaveCheckBlockReason('requiredRootStampWithWeldDate', message)}`)
  }
}

export function getRequiredMaterialGroupMessage(record: WeldInput) {
  const hasWeldDate = Boolean(String(record.weldDate ?? '').trim())
  const hasMaterialGroup = Boolean(String(record.materialGroup ?? '').trim())
  return hasWeldDate && !hasMaterialGroup
    ? 'Укажите группу материалов: при заполненной дате сварки это поле обязательно.'
    : null
}

export function validateRequiredMaterialGroupForSave(
  record: WeldInput,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.requiredMaterialGroupWithWeldDate) return

  const message = getRequiredMaterialGroupMessage(record)
  if (message) {
    throw new Error(`Сохранение невозможно: ${formatSaveCheckBlockReason('requiredMaterialGroupWithWeldDate', message)}`)
  }
}

export function getRequiredConnectionTypeMessage(record: WeldInput) {
  const hasWeldDate = Boolean(String(record.weldDate ?? '').trim())
  const hasConnectionType = Boolean(String(record.connectionType ?? '').trim())
  return hasWeldDate && !hasConnectionType
    ? 'Укажите тип соединения: при заполненной дате сварки это поле обязательно.'
    : null
}

export function validateRequiredConnectionTypeForSave(
  record: WeldInput,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.requiredConnectionTypeWithWeldDate) return

  const message = getRequiredConnectionTypeMessage(record)
  if (message) {
    throw new Error(`Сохранение невозможно: ${formatSaveCheckBlockReason('requiredConnectionTypeWithWeldDate', message)}`)
  }
}

export function getRequiredWeldingMethodMessage(record: WeldInput) {
  const hasWeldDate = Boolean(String(record.weldDate ?? '').trim())
  const hasWeldingMethod = Boolean(String(record.weldingMethod ?? '').trim())
  return hasWeldDate && !hasWeldingMethod
    ? 'Укажите способ сварки: при заполненной дате сварки это поле обязательно.'
    : null
}

export function validateRequiredWeldingMethodForSave(
  record: WeldInput,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  if (!saveCheckSettings.requiredWeldingMethodWithWeldDate) return

  const message = getRequiredWeldingMethodMessage(record)
  if (message) {
    throw new Error(`Сохранение невозможно: ${formatSaveCheckBlockReason('requiredWeldingMethodWithWeldDate', message)}`)
  }
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
  throw new Error(
    `Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${formatSaveCheckBlockReason('requiredRootStampWithWeldDate', invalidRecord.message ?? '')}`,
  )
}

export function validateRequiredWeldCoreFieldsForImport(
  records: WeldInput[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const invalidRecord = records
    .map((record, index) => ({
      record,
      index,
      reasons: [
        saveCheckSettings.requiredMaterialGroupWithWeldDate
          ? formatRequiredImportReason('requiredMaterialGroupWithWeldDate', getRequiredMaterialGroupMessage(record))
          : null,
        saveCheckSettings.requiredConnectionTypeWithWeldDate
          ? formatRequiredImportReason('requiredConnectionTypeWithWeldDate', getRequiredConnectionTypeMessage(record))
          : null,
        saveCheckSettings.requiredWeldingMethodWithWeldDate
          ? formatRequiredImportReason('requiredWeldingMethodWithWeldDate', getRequiredWeldingMethodMessage(record))
          : null,
      ].filter((reason): reason is string => Boolean(reason)),
    }))
    .find((item) => item.reasons.length > 0)

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(
    `Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${invalidRecord.reasons.join(' ')}`,
  )
}

function formatRequiredImportReason(id: SaveCheckSettingId, message: string | null) {
  return message ? formatSaveCheckBlockReason(id, message) : null
}

export function normalizeLegacyControlAvailabilityForImport(records: WeldInput[]) {
  for (const record of records) {
    normalizeLegacyControlAvailability(record)
  }
}

export function validateManualJointNamesForImport(
  records: WeldInput[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  systemIndexSettings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  if (!saveCheckSettings.manualJointName) return

  const invalidRecord = records
    .map((record, index) => ({ record, index, error: validateManualJointName(record.joint, systemIndexSettings) }))
    .find((item) => item.error)

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(
    `Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${formatSaveCheckBlockReason('manualJointName', invalidRecord.error ?? '')}`,
  )
}

export function validateWeldDatesForImport(
  records: WeldInput[],
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const invalidRecord = records
    .map((record, index) => ({
      record,
      index,
      issues: dateFieldKeys.flatMap((fieldKey) => {
        const field = FIELD_BY_KEY.get(fieldKey)
        const reason = getDateInputValidationReason(record[fieldKey], field?.label ?? 'Дата', {
          disallowFuture: fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture,
        })
        return reason ? [{ fieldKey, reason }] : []
      }),
    }))
    .find((item) => item.issues.length > 0)

  if (!invalidRecord) return

  const rowNumber = invalidRecord.index + 2
  const joint = normalizeJointName(invalidRecord.record.joint) || 'пусто'
  throw new Error(
    `Импорт остановлен: строка ${rowNumber}, стык "${joint}". ${invalidRecord.issues
      .map(({ fieldKey, reason }) => formatSaveCheckBlockReason(getDateSaveCheckSettingId(fieldKey, reason), reason))
      .join(' ')}`,
  )
}

function getDateSaveCheckSettingId(fieldKey: WeldFieldKey, reason: string): SaveCheckSettingId {
  if (fieldKey === 'weldDate' && reason.toLowerCase().includes('позже сегодняшней')) {
    return 'weldDateNotFuture'
  }
  if (LNK_CONCLUSION_DATE_FIELD_KEYS.has(fieldKey)) return 'lnkResultControlDateFormat'
  if (LNK_REQUEST_DATE_FIELD_KEYS.has(fieldKey)) return 'lnkResultRequestDateOrder'
  if (fieldKey === 'pstoDate') return 'pstoResultDateFormat'
  if (PSTO_CYCLE_DATE_FIELD_KEYS.has(fieldKey)) return 'pstoResultRequestDateOrder'
  return 'dateFormat'
}

const LNK_REQUEST_DATE_FIELD_KEYS = new Set<WeldFieldKey>(
  LNK_METHODS.map((method) => method.requestDateKey),
)
const LNK_CONCLUSION_DATE_FIELD_KEYS = new Set<WeldFieldKey>(
  LNK_METHODS.map((method) => method.conclusionDateKey),
)
const PSTO_CYCLE_DATE_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequestDate',
  'tvmtRequestDate',
  'tvmtConclusionDate',
])

const dateFieldKeys = [...FIELD_BY_KEY.entries()]
  .filter(([, field]) => field.kind === 'date')
  .map(([fieldKey]) => fieldKey as WeldFieldKey)


const legacyControlAvailabilityFieldKeys = [
  'pstoRequired',
  'hasVik',
  'hasRk',
  'hasUzk',
  'hasPvk',
  'hasTvmt',
] as const
