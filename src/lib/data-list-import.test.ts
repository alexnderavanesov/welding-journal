import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS, saveDataListSettings } from './data-list-settings'
import { prepareImportedWeldRecords } from './weld-journal-mutation-updates'

describe('configured test types import', () => {
  beforeEach(() => {
    window.localStorage.clear()
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      testTypes: ['ГИ', 'ПИ'],
    })
  })

  it('accepts several configured test types and stores them in settings order', () => {
    const records = prepareImportedWeldRecords({
      records: [{ testTypes: 'ПИ, ГИ' }],
      skipManualJointNameValidation: true,
      skipLnkRepairRuleValidation: true,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(records[0]?.testTypes).toBe('ГИ, ПИ')
  })

  it('rejects a test type that is missing from settings', () => {
    expect(() =>
      prepareImportedWeldRecords({
        records: [{ testTypes: 'ГИ, ВИ' }],
        skipManualJointNameValidation: true,
        skipLnkRepairRuleValidation: true,
        weldFormStampSelectOptions: {},
        welderStamps: [],
        welderStampSuspensions: [],
      }),
    ).toThrow('Поле "Вид испытаний" может содержать только значения из настроек')
  })
})
