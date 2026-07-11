import {
  FACTUAL_WELDER_STAMP_FIELD_KEYS as factualWelderStampFieldKeys,
  OFFICIAL_WELDER_STAMP_FIELD_KEYS as officialWelderStampFieldKeys,
} from '@/lib/report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { StampSelectOption } from '@/lib/weld-form-utils'
import {
  formatWelderStampSuspensionBlockReason,
  getSuspensionOverlapForStamp,
} from '@/lib/welder-stamp-suspensions'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import {
  formatOfficialStampDiameterList,
  getOfficialStampJointDiameters,
  isWelderStampDiameterCompatible,
  normalizeStampForCompare,
  normalizeStampSelectValue,
  parseOfficialStampWeldingMethods,
  splitOfficialStampWeldTypes,
} from '@/lib/welder-stamp-compatibility-utils'

export function buildWeldFormStampSelectOptions(
  records: WelderStampRecord[],
  draft?: WeldInput,
  allowedArchivedOfficialStamps: readonly string[] = [],
  suspensions: readonly WelderStampSuspensionRecord[] = [],
  options: { includeArchivedStamps?: boolean } = {},
): Partial<Record<WeldFieldKey, readonly StampSelectOption[]>> {
  const activeRecords = records.filter((record) => !record.archived)
  const optionRecords = options.includeArchivedStamps ? records : activeRecords
  const allowedArchivedStampValues = getExistingArchivedOfficialStampValues(allowedArchivedOfficialStamps, records)
  const configuredArchivedStampValues = options.includeArchivedStamps
    ? uniqueStampValues(records.filter((record) => record.archived).map((record) => record.naksStamp))
    : []
  const allowedArchivedStampSet = new Set(allowedArchivedStampValues.map(normalizeStampForCompare))
  const configuredArchivedStampSet = new Set(configuredArchivedStampValues.map(normalizeStampForCompare))
  const officialOptions = uniqueStampValues([
    ...activeRecords.map((record) => record.naksStamp),
    ...allowedArchivedStampValues,
    ...configuredArchivedStampValues,
  ]).map((value) => {
    const hasActiveRecord = activeRecords.some(
      (record) => normalizeStampForCompare(record.naksStamp) === normalizeStampForCompare(value),
    )
    const normalizedValue = normalizeStampForCompare(value)
    const isAllowedArchivedOnly = !hasActiveRecord && allowedArchivedStampSet.has(normalizedValue)
    const isConfiguredArchivedOnly = !hasActiveRecord && configuredArchivedStampSet.has(normalizedValue)
    const suspension = draft ? getSuspensionOverlapForStamp(suspensions, value, draft.weldDate) : null
    const reason = suspension
      ? formatWelderStampSuspensionBlockReason(suspension)
      : !isAllowedArchivedOnly && !isConfiguredArchivedOnly && draft
        ? getOfficialStampSelectBlockReason(value, draft, activeRecords)
        : null
    return {
      value,
      disabled: Boolean(reason),
      reason: reason ?? undefined,
    }
  })
  const factualOptions = uniqueStampValues(
    optionRecords.flatMap((record) => {
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

export function getArchivedOfficialStampValuesForRecord(record: WeldInput | undefined, records: WelderStampRecord[]) {
  if (!record) return []

  const archivedStampSet = new Set(
    records
      .filter((stampRecord) => stampRecord.archived)
      .map((stampRecord) => normalizeStampForCompare(stampRecord.naksStamp))
      .filter(Boolean),
  )

  return uniqueStampValues(
    officialWelderStampFieldKeys
      .map((fieldKey) => record[fieldKey])
      .filter((value) => archivedStampSet.has(normalizeStampForCompare(value))),
  )
}

function getExistingArchivedOfficialStampValues(values: readonly string[], records: WelderStampRecord[]) {
  const archivedStampSet = new Set(
    records
      .filter((stampRecord) => stampRecord.archived)
      .map((stampRecord) => normalizeStampForCompare(stampRecord.naksStamp))
      .filter(Boolean),
  )

  return uniqueStampValues(values.filter((value) => archivedStampSet.has(normalizeStampForCompare(value))))
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
    const methodRecords = stampRecords.filter((record) => splitOfficialStampWeldTypes(record).includes(method))
    if (methodRecords.length === 0) return `не подходит по способу сварки ${method}`

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
