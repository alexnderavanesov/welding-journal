import { FACTUAL_WELDER_STAMP_FIELD_KEY_SET, WELDER_STAMP_WELD_TYPE_OPTIONS } from '@/lib/report-config'
import type { StampSelectOption } from '@/lib/weld-form-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import { formatWelderStampFieldKeyLabel } from '@/lib/welder-stamp-format'

function normalizeStampSelectValue(value: unknown) {
  return String(value ?? '').trim()
}

export function validateWelderStampFieldsForImport(
  records: WeldInput[],
  stampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOption[]>>,
) {
  const entries = Object.entries(stampSelectOptions) as Array<[WeldFieldKey, readonly StampSelectOption[]]>

  records.forEach((record, index) => {
    for (const [fieldKey, options] of entries) {
      if (FACTUAL_WELDER_STAMP_FIELD_KEY_SET.has(fieldKey)) continue

      const value = normalizeStampSelectValue(record[fieldKey])
      if (!value) continue

      const isValid = options.some((option) => normalizeStampSelectValue(option.value) === value)
      if (!isValid) {
        const rowLabel = normalizeStampSelectValue(record.joint) || `строка ${index + 1}`
        const fieldLabel = formatWelderStampFieldKeyLabel(fieldKey)
        throw new Error(
          `Импорт остановлен: ${rowLabel}. Поле "${fieldLabel}" должно быть выбрано из активного реестра клейм. Значение "${value}" не найдено.`,
        )
      }
    }
  })
}

export function normalizeWeldingMethodsForImport(records: WeldInput[]) {
  records.forEach((record, index) => {
    const rawValue = normalizeStampSelectValue(record.weldingMethod)
    if (!rawValue) {
      record.weldingMethod = null
      return
    }

    const parts = rawValue
      .split(/[+,;]+/)
      .map((part) => part.trim())
      .filter(Boolean)
    const invalidParts = parts.filter((part) => !WELDER_STAMP_WELD_TYPE_OPTIONS.includes(part as (typeof WELDER_STAMP_WELD_TYPE_OPTIONS)[number]))

    if (parts.length === 0) {
      record.weldingMethod = null
      return
    }

    if (invalidParts.length > 0) {
      const rowLabel = normalizeStampSelectValue(record.joint) || `строка ${index + 1}`
      throw new Error(
        `Импорт остановлен: ${rowLabel}. Поле "Тип сварки" должно содержать только РАД, РД или МП. Значение "${rawValue}" не подходит.`,
      )
    }

    const selected = new Set(parts)
    record.weldingMethod = WELDER_STAMP_WELD_TYPE_OPTIONS.filter((option) => selected.has(option)).join('+')
  })
}
