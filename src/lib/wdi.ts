import type { WeldInput } from '@/lib/weld-fields'
import {
  DEFAULT_WDI_CALCULATION_RULES,
  normalizeWdiCalculationRules,
  type OtherSettings,
  type WdiCalculationRules,
  type WdiConnectionCalculationRule,
  type WdiTableSettings,
} from '@/lib/other-settings'

const INCH_MM = 25.4
const WDI_PRECISION = 2
const WDI_TOLERANCE = 0.001

type WdiCalculationSettings = Pick<OtherSettings, 'wdiCalculationMode' | 'wdiTable'> &
  Partial<Pick<OtherSettings, 'wdiCalculationRules'>>

export function getWdiCalculationDiameter(
  record: Pick<WeldInput, 'connectionType' | 'd1' | 'd2'>,
  rules: WdiCalculationRules = DEFAULT_WDI_CALCULATION_RULES,
): number | null {
  const diameters = [parsePositiveNumber(record.d1), parsePositiveNumber(record.d2)].filter(
    (value): value is number => value !== null,
  )
  if (diameters.length === 0) return null
  const rule = getConnectionCalculationRule(record.connectionType, rules)
  return rule.diameter === 'min' ? Math.min(...diameters) : Math.max(...diameters)
}

export function calculateFormulaWdi(
  record: Pick<WeldInput, 'connectionType' | 'd1' | 'd2'>,
  rules: WdiCalculationRules = DEFAULT_WDI_CALCULATION_RULES,
): number | null {
  const diameter = getWdiCalculationDiameter(record, rules)
  return diameter === null ? null : roundWdi(diameter / INCH_MM)
}

export function calculateTableWdi(
  record: Pick<WeldInput, 'connectionType' | 'd1' | 'd2' | 't1' | 't2'>,
  table: WdiTableSettings | null,
  rules: WdiCalculationRules = DEFAULT_WDI_CALCULATION_RULES,
): number | null {
  if (!table) return null
  const dimensions = getWdiCalculationDimensions(record, rules)
  if (!dimensions) return null

  const diameterIndex = findFloorIndex(table.diameters, dimensions.diameter)
  const thicknessIndex = findFloorIndex(table.thicknesses, dimensions.thickness)
  if (diameterIndex === -1 || thicknessIndex === -1) return null

  const value = table.values[diameterIndex]?.[thicknessIndex]
  return value === null || value === undefined ? null : roundWdi(value)
}

export function calculateWdi(record: WeldInput, settings: WdiCalculationSettings): number | null {
  const rules = normalizeWdiCalculationRules(settings.wdiCalculationRules)
  if (settings.wdiCalculationMode === 'manual') return parseNullableNumber(record.wdi)
  if (settings.wdiCalculationMode === 'table') return calculateTableWdi(record, settings.wdiTable, rules)
  return calculateFormulaWdi(record, rules)
}

export function isSystemWdiMode(settings: Pick<OtherSettings, 'wdiCalculationMode'>) {
  return settings.wdiCalculationMode === 'formula' || settings.wdiCalculationMode === 'table'
}

export function withSystemWdi<T extends WeldInput>(record: T, settings: WdiCalculationSettings): T {
  const wdi = calculateWdi(record, settings)
  const nextValue = wdi ?? null
  return normalizeComparableNumber(record.wdi) === normalizeComparableNumber(nextValue) ? record : ({ ...record, wdi: nextValue } as T)
}

export function applySystemWdi(record: WeldInput, settings: WdiCalculationSettings) {
  record.wdi = calculateWdi(record, settings)
  return record
}

export function getSystemWdiValidationError(record: WeldInput, settings: WdiCalculationSettings) {
  if (!isSystemWdiMode(settings)) return null
  const enteredWdi = parseNullableNumber(record.wdi)
  if (enteredWdi === null) return null

  const calculatedWdi = calculateWdi(record, settings)
  if (calculatedWdi === null) {
    return settings.wdiCalculationMode === 'table'
      ? 'WDI заполнен, но по D1/D2/T1/T2 и настроенной таблице значение не найдено. Укажите размеры, заполните таблицу или очистите WDI.'
      : 'WDI заполнен, но D1/D2 пустые. Укажите диаметр или очистите WDI.'
  }
  if (Math.abs(enteredWdi - calculatedWdi) <= WDI_TOLERANCE) return null
  return settings.wdiCalculationMode === 'table'
    ? `WDI должен быть ${formatWdi(calculatedWdi)} по таблице дюйм-диаметров.`
    : `WDI должен быть ${formatWdi(calculatedWdi)} по формуле D / 25,4 и настроенному правилу выбора диаметра.`
}

export function formatWdi(value: number) {
  return String(value).replace('.', ',')
}

export function areWdiValuesEqual(left: unknown, right: unknown) {
  const leftValue = parseNullableNumber(left)
  const rightValue = parseNullableNumber(right)
  if (leftValue === null || rightValue === null) return leftValue === rightValue
  return leftValue === rightValue
}

export { calculateFormulaWdi as calculateSystemWdi }

function parsePositiveNumber(value: unknown) {
  const parsed = parseNullableNumber(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function getWdiCalculationDimensions(
  record: Pick<WeldInput, 'connectionType' | 'd1' | 'd2' | 't1' | 't2'>,
  rules: WdiCalculationRules,
): { diameter: number; thickness: number } | null {
  const d1 = parsePositiveNumber(record.d1)
  const d2 = parsePositiveNumber(record.d2)
  const t1 = parsePositiveNumber(record.t1)
  const t2 = parsePositiveNumber(record.t2)
  const rule = getConnectionCalculationRule(record.connectionType, rules)

  if (d1 === null && d2 === null) return null
  const independentThickness = getIndependentThickness(rule, t1, t2)
  if (d1 === null) return createDimensions(d2, rule.thickness === 'linked' ? t2 : independentThickness)
  if (d2 === null) return createDimensions(d1, rule.thickness === 'linked' ? t1 : independentThickness)

  const selectedDiameter = rule.diameter === 'min' ? Math.min(d1, d2) : Math.max(d1, d2)
  if (rule.thickness !== 'linked') return createDimensions(selectedDiameter, independentThickness)

  if (d1 === d2) {
    const thicknesses = [t1, t2].filter((value): value is number => value !== null)
    if (thicknesses.length === 0) return null
    return {
      diameter: d1,
      thickness: rule.equalDiameterThickness === 'min' ? Math.min(...thicknesses) : Math.max(...thicknesses),
    }
  }

  const useFirstMaterial = rule.diameter === 'min' ? d1 < d2 : d1 > d2
  const thickness = useFirstMaterial ? t1 : t2
  return createDimensions(useFirstMaterial ? d1 : d2, thickness)
}

function getConnectionCalculationRule(connectionType: unknown, rules: WdiCalculationRules): WdiConnectionCalculationRule {
  return isBranchConnectionType(connectionType) ? rules.branch : rules.other
}

function getIndependentThickness(rule: WdiConnectionCalculationRule, t1: number | null, t2: number | null) {
  if (rule.thickness === 'linked') return null
  const thicknesses = [t1, t2].filter((value): value is number => value !== null)
  if (thicknesses.length === 0) return null
  return rule.thickness === 'min' ? Math.min(...thicknesses) : Math.max(...thicknesses)
}

function createDimensions(diameter: number | null, thickness: number | null) {
  return diameter === null || thickness === null ? null : { diameter, thickness }
}

function isBranchConnectionType(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('ru').startsWith('У')
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
