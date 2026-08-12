import { describe, expect, it } from 'vitest'
import { calculateSystemWdi, calculateTableWdi, getSystemWdiValidationError, withSystemWdi } from './wdi'
import { WDI_CALCULATION_RULE_PRESETS, type WdiCalculationRules, type WdiTableSettings } from './other-settings'

const formulaSettings = { wdiCalculationMode: 'formula', wdiTable: null } as const
const table: WdiTableSettings = {
  fileName: 'Дюймы.xlsx',
  uploadedAt: '2026-07-15T00:00:00.000Z',
  diameters: [10, 14, 17, 18, 20, 21],
  thicknesses: [1, 2, 2.5, 3, 3.5, 4],
  values: [
    [0.2, 0.3, 0, 0, 0, 0],
    [0.3, 0.4, 0.4, 0.4, null, null],
    [0, 0.4, 0.4, 0.4, 0, 0],
    [0, 0.5, 0.5, 0.5, 0.6, 0.6],
    [0, 0.5, 0.6, 0.6, 0.6, 0.6],
    [0, 0.5, 0.5, 0.5, 0.6, 0.6],
  ],
}

describe('system WDI', () => {
  it('uses the largest diameter for ordinary joints and the smallest for У joints', () => {
    expect(calculateSystemWdi({ connectionType: 'С17', d1: 57, d2: 108 })).toBe(4.25)
    expect(calculateSystemWdi({ connectionType: 'У17', d1: 57, d2: 108 })).toBe(2.24)
    expect(calculateSystemWdi({ d1: '', d2: '25,4' })).toBe(1)
  })

  it('fills WDI on a record without mutating the original object', () => {
    const record = { connectionType: 'С17', d1: 50.8, d2: 100, wdi: null }
    const nextRecord = withSystemWdi(record, formulaSettings)

    expect(nextRecord).not.toBe(record)
    expect(nextRecord.wdi).toBe(3.94)
  })

  it('reports a mismatch when entered WDI does not match the system formula', () => {
    expect(getSystemWdiValidationError({ connectionType: 'С17', d1: 50.8, d2: 100, wdi: 3.94 }, formulaSettings)).toBeNull()
    expect(getSystemWdiValidationError({ connectionType: 'С17', d1: 50.8, d2: 100, wdi: 2 }, formulaSettings)).toContain('WDI должен быть 3,94')
  })

  it('uses the D/T pair of Dmax for ordinary joints and Dmin for У joints', () => {
    expect(calculateTableWdi({ connectionType: 'С17', d1: 17, d2: 20.5, t1: 2, t2: 3.8 }, table)).toBe(0.6)
    expect(calculateTableWdi({ connectionType: 'У17', d1: 17, d2: 20.5, t1: 2, t2: 3.8 }, table)).toBe(0.4)
    expect(calculateTableWdi({ connectionType: 'С17', d1: 20.5, d2: 17, t1: 3.8, t2: 2 }, table)).toBe(0.6)
    expect(calculateTableWdi({ connectionType: 'У17', d1: 20.5, d2: 17, t1: 3.8, t2: 2 }, table)).toBe(0.4)
  })

  it('uses Tmax for equal ordinary diameters and Tmin for equal У diameters', () => {
    expect(calculateTableWdi({ connectionType: 'С17', d1: 20.5, d2: 20.5, t1: 2, t2: 3.8 }, table)).toBe(0.6)
    expect(calculateTableWdi({ connectionType: 'У17', d1: 20.5, d2: 20.5, t1: 2, t2: 3.8 }, table)).toBe(0.5)
  })

  it('does not use the thickness of another material when the selected pair is incomplete', () => {
    expect(calculateTableWdi({ connectionType: 'С17', d1: 17, d2: 20.5, t1: 2, t2: null }, table)).toBeNull()
    expect(calculateTableWdi({ connectionType: 'У17', d1: 17, d2: 20.5, t1: null, t2: 3.8 }, table)).toBeNull()
  })

  it('supports independent minimum and maximum diameter/thickness presets', () => {
    const record = { connectionType: 'С17', d1: 17, d2: 20.5, t1: 3.8, t2: 2 }

    expect(calculateSystemWdi(record, WDI_CALCULATION_RULE_PRESETS.minimum)).toBe(0.67)
    expect(calculateTableWdi(record, table, WDI_CALCULATION_RULE_PRESETS.minimum)).toBe(0.4)
    expect(calculateSystemWdi(record, WDI_CALCULATION_RULE_PRESETS.maximum)).toBe(0.81)
    expect(calculateTableWdi(record, table, WDI_CALCULATION_RULE_PRESETS.maximum)).toBe(0.6)
  })

  it('uses the configured linked thickness for equal diameters', () => {
    const rules: WdiCalculationRules = {
      branch: { diameter: 'max', thickness: 'linked', equalDiameterThickness: 'max' },
      other: { diameter: 'min', thickness: 'linked', equalDiameterThickness: 'min' },
    }

    expect(calculateTableWdi({ connectionType: 'С17', d1: 20.5, d2: 20.5, t1: 2, t2: 3.8 }, table, rules)).toBe(0.5)
    expect(calculateTableWdi({ connectionType: 'У17', d1: 20.5, d2: 20.5, t1: 2, t2: 3.8 }, table, rules)).toBe(0.6)
  })

  it('uses an available independent thickness even when the selected diameter material has no thickness', () => {
    const rules: WdiCalculationRules = {
      branch: { diameter: 'min', thickness: 'max', equalDiameterThickness: 'min' },
      other: { diameter: 'max', thickness: 'min', equalDiameterThickness: 'max' },
    }

    expect(calculateTableWdi({ connectionType: 'С17', d1: 17, d2: 20.5, t1: 2, t2: null }, table, rules)).toBe(0.5)
    expect(calculateTableWdi({ connectionType: 'У17', d1: 17, d2: 20.5, t1: null, t2: 3 }, table, rules)).toBe(0.4)
  })
})
