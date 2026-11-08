import { describe, expect, it } from 'vitest'
import { getAssignmentWarning, normalizeAssignmentWarningSettings, validateAssignmentWarningSettings, type AssignmentWarningSettings } from './assignment-warnings'
import { projectSettingAffectsDerivedCalculations, projectSettingAffectsDispatcherIndex } from './project-settings-remote'

const settings = (): AssignmentWarningSettings => ({ ...normalizeAssignmentWarningSettings(null), uzk: { enabled: true, thresholds: { С: 8, У: 10, Т: 12 }, text: 'Проверить УЗК' } })
describe('assignment warnings', () => {
  it('starts with the agreed C/U thresholds and no threshold for T', () => {
    expect(normalizeAssignmentWarningSettings(null).uzk.thresholds).toEqual({ С: 8, У: 8, Т: null })
    expect(getAssignmentWarning({ connectionType: 'С17', d1: '6' }, 'hasUzk', 'да', normalizeAssignmentWarningSettings(null))).not.toBeNull()
  })
  it.each([['С17', 8], ['У19', 10], ['Т1', 12]] as const)('uses an inclusive, separate minimum diameter threshold for %s', (connectionType, limit) => {
    for (const value of ['да', 'дополнительный']) {
      expect(getAssignmentWarning({ connectionType, d1: String(limit + 10), d2: String(limit) }, 'hasUzk', value, settings())?.text).toBe('Проверить УЗК')
      expect(getAssignmentWarning({ connectionType, d1: String(limit - 1) }, 'hasUzk', value, settings())).not.toBeNull()
      expect(getAssignmentWarning({ connectionType, d1: String(limit + 0.01) }, 'hasUzk', value, settings())).toBeNull()
    }
  })
  it('accepts fractional diameters and does not mistake missing geometry for zero', () => {
    expect(getAssignmentWarning({ connectionType: ' с17 ', d2: '7,9' }, 'hasUzk', 'да', settings())).not.toBeNull()
    expect(getAssignmentWarning({ connectionType: 'С17' }, 'hasUzk', 'да', settings())).toBeNull()
    const config = settings(); config.uzk.thresholds.С = null
    expect(getAssignmentWarning({ connectionType: 'С17', d1: '6' }, 'hasUzk', 'да', config)).toBeNull()
  })
  it.each(['да', 'дополнительный'])('warns for RK %s on U only', value => {
    expect(getAssignmentWarning({ connectionType: 'У19' }, 'hasRk', value, settings())?.key).toBe('rk')
    for (const connectionType of ['С17', 'Т1', '', 'Н1']) expect(getAssignmentWarning({ connectionType }, 'hasRk', value, settings())).toBeNull()
  })
  it('does not warn on unchanged assignments, clearing, cancellation, or unrelated methods', () => {
    const row = { connectionType: 'У19', d1: '6', hasUzk: 'да' }
    for (const value of ['да', '', null, 'отменен']) expect(getAssignmentWarning(row, 'hasUzk', value, settings())).toBeNull()
    expect(getAssignmentWarning(row, 'hasPvk', 'да', settings())).toBeNull()
    expect(getAssignmentWarning(row, 'hasUzk', 'дополнительный', settings())).toBeNull()
    expect(getAssignmentWarning({ ...row, hasUzk: 'дополнительный' }, 'hasUzk', 'да', settings())).toBeNull()
  })
  it('respects each independent switch and does not dirty calculation indexes', () => {
    const config = settings(); config.uzk.enabled = false; config.rk.enabled = false
    for (const field of ['hasRk', 'hasUzk']) expect(getAssignmentWarning({ connectionType: 'У19', d1: '6' }, field, 'да', config)).toBeNull()
    expect(projectSettingAffectsDispatcherIndex('assignment-warnings')).toBe(false)
    expect(projectSettingAffectsDerivedCalculations('assignment-warnings')).toBe(false)
  })
  it('validates settings before saving', () => {
    expect(validateAssignmentWarningSettings(settings())).toEqual(settings())
    const invalid = settings(); invalid.uzk.thresholds.Т = -1
    expect(() => validateAssignmentWarningSettings(invalid)).toThrow('положительный порог')
    invalid.uzk.thresholds.Т = 12; invalid.rk.text = ' '
    expect(() => validateAssignmentWarningSettings(invalid)).toThrow('Текст предупреждения')
  })
})
