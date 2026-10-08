import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS, saveDataListSettings } from './data-list-settings'
import { collectImportedWeldRecordPreparationErrors, prepareImportedWeldRecords } from './weld-journal-mutation-updates'

describe('configured test types import', () => {
  it.each(['М05 + М01', 'М01 + М05', 'М01'])('imports ordered material groups unchanged: %s', materialGroup => {
    const records = prepareImportedWeldRecords({ records: [{ materialGroup }], skipManualJointNameValidation: true, skipLnkResultRuleValidation: true, weldFormStampSelectOptions: {}, welderStamps: [], welderStampSuspensions: [] })
    expect(records[0].materialGroup).toBe(materialGroup)
  })
  it('reports the type and excessive material count together rather than masking either field', () => {
    const { errors } = collectImportedWeldRecordPreparationErrors({ records: [{ connectionType: 'BAD', materialGroup: 'М01 + М05 + М11' }], skipManualJointNameValidation: true, skipLnkResultRuleValidation: true, weldFormStampSelectOptions: {}, welderStamps: [], welderStampSuspensions: [] })
    const message = errors.map(error => error.message).join(' ')
    expect(message).toContain('Тип соединения')
    expect(message).toContain('Группа материалов')
    expect(message).toContain('не более двух')
  })
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
      skipLnkResultRuleValidation: true,
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
        skipLnkResultRuleValidation: true,
        weldFormStampSelectOptions: {},
        welderStamps: [],
        welderStampSuspensions: [],
      }),
    ).toThrow('Поле "Вид испытаний" может содержать только значения из настроек')
  })
})
