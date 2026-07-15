import type { WeldInput } from '@/lib/weld-fields'
import type { OtherSettings, WdiTableSettings } from '@/lib/other-settings'

const INCH_MM = 25.4
const WDI_PRECISION = 2
const WDI_TOLERANCE = 0.001

export function calculateFormulaWdi(record: Pick<WeldInput, 'd1' | 'd2'>): number | null {
  const diameters = [parsePositiveNumber(record.d1), parsePositiveNumber(record.d2)].filter((value): value is number => value !== null)
  if (diameters.length === 0) return null
  return roundWdi(Math.min(...diameters) / INCH_MM)
}

export function calculateTableWdi(record: Pick<WeldInput, 'd1' | 'd2' | 't1' | 't2'>, table: WdiTableSettings | null): number | null {
  if (!table) return null
  const minDiameter = getSmallestPositiveValue([record.d1, record.d2])
  const minThickness = getSmallestPositiveValue([record.t1, record.t2])
  if (minDiameter === null || minThickness === null) return null

  const diameterIndex = findFloorIndex(table.diameters, minDiameter)
  const thicknessIndex = findFloorIndex(table.thicknesses, minThickness)
  if (diameterIndex === -1 || thicknessIndex === -1) return null

  const value = table.values[diameterIndex]?.[thicknessIndex]
  return value === null || value === undefined ? null : roundWdi(value)
}

export function calculateWdi(record: WeldInput, settings: Pick<OtherSettings, 'wdiCalculationMode' | 'wdiTable'>): number | null {
  if (settings.wdiCalculationMode === 'manual') return parseNullableNumber(record.wdi)
  if (settings.wdiCalculationMode === 'table') return calculateTableWdi(record, settings.wdiTable)
  return calculateFormulaWdi(record)
}

export function isSystemWdiMode(settings: Pick<OtherSettings, 'wdiCalculationMode'>) {
  return settings.wdiCalculationMode === 'formula' || settings.wdiCalculationMode === 'table'
}

export function withSystemWdi<T extends WeldInput>(record: T, settings: Pick<OtherSettings, 'wdiCalculationMode' | 'wdiTable'>): T {
  const wdi = calculateWdi(record, settings)
  const nextValue = wdi ?? null
  return normalizeComparableNumber(record.wdi) === normalizeComparableNumber(nextValue) ? record : ({ ...record, wdi: nextValue } as T)
}

export function applySystemWdi(record: WeldInput, settings: Pick<OtherSettings, 'wdiCalculationMode' | 'wdiTable'>) {
  record.wdi = calculateWdi(record, settings)
  return record
}

export function getSystemWdiValidationError(record: WeldInput, settings: Pick<OtherSettings, 'wdiCalculationMode' | 'wdiTable'>) {
  if (!isSystemWdiMode(settings)) return null
  const enteredWdi = parseNullableNumber(record.wdi)
  if (enteredWdi === null) return null

  const calculatedWdi = calculateWdi(record, settings)
  if (calculatedWdi === null) {
    return settings.wdiCalculationMode === 'table'
      ? 'WDI заполнен, но по D1/D2/T1/T2 и загруженной таблице значение не найдено. Укажите размеры, загрузите таблицу или очистите WDI.'
      : 'WDI заполнен, но D1/D2 пустые. Укажите диаметр или очистите WDI.'
  }
  if (Math.abs(enteredWdi - calculatedWdi) <= WDI_TOLERANCE) return null
  return settings.wdiCalculationMode === 'table'
    ? `WDI должен быть ${formatWdi(calculatedWdi)} по таблице дюйм-диаметров.`
    : `WDI должен быть ${formatWdi(calculatedWdi)} по формуле min(D1, D2) / 25,4.`
}

export function formatWdi(value: number) {
  return String(value).replace('.', ',')
}

export { calculateFormulaWdi as calculateSystemWdi }

function parsePositiveNumber(value: unknown) {
  const parsed = parseNullableNumber(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function getSmallestPositiveValue(values: unknown[]) {
  const parsedValues = values.map(parsePositiveNumber).filter((value): value is number => value !== null)
  return parsedValues.length ? Math.min(...parsedValues) : null
}

function parseNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeComparableNumber(value: unknown) {
  const parsed = parseNullableNumber(value)
  return parsed === null ? null : roundWdi(parsed)
}

function findFloorIndex(boundaries: readonly number[], value: number) {
  let result = -1
  for (let index = 0; index < boundaries.length; index += 1) {
    if (boundaries[index] <= value) result = index
    else break
  }
  return result
}

function roundWdi(value: number) {
  const multiplier = 10 ** WDI_PRECISION
  return Math.round(value * multiplier) / multiplier
}
