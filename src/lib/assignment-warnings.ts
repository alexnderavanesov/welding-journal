import { getMinimumJointDiameter } from '@/lib/joint-display'
import { normalizeControlAvailabilityStorageText } from '@/lib/control-availability-values'
import type { WeldInput } from '@/lib/weld-fields'

export const WARNING_CONNECTION_TYPES = ['С', 'У', 'Т'] as const
export type WarningConnectionType = typeof WARNING_CONNECTION_TYPES[number]
export type AssignmentWarningSettings = {
  uzk: { enabled: boolean; thresholds: Record<WarningConnectionType, number | null>; text: string }
  rk: { enabled: boolean; text: string }
}
export const DEFAULT_ASSIGNMENT_WARNING_SETTINGS: AssignmentWarningSettings = {
  uzk: { enabled: true, thresholds: { С: 8, У: 8, Т: null }, text: 'Для этого диаметра назначение УЗК требует дополнительного внимания. Подтвердить назначение?' },
  rk: { enabled: true, text: 'РК на угловом стыке применяется редко. Подтвердить назначение?' },
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeAssignmentWarningSettings(value: unknown): AssignmentWarningSettings {
  const source = record(value), uzk = record(source.uzk), rk = record(source.rk), thresholds = record(uzk.thresholds)
  const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : fallback
  return {
    uzk: {
      enabled: typeof uzk.enabled === 'boolean' ? uzk.enabled : DEFAULT_ASSIGNMENT_WARNING_SETTINGS.uzk.enabled,
      thresholds: Object.fromEntries(WARNING_CONNECTION_TYPES.map(type => {
        const threshold = thresholds[type] === undefined ? DEFAULT_ASSIGNMENT_WARNING_SETTINGS.uzk.thresholds[type] : thresholds[type]
        return [type, typeof threshold === 'number' && Number.isFinite(threshold) && threshold > 0 ? threshold : null]
      })) as AssignmentWarningSettings['uzk']['thresholds'],
      text: text(uzk.text, DEFAULT_ASSIGNMENT_WARNING_SETTINGS.uzk.text),
    },
    rk: { enabled: typeof rk.enabled === 'boolean' ? rk.enabled : DEFAULT_ASSIGNMENT_WARNING_SETTINGS.rk.enabled, text: text(rk.text, DEFAULT_ASSIGNMENT_WARNING_SETTINGS.rk.text) },
  }
}

export function validateAssignmentWarningSettings(value: unknown): AssignmentWarningSettings {
  const source = record(value)
  for (const method of ['uzk', 'rk'] as const) {
    const rule = record(source[method])
    if (typeof rule.enabled !== 'boolean') throw new Error('Укажите, включено ли предупреждение.')
    if (typeof rule.text !== 'string' || !rule.text.trim() || rule.text.trim().length > 2000) throw new Error('Текст предупреждения должен содержать от 1 до 2000 символов.')
  }
  const thresholds = record(record(source.uzk).thresholds)
  for (const type of WARNING_CONNECTION_TYPES) {
    const threshold = thresholds[type]
    if (threshold !== null && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0)) throw new Error(`Укажите положительный порог Д мин для типа ${type} или оставьте поле пустым.`)
  }
  return normalizeAssignmentWarningSettings(value)
}

export type AssignmentWarning = { key: 'uzk' | 'rk'; field: 'hasUzk' | 'hasRk'; text: string; detail: string }

/** Only an explicit change of assignment is checked; editing geometry alone never prompts. */
export function getAssignmentWarning(row: WeldInput, field: string, nextValue: unknown, settings: AssignmentWarningSettings): AssignmentWarning | null {
  if (field !== 'hasUzk' && field !== 'hasRk') return null
  const next = normalizeControlAvailabilityStorageText(nextValue)
  const previous = normalizeControlAvailabilityStorageText(row[field])
  if ((next !== 'да' && next !== 'дополнительный') || previous === 'да' || previous === 'дополнительный') return null
  const type = String(row.connectionType ?? '').trim().toLocaleUpperCase('ru').slice(0, 1) as WarningConnectionType
  if (field === 'hasRk') return type === 'У' && settings.rk.enabled ? { key: 'rk', field, text: settings.rk.text, detail: 'РК · угловой стык (У)' } : null
  if (!settings.uzk.enabled || !WARNING_CONNECTION_TYPES.includes(type)) return null
  const diameter = getMinimumJointDiameter(row), threshold = settings.uzk.thresholds[type]
  return diameter !== null && threshold !== null && diameter <= threshold
    ? { key: 'uzk', field, text: settings.uzk.text, detail: `УЗК · тип ${type} · Д мин ${diameter} мм ≤ ${threshold} мм` }
    : null
}
