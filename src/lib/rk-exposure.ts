import type { RkExposureTableSettings } from '@/lib/other-settings'
import type { WeldInput } from '@/lib/weld-fields'

export const RK_EXPOSURE_CUSTOM_SCHEME_LABEL = 'Пользовательская схема'
export const RK_EXPOSURE_REVIEW_LABEL = 'Требуется проверить'

export type RkExposureLine = {
  coordinate: string
  description: string
}

export function getRkEffectiveDiameter(record: Pick<WeldInput, 'connectionType' | 'd1' | 'd2'>) {
  const diameters = [record.d1, record.d2]
    .map(parseFiniteNumber)
    .filter((value): value is number => value !== null)
  if (diameters.length === 0) return null
  const isBranchJoint = String(record.connectionType ?? '').trim().toLocaleUpperCase('ru').startsWith('У')
  return isBranchJoint ? Math.min(...diameters) : Math.max(...diameters)
}

export function getRkExposureDiameterEntry(table: RkExposureTableSettings | null, diameter: number | null) {
  if (!table || diameter === null || table.entries.length === 0) return null
  let match = table.entries[0]
  for (const entry of table.entries) {
    if (entry.diameter > diameter) break
    match = entry
  }
  return match
}

export function getDefaultRkExposureOption(table: RkExposureTableSettings | null, diameter: number | null) {
  const entry = getRkExposureDiameterEntry(table, diameter)
  if (!entry) return null
  return entry.options.find((option) => option.isDefault) ?? entry.options[0] ?? null
}

export function parseRkExposureDescription(value: unknown): RkExposureLine[] {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex < 0) return { coordinate: line, description: '' }
      return {
        coordinate: line.slice(0, separatorIndex).trim(),
        description: line.slice(separatorIndex + 1).trim(),
      }
    })
    .filter((line) => line.coordinate)
}

export function serializeRkExposureLines(lines: readonly RkExposureLine[]) {
  return lines
    .map((line) => ({
      coordinate: line.coordinate.trim(),
      description: line.description.trim(),
    }))
    .filter((line) => line.coordinate)
    .map((line) => `${line.coordinate}: ${line.description}`.trimEnd())
    .join('\n')
}

export function buildRkExposureLines(values: readonly string[], result: unknown): RkExposureLine[] {
  const description = isRkGoodResult(result) ? 'ДНО' : ''
  return values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map((coordinate) => ({ coordinate, description }))
}

export function updateRkExposureDescriptionsForResult(lines: readonly RkExposureLine[], result: unknown): RkExposureLine[] {
  const description = isRkGoodResult(result) ? 'ДНО' : ''
  return lines.map((line) => ({ ...line, description }))
}

export function applyRkExposureResultTransition<T extends WeldInput>(
  record: T,
  nextResult: string | null,
  table: RkExposureTableSettings | null,
): T {
  if (!nextResult) {
    return { ...record, lnkDefectDescription: null, rkExposureConfirmedDiameter: null }
  }

  const previousResult = normalizeRkResult(record.rkResult)
  const normalizedNextResult = normalizeRkResult(nextResult)
  if (isRkCancelledResult(normalizedNextResult)) return record
  const currentDescription = String(record.lnkDefectDescription ?? '').trim()
  if (previousResult === normalizedNextResult && currentDescription) return record

  const effectiveDiameter = getRkEffectiveDiameter(record)
  const currentLines = parseRkExposureDescription(currentDescription)
  if (currentLines.length > 0) {
    return {
      ...record,
      lnkDefectDescription: serializeRkExposureLines(
        previousResult === normalizedNextResult
          ? currentLines
          : updateRkExposureDescriptionsForResult(currentLines, normalizedNextResult),
      ),
      rkExposureConfirmedDiameter: record.rkExposureConfirmedDiameter ?? effectiveDiameter,
    }
  }

  const defaultOption = getDefaultRkExposureOption(table, effectiveDiameter)
  if (!defaultOption) return record
  return {
    ...record,
    lnkDefectDescription: serializeRkExposureLines(buildRkExposureLines(defaultOption.values, normalizedNextResult)),
    rkExposureConfirmedDiameter: effectiveDiameter,
  }
}

export function getRkExposureSchemeState(record: WeldInput, table: RkExposureTableSettings | null) {
  const currentDiameter = getRkEffectiveDiameter(record)
  const confirmedDiameter = parseFiniteNumber(record.rkExposureConfirmedDiameter)
  const currentEntry = getRkExposureDiameterEntry(table, currentDiameter)
  const confirmedEntry = getRkExposureDiameterEntry(table, confirmedDiameter)
  const lines = parseRkExposureDescription(record.lnkDefectDescription)

  if (currentEntry && confirmedEntry && currentEntry.diameter !== confirmedEntry.diameter) {
    return { label: RK_EXPOSURE_REVIEW_LABEL, kind: 'review' as const, option: null, currentDiameter }
  }

  const coordinates = lines.map((line) => line.coordinate)
  const option = currentEntry?.options.find((candidate) => areStringListsEqual(candidate.values, coordinates)) ?? null
  if (option) return { label: option.label, kind: 'configured' as const, option, currentDiameter }
  if (coordinates.length > 0) {
    return { label: RK_EXPOSURE_CUSTOM_SCHEME_LABEL, kind: 'custom' as const, option: null, currentDiameter }
  }
  return { label: '', kind: 'empty' as const, option: null, currentDiameter }
}

export function isRkGoodResult(value: unknown) {
  return normalizeRkResult(value) === 'годен'
}

export function normalizeRkResult(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru')
}

export function isRkCancelledResult(value: unknown) {
  const normalized = normalizeRkResult(value)
  return normalized === 'годен (отменен)' || normalized === 'отменен'
}

function areStringListsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value.trim() === right[index]?.trim())
}

function parseFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}
