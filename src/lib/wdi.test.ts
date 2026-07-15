import { describe, expect, it } from 'vitest'
import { calculateSystemWdi, calculateTableWdi, getSystemWdiValidationError, withSystemWdi } from './wdi'
import type { WdiTableSettings } from './other-settings'

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
  it('calculates WDI from the smallest available diameter', () => {
    expect(calculateSystemWdi({ d1: 57, d2: 108 })).toBe(2.24)
    expect(calculateSystemWdi({ d1: '', d2: '25,4' })).toBe(1)
  })

  it('fills WDI on a record without mutating the original object', () => {
    const record = { d1: 50.8, d2: 100, wdi: null }
    const nextRecord = withSystemWdi(record, formulaSettings)

    expect(nextRecord).not.toBe(record)
    expect(nextRecord.wdi).toBe(2)
  })

  it('reports a mismatch when entered WDI does not match the system formula', () => {
    expect(getSystemWdiValidationError({ d1: 50.8, d2: 100, wdi: 2 }, formulaSettings)).toBeNull()
    expect(getSystemWdiValidationError({ d1: 50.8, d2: 100, wdi: 3 }, formulaSettings)).toContain('WDI должен быть 2')
  })

  it('calculates WDI from the uploaded diameter/thickness table using floor boundaries', () => {
    expect(calculateTableWdi({ d1: 20.5, d2: 30, t1: 3.8, t2: 6 }, table)).toBe(0.6)
  })
})
