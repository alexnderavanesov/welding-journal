import type { StampSelectOption } from '@/lib/weld-form-utils'
import {
  FACTUAL_WELDER_STAMP_FIELD_KEY_SET as factualWelderStampFieldKeySet,
  WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions,
} from '@/lib/report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import {
  formatWelderStampFieldKeyLabel,
  formatWelderStampDate,
  normalizeWelderStampWeldType,
} from '@/lib/welder-stamp-format'
import { parseWelderStampNumber } from '@/lib/welder-stamp-number'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function createEmptyWelderStampDraft(): WelderStampRecord {
  return {
    id: 0,
    naksStamp: '',
    internalStamp: '',
    weldType: '',
    diameterFrom: '',
    diameterTo: '',
    validFrom: '',
    validTo: '',
    archived: false,
  }
}

export function normalizeWelderStampRecord(record: WelderStampRecord): WelderStampRecord {
  return {
    ...record,
    naksStamp: normalizeNaksStamp(record.naksStamp),
    internalStamp: record.internalStamp.trim(),
    weldType: normalizeWelderStampWeldType(record.weldType),
    diameterFrom: record.diameterFrom.trim(),
    diameterTo: record.diameterTo.trim(),
    archived: Boolean(record.archived),
  }
}

export function normalizeNaksStamp(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()
}

export function isValidNaksStamp(value: string) {
  return /^[A-Z0-9]{4}$/.test(value)
}

export function validateWelderStampRecord(record: WelderStampRecord) {
  const hasNaksStamp = Boolean(record.naksStamp)

  if (hasNaksStamp && !record.weldType) return 'Укажите Тип сварки'
  if (hasNaksStamp && !record.diameterFrom) return 'Укажите Диаметр от'
  if (hasNaksStamp && !record.validFrom) return 'Укажите Срок действия от'
  if (hasNaksStamp && !record.validTo) return 'Укажите Срок действия до'

  const diameterFrom = record.diameterFrom ? parseWelderStampNumber(record.diameterFrom) : null
  const diameterTo = record.diameterTo ? parseWelderStampNumber(record.diameterTo) : null

  if (diameterFrom === null && record.diameterFrom) return 'Диаметр от должен быть числом'
  if (diameterTo === null && record.diameterTo) return 'Диаметр до должен быть числом'
  if (diameterFrom !== null && diameterTo !== null && diameterFrom > diameterTo) {
    return 'Диапазон диаметра заполнен некорректно: значение «от» больше значения «до»'
  }
  if (record.validFrom && record.validTo && record.validFrom > record.validTo) {
    return 'Срок действия заполнен некорректно: дата «от» позже даты «до»'
  }

  return ''
}

export function prepareWelderStampSave(
  records: WelderStampRecord[],
  record: WelderStampRecord,
  editingId: number | null,
) {
  const draft = normalizeWelderStampRecord(record)
  if (!draft.naksStamp && !draft.internalStamp) {
    return { ok: false as const, message: 'Укажите Клеймо НАКС или Клеймо внутреннее' }
  }
  if (draft.naksStamp && !isValidNaksStamp(draft.naksStamp)) {
    return { ok: false as const, message: 'Клеймо НАКС должно состоять из 4 латинских букв или цифр' }
  }

  const validationError = validateWelderStampRecord(draft)
  if (validationError) return { ok: false as const, message: validationError }

  if (editingId !== null) {
    return {
      ok: true as const,
      nextRecords: records.map((current) => (current.id === editingId ? { ...draft, id: editingId } : current)),
      message: 'Клеймо обновлено',
    }
  }

  const nextId = Math.max(0, ...records.map((current) => current.id)) + 1
  return {
    ok: true as const,
    nextRecords: [{ ...draft, id: nextId }, ...records],
    message: 'Клеймо добавлено',
  }
}

export function setWelderStampRecordArchived(records: WelderStampRecord[], id: number, archived: boolean) {
  return records.map((record) => (record.id === id ? { ...record, archived } : record))
}

export function removeWelderStampRecord(records: WelderStampRecord[], id: number) {
  return records.filter((record) => record.id !== id)
}

export function getWelderStampFormHint(record: WelderStampRecord) {
  const draft = normalizeWelderStampRecord(record)
  const defaultHint =
    'Клеймо НАКС: 4 знака, только латинские буквы и цифры. Если заполнено только внутреннее клеймо, тип сварки, диаметры и срок действия можно не указывать.'

  if (!draft.naksStamp && !draft.internalStamp) return { kind: 'info' as const, text: defaultHint }
  if (draft.naksStamp && !isValidNaksStamp(draft.naksStamp)) {
    return { kind: 'error' as const, text: 'Клеймо НАКС должно состоять из 4 латинских букв или цифр' }
  }

  const validationError = validateWelderStampRecord(draft)
  return validationError ? { kind: 'error' as const, text: validationError } : { kind: 'info' as const, text: defaultHint }
}

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
      if (factualWelderStampFieldKeySet.has(fieldKey)) continue

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
    const invalidParts = parts.filter((part) => !welderStampWeldTypeOptions.includes(part as (typeof welderStampWeldTypeOptions)[number]))

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
    record.weldingMethod = welderStampWeldTypeOptions.filter((option) => selected.has(option)).join('+')
  })
}
