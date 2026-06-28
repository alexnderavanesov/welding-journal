import { formatDisplayDate } from '@/lib/date-format'
import {
  FACTUAL_WELDER_STAMP_FIELD_KEYS as factualWelderStampFieldKeys,
  OFFICIAL_WELDER_STAMP_FIELD_KEYS as officialWelderStampFieldKeys,
  WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions,
} from '@/lib/report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { StampSelectOption } from '@/lib/weld-form-utils'
import {
  formatWelderStampFieldKeyLabel,
  splitWelderStampWeldTypes,
} from '@/lib/welder-stamp-format'
import { parseWelderStampNumber } from '@/lib/welder-stamp-number'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

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

export function getOfficialStampCompatibilitySaveBlockReason(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
) {
  const issue = getOfficialStampCompatibilityIssues(record, welderStampRecords)[0]
  return issue ? formatOfficialStampCompatibilityIssue(issue) : null
}

export function validateOfficialStampCompatibilityForSave(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
) {
  const reason = getOfficialStampCompatibilitySaveBlockReason(record, welderStampRecords)
  if (reason) throw new Error(`Сохранение невозможно: ${reason}`)
}

export function validateOfficialStampCompatibilityForImport(
  records: WeldInput[],
  welderStampRecords: WelderStampRecord[],
) {
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

    const stampRecords = activeRecords.filter(
      (stampRecord) => normalizeStampForCompare(stampRecord.naksStamp) === normalizeStampForCompare(stamp),
    )
    if (stampRecords.length === 0) {
      const isArchivedStamp = archivedRecords.some(
        (stampRecord) => normalizeStampForCompare(stampRecord.naksStamp) === normalizeStampForCompare(stamp),
      )
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

      if (
        diameters.length > 0 &&
        !dateRecords.some((stampRecord) => diameters.every((diameter) => isWelderStampDiameterCompatible(diameter, stampRecord)))
      ) {
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
