import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OTHER_SETTINGS, saveOtherSettings } from './other-settings'
import { prepareImportedWeldRecords } from './weld-journal-mutation-updates'

describe('system WDI import', () => {
  afterEach(() => {
    saveOtherSettings(DEFAULT_OTHER_SETTINGS)
  })

  it('calculates WDI during weld journal import in system mode', () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })

    const records = prepareImportedWeldRecords({
      records: [{ joint: 'S1', d1: 57, d2: 108 }],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(records[0].wdi).toBe(2.24)
  })

  it('rejects manually entered WDI that conflicts with system formula', () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })

    expect(() =>
      prepareImportedWeldRecords({
        records: [{ joint: 'S1', d1: 57, d2: 108, wdi: 9 }],
        weldFormStampSelectOptions: {},
        welderStamps: [],
        welderStampSuspensions: [],
      }),
    ).toThrow('WDI должен быть 2,24')
  })
})
