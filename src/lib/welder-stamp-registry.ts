import type { StampSelectOption } from '@/components/weld-form'
import { formatDisplayDate } from '@/lib/date-format'
import type { WelderStampExpiryTask } from '@/lib/dispatcher-types'
import {
  DAY_IN_MS as dayInMs,
  FACTUAL_WELDER_STAMP_FIELD_KEY_SET as factualWelderStampFieldKeySet,
  FACTUAL_WELDER_STAMP_FIELD_KEYS as factualWelderStampFieldKeys,
  OFFICIAL_WELDER_STAMP_FIELD_KEYS as officialWelderStampFieldKeys,
  WELDER_STAMP_EXPIRY_REMINDER_DAYS as welderStampExpiryReminderDays,
  WELDER_STAMP_FIELD_KEYS_FOR_DISPLAY as welderStampFieldKeysForDisplay,
  WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions,
} from '@/lib/report-config'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import {
  formatWelderStampDate,
  normalizeWelderStampWeldType,
  splitWelderStampWeldTypes,
} from '@/lib/welder-stamp-format'
import { escapeRegExp } from '@/lib/string-utils'
import type { WelderStampFilters, WelderStampRecord } from '@/lib/welder-stamp-types'

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

export function createEmptyWelderStampFilters(): WelderStampFilters {
  return {
    diameterFrom: '',
    diameterTo: '',
    validFrom: '',
    validTo: '',
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

export function buildWelderStampExpiryTasks(records: WelderStampRecord[]): WelderStampExpiryTask[] {
  const today = parseIsoDateStart(getTodayIsoDate())
  if (!today) return []

  return records.flatMap((record) => {
    const naksStamp = record.naksStamp.trim()
    const validTo = record.validTo.trim()
    const validToDate = parseIsoDateStart(validTo)
    if (record.archived || !naksStamp || !validToDate) return []

    const daysLeft = Math.ceil((validToDate.getTime() - today.getTime()) / dayInMs)
    if (daysLeft > welderStampExpiryReminderDays) return []

    return [
      {
        kind: 'welder-stamp-expiry' as const,
        key: `welder-stamp-expiry:${record.id}:${naksStamp}:${validTo}`,
        stamp: record,
        naksStamp,
        validTo,
        daysLeft,
        expired: daysLeft < 0,
      },
    ]
  })
}

export function filterWelderStampRecords(records: WelderStampRecord[], search: string, filters: WelderStampFilters) {
  const needle = search.trim().toLowerCase()
  const diameterFrom = filters.diameterFrom ? parseWelderStampNumber(filters.diameterFrom) : null
  const diameterTo = filters.diameterTo ? parseWelderStampNumber(filters.diameterTo) : null

  return records.filter((record) =>
    matchesWelderStampTextSearch(record, needle) &&
    matchesWelderStampDiameterFilter(record, diameterFrom, diameterTo) &&
    matchesWelderStampDateFilter(record, filters.validFrom, filters.validTo),
  )
}

function matchesWelderStampTextSearch(record: WelderStampRecord, needle: string) {
  if (!needle) return true

  return [
    record.naksStamp,
    record.internalStamp,
    record.weldType,
    record.diameterFrom,
    record.diameterTo,
    formatWelderStampDate(record.validFrom),
    formatWelderStampDate(record.validTo),
  ]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

function matchesWelderStampDiameterFilter(record: WelderStampRecord, filterFrom: number | null, filterTo: number | null) {
  if (filterFrom === null && filterTo === null) return true

  const recordFrom = record.diameterFrom ? parseWelderStampNumber(record.diameterFrom) : null
  const recordTo = record.diameterTo ? parseWelderStampNumber(record.diameterTo) : null
  if (recordFrom === null) return false

  const effectiveRecordTo = recordTo ?? Number.POSITIVE_INFINITY
  const effectiveFilterFrom = filterFrom ?? Number.NEGATIVE_INFINITY
  const effectiveFilterTo = filterTo ?? Number.POSITIVE_INFINITY

  return recordFrom <= effectiveFilterTo && effectiveRecordTo >= effectiveFilterFrom
}

function matchesWelderStampDateFilter(record: WelderStampRecord, filterFrom: string, filterTo: string) {
  if (!filterFrom && !filterTo) return true
  if (!record.validFrom || !record.validTo) return false

  const effectiveFilterFrom = filterFrom || '0000-01-01'
  const effectiveFilterTo = filterTo || '9999-12-31'

  return record.validFrom <= effectiveFilterTo && record.validTo >= effectiveFilterFrom
}

export function hasWelderStampRangeFilters(filters: WelderStampFilters) {
  return Boolean(filters.diameterFrom || filters.diameterTo || filters.validFrom || filters.validTo)
}

export function countWelderStampFilters(search: string, filters: WelderStampFilters) {
  return [search.trim(), filters.diameterFrom, filters.diameterTo, filters.validFrom, filters.validTo].filter(Boolean).length
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

function parseWelderStampNumber(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildWeldFormStampSelectOptions(
  records: WelderStampRecord[],
  draft?: WeldInput,
): Partial<Record<WeldFieldKey, readonly StampSelectOption[]>> {
  const activeRecords = records.filter((record) => !record.archived)
  const officialOptions = uniqueStampValues(activeRecords.map((record) => record.naksStamp)).map((value) => {
    const reason = draft ? getOfficialStampSelectBlockReason(value, draft, activeRecords) : null
    return {
      value,
      disabled: Boolean(reason),
      reason: reason ?? undefined,
    }
  })
  const factualOptions = uniqueStampValues(
    activeRecords.flatMap((record) => {
      const naksStamp = normalizeStampSelectValue(record.naksStamp)
      if (naksStamp) return [naksStamp]

      const internalStamp = normalizeStampSelectValue(record.internalStamp)
      return internalStamp ? [internalStamp] : []
    }),
  ).map((value) => ({ value }))

  return {
    ...Object.fromEntries(officialWelderStampFieldKeys.map((fieldKey) => [fieldKey, officialOptions])),
    ...Object.fromEntries(factualWelderStampFieldKeys.map((fieldKey) => [fieldKey, factualOptions])),
  }
}

function getOfficialStampSelectBlockReason(stamp: string, draft: WeldInput, activeRecords: WelderStampRecord[]) {
  const stampRecords = activeRecords.filter(
    (record) => normalizeStampForCompare(record.naksStamp) === normalizeStampForCompare(stamp),
  )
  if (stampRecords.length === 0) return 'нет в активном реестре'

  const methods = parseOfficialStampWeldingMethods(draft.weldingMethod)
  const diameters = getOfficialStampJointDiameters(draft)
  if (methods.length === 0 && diameters.length === 0) return null

  if (methods.length === 0) {
    return stampRecords.some((record) => diameters.every((diameter) => isWelderStampDiameterCompatible(diameter, record)))
      ? null
      : `не подходит по диаметру ${formatOfficialStampDiameterList(diameters)}`
  }

  for (const method of methods) {
    const methodRecords = stampRecords.filter((record) => splitWelderStampWeldTypes(record.weldType).includes(method))
    if (methodRecords.length === 0) return `не подходит по типу сварки ${method}`

    if (
      diameters.length > 0 &&
      !methodRecords.some((record) => diameters.every((diameter) => isWelderStampDiameterCompatible(diameter, record)))
    ) {
      return `не подходит по диаметру ${formatOfficialStampDiameterList(diameters)}`
    }
  }

  return null
}

function uniqueStampValues(values: readonly unknown[]) {
  return [...new Set(values.map(normalizeStampSelectValue).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }),
  )
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
        const fieldLabel = FIELD_BY_KEY.get(fieldKey)?.label ?? fieldKey
        throw new Error(
          `Импорт остановлен: ${rowLabel}. Поле "${fieldLabel}" должно быть выбрано из активного реестра клейм. Значение "${value}" не найдено.`,
        )
      }
    }
  })
}

