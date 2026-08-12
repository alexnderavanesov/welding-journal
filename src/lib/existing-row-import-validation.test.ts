import { describe, expect, it } from 'vitest'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { assertExistingRowsImportPayload } from './existing-row-import-validation'

const previousRows = new Map([
  [7, {
    id: 7,
    joint: 'S7',
    weldDate: '2026-08-01',
    material1: '09Г2С',
    lnkNote: null,
    hasVik: 'да',
  }],
])

describe('assertExistingRowsImportPayload', () => {
  it('accepts an empty field fill and rejects overwriting an existing value in mass-fill mode', () => {
    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, lnkNote: 'Проверено' }],
      previousRows,
      mode: 'massFill',
      otherSettings: DEFAULT_OTHER_SETTINGS,
    })).not.toThrow()

    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, material1: '12Х18Н10Т' }],
      previousRows,
      mode: 'massFill',
      otherSettings: DEFAULT_OTHER_SETTINGS,
    })).toThrow(/Марка стали 1.*недоступно/)
  })

  it('does not allow mass fill to clear a value', () => {
    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, lnkNote: null }],
      previousRows,
      mode: 'massFill',
      otherSettings: DEFAULT_OTHER_SETTINGS,
    })).toThrow(/не очищает/)
  })

  it('allows replace mode to clear an editable value', () => {
    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, material1: null }],
      previousRows,
      mode: 'replaceData',
      otherSettings: DEFAULT_OTHER_SETTINGS,
    })).not.toThrow()
  })

  it('rejects locked and unknown fields in replace mode', () => {
    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, joint: 'S8' }],
      previousRows,
      mode: 'replaceData',
      otherSettings: DEFAULT_OTHER_SETTINGS,
    })).toThrow(/Стык.*недоступно/)

    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, unsupported: 'value' } as never],
      previousRows,
      mode: 'replaceData',
      otherSettings: DEFAULT_OTHER_SETTINGS,
    })).toThrow(/не поддерживается/)
  })

  it('rejects a stale ID so a batch cannot be applied partially', () => {
    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 999, material1: '09Г2С' }],
      previousRows,
      mode: 'replaceData',
      otherSettings: DEFAULT_OTHER_SETTINGS,
    })).toThrow(/больше не существует/)
  })

  it('allows only derived WDI accompanying dimensions in system mode', () => {
    const systemSettings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' as const }
    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, d1: 57, wdi: 2.24 }],
      previousRows,
      mode: 'replaceData',
      otherSettings: systemSettings,
    })).not.toThrow()

    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, connectionType: 'У17', wdi: 2.24 }],
      previousRows,
      mode: 'replaceData',
      otherSettings: systemSettings,
    })).not.toThrow()

    expect(() => assertExistingRowsImportPayload({
      records: [{ id: 7, wdi: 2.24 }],
      previousRows,
      mode: 'replaceData',
      otherSettings: systemSettings,
    })).toThrow(/WDI.*недоступно/)
  })
})
