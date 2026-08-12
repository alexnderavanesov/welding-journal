import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS, saveDataListSettings } from './data-list-settings'
import { DEFAULT_OTHER_SETTINGS, saveOtherSettings } from './other-settings'
import { prepareImportedWeldRecords } from './weld-journal-mutation-updates'

describe('system WDI import', () => {
  afterEach(() => {
    saveDataListSettings(DEFAULT_DATA_LIST_SETTINGS)
    saveOtherSettings(DEFAULT_OTHER_SETTINGS)
  })

  it('calculates WDI during weld journal import in system mode', () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
    })

    const records = prepareImportedWeldRecords({
      records: [{ joint: 'S1', connectionType: 'С17', d1: 57, d2: 108 }],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(records[0].wdi).toBe(4.25)
  })

  it('rejects manually entered WDI that conflicts with system formula', () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
    })

    expect(() =>
      prepareImportedWeldRecords({
        records: [{ joint: 'S1', connectionType: 'С17', d1: 57, d2: 108, wdi: 9 }],
        weldFormStampSelectOptions: {},
        welderStamps: [],
        welderStampSuspensions: [],
      }),
    ).toThrow('WDI должен быть 4,25')
  })
})