type OfficialStampCompatibilityIssue = {
  fieldKey: WeldFieldKey
  stamp: string
  method: string
  reason: 'missing-registry' | 'missing-weld-type' | 'weld-type' | 'date' | 'diameter'
  message: string
}

type OfficialStampCompatibilityOptions = {
  ignoreArchivedMissingRegistry?: boolean
}

export function getOfficialStampCompatibilitySaveBlockReason(record: WeldInput, welderStampRecords: WelderStampRecord[]) {
  const issue = getOfficialStampCompatibilityIssues(record, welderStampRecords)[0]
  return issue ? formatOfficialStampCompatibilityIssue(issue) : null
}

export function validateOfficialStampCompatibilityForSave(record: WeldInput, welderStampRecords: WelderStampRecord[]) {
  const reason = getOfficialStampCompatibilitySaveBlockReason(record, welderStampRecords)
  if (reason) throw new Error(`Сохранение невозможно: ${reason}`)
}

export function validateOfficialStampCompatibilityForImport(records: WeldInput[], welderStampRecords: WelderStampRecord[]) {
  records.forEach((record, index) => {
    const issue = getOfficialStampCompatibilityIssues(record, welderStampRecords)[0]
    if (!issue) return

    const rowLabel = normalizeStampSelectValue(record.joint) || `строка ${index + 1}`
    throw new Error(`Импорт остановлен: ${rowLabel}. ${formatOfficialStampCompatibilityIssue(issue)}`)
  })
}

export function getOfficialStampCompatibilityIssues(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
  options: OfficialStampCompatibilityOptions = {},
) {
  const activeRecords = welderStampRecords.filter((stampRecord) => !stampRecord.archived)
  const archivedRecords = welderStampRecords.filter((stampRecord) => stampRecord.archived)
  const methods = parseOfficialStampWeldingMethods(record.weldingMethod)
  const diameters = getOfficialStampJointDiameters(record)
  const weldDateValue = getWeldDateOrderValue(record.weldDate)
  const issues: OfficialStampCompatibilityIssue[] = []

  for (const fieldKey of officialWelderStampFieldKeys) {
    const stamp = normalizeStampSelectValue(record[fieldKey])
    if (!stamp) continue

    const stampRecords = activeRecords.filter((stampRecord) => normalizeStampForCompare(stampRecord.naksStamp) === normalizeStampForCompare(stamp))
    if (stampRecords.length === 0) {
      const isArchivedStamp = archivedRecords.some((stampRecord) => normalizeStampForCompare(stampRecord.naksStamp) === normalizeStampForCompare(stamp))
      if (options.ignoreArchivedMissingRegistry && isArchivedStamp) continue

      issues.push({
        fieldKey,
        stamp,
        method: '',
        reason: 'missing-registry',
        message: `Клеймо ${stamp} не найдено в активном реестре клейм.`,
      })
      continue
    }

    if (methods.length === 0) {
      issues.push({
        fieldKey,
        stamp,
        method: '',
        reason: 'missing-weld-type',
        message: `Для клейма ${stamp} нужно указать тип сварки.`,
      })
      continue
    }

    for (const method of methods) {
      const methodRecords = stampRecords.filter((stampRecord) => splitWelderStampWeldTypes(stampRecord.weldType).includes(method))
      if (methodRecords.length === 0) {
        issues.push({
          fieldKey,
          stamp,
          method,
          reason: 'weld-type',
          message: `Клеймо ${stamp} (${method}) не имеет допуска на тип сварки ${method}.`,
        })
        continue
      }

      const dateRecords = weldDateValue
        ? methodRecords.filter((stampRecord) => isWelderStampDateCompatible(weldDateValue, stampRecord))
        : methodRecords
      if (dateRecords.length === 0) {
        issues.push({
          fieldKey,
          stamp,
          method,
          reason: 'date',
          message: `Клеймо ${stamp} (${method}) не соответствует сроку действия на дату сварки ${formatDisplayDate(record.weldDate) || '-'}.`,
        })
        continue
      }

      if (diameters.length > 0 && !dateRecords.some((stampRecord) => diameters.every((diameter) => isWelderStampDiameterCompatible(diameter, stampRecord)))) {
        issues.push({
          fieldKey,
          stamp,
          method,
          reason: 'diameter',
          message: `Клеймо ${stamp} (${method}) не имеет допуска на диаметр ${formatOfficialStampDiameterList(diameters)}.`,
        })
      }
    }
  }

  return issues
}

export function formatOfficialStampCompatibilityIssue(issue: OfficialStampCompatibilityIssue) {
  const fieldLabel = formatWelderStampFieldKeyLabel(issue.fieldKey)
  return `${fieldLabel}: ${issue.message}`
}

function formatWelderStampFieldKeyLabel(fieldKey: WeldFieldKey) {
  return FIELD_BY_KEY.get(fieldKey)?.label ?? fieldKey
}

export function formatWelderStampFieldKeysInText(value: string) {
  return welderStampFieldKeysForDisplay.reduce((text, fieldKey) => {
    return text.replace(new RegExp(`\\b${escapeRegExp(fieldKey)}\\b`, 'g'), formatWelderStampFieldKeyLabel(fieldKey))
  }, value)
}

function parseOfficialStampWeldingMethods(value: unknown) {
  const selected = new Set(
    String(value ?? '')
      .toUpperCase()
      .split(/[+,;/]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  )
  return welderStampWeldTypeOptions.filter((option) => selected.has(option))
}

function normalizeStampForCompare(value: unknown) {
  return normalizeStampSelectValue(value).toUpperCase()
}

function getOfficialStampJointDiameters(record: WeldInput) {
  const diameters = [parseJointDiameterValue(record.d1), parseJointDiameterValue(record.d2)].filter(
    (value): value is number => value !== null,
  )
  return [...new Set(diameters)]
}

function formatOfficialStampDiameterList(diameters: number[]) {
  if (diameters.length === 1) return String(diameters[0])
  return diameters.join(', ')
}

function isWelderStampDateCompatible(weldDateValue: number, record: WelderStampRecord) {
  const validFrom = getWeldDateOrderValue(record.validFrom)
  const validTo = getWeldDateOrderValue(record.validTo)
  return (!validFrom || weldDateValue >= validFrom) && (!validTo || weldDateValue <= validTo)
}

function isWelderStampDiameterCompatible(diameter: number, record: WelderStampRecord) {
  const from = parseWelderStampNumber(record.diameterFrom) ?? 0
  const to = parseWelderStampNumber(record.diameterTo)
  return diameter >= from && (to === null || diameter <= to)
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

function parseIsoDateStart(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function getWeldDateOrderValue(value: unknown) {
  const raw = String(value ?? '').trim()
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return Number(`${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`)
  const displayMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) return Number(`${displayMatch[3]}${displayMatch[2]}${displayMatch[1]}`)
  return 0
}

function parseJointDiameterValue(value: unknown) {
  const raw = String(value ?? '').replace(',', '.').trim()
  if (!raw) return null
  const match = raw.match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}
