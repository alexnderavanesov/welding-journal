import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATA_LIST_SETTINGS,
  getDataListOptionInputError,
  normalizeDataListSettings,
  isSystemDataListOption,
  saveDataListSettings,
  loadDataListSettings,
  applyRemoteDataListSettings,
  prepareDataListSettingsChange,
} from './data-list-settings'

describe('data list settings', () => {
  it.each([undefined, null, {}, { weldingTypes: [], connectionTypes: [], materialGroups: [] }])('preserves formerly implicit codes when reading older settings: %j', input => {
    expect(normalizeDataListSettings(input)).toEqual({
      connectionTypesVersion: 1,
      weldingTypes: ['РАД', 'РД'], connectionTypes: ['С17', 'У19', 'Т', 'Т1', 'Т3', 'Т4Д'], materialGroups: ['М01', 'М05', 'М11'], testTypes: ['ГИ', 'ПИ'],
    })
  })

  it('keeps custom and legacy codes, deduplicates system codes and allows an empty test list', () => {
    const settings = normalizeDataListSettings({ weldingTypes: ['МП', ' рд '], connectionTypes: ['У19', 'ТШ', 'C17'], materialGroups: ['М02', ' м01 ', 'M01'], testTypes: [] })
    expect(settings).toEqual({ connectionTypesVersion: 1, weldingTypes: ['РАД', 'РД', 'МП'], connectionTypes: ['С17', 'У19', 'Т', 'Т1', 'Т3', 'Т4Д', 'ТШ', 'C17'], materialGroups: ['М01', 'М05', 'М11', 'М02', 'M01'], testTypes: [] })
    expect(normalizeDataListSettings(settings)).toEqual(settings)
    expect(isSystemDataListOption('connectionTypes', 'С17')).toBe(false)
    expect(isSystemDataListOption('connectionTypes', 'C17')).toBe(false)
    expect(isSystemDataListOption('testTypes', 'ГИ')).toBe(false)
  })

  it('retains mandatory values across local edits and older remote settings without writing on load', () => {
    const old = JSON.stringify({ weldingTypes: ['МП'], connectionTypes: ['ТШ'], materialGroups: ['М02'], testTypes: [] })
    localStorage.setItem('welding-data-list-settings', old)
    expect(loadDataListSettings().materialGroups).toEqual(['М01', 'М05', 'М11', 'М02'])
    expect(localStorage.getItem('welding-data-list-settings')).toBe(old)
    saveDataListSettings({ weldingTypes: [], connectionTypes: [], materialGroups: [], testTypes: [] }, { syncRemote: false })
    expect(loadDataListSettings()).toEqual({ ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: [], testTypes: [] })
    applyRemoteDataListSettings(JSON.parse(old))
    expect(loadDataListSettings().connectionTypes).toEqual(['С17', 'У19', 'Т', 'Т1', 'Т3', 'Т4Д', 'ТШ'])
    localStorage.removeItem('welding-data-list-settings')
  })
  it('adds default test types to settings saved before the list existed', () => {
    expect(
      normalizeDataListSettings({
        weldingTypes: ['РАД', 'РД'],
        connectionTypes: ['С17'],
        materialGroups: ['М01'],
      }).testTypes,
    ).toEqual(['ГИ', 'ПИ'])
  })

  it('normalizes and keeps configured test types', () => {
    expect(
      normalizeDataListSettings({
        ...DEFAULT_DATA_LIST_SETTINGS,
        testTypes: [' ги ', 'ПИ', 'ГИ'],
      }).testTypes,
    ).toEqual(['ГИ', 'ПИ'])
  })

  it.each([
    ['weldingTypes', 'РАД'],
    ['connectionTypes', 'С2'],
    ['connectionTypes', 'У17'],
    ['connectionTypes', 'Т1'],
    ['connectionTypes', 'ТШ'],
    ['connectionTypes', ' у 17 '],
    ['materialGroups', 'М01'],
    ['materialGroups', ' м123 '],
    ['weldingTypes', 'РУЧНАЯ 1'],
  ] as const)('accepts Cyrillic letters, digits and spaces for %s', (key, value) => {
    expect(getDataListOptionInputError(key, value)).toBeNull()
  })

  it.each([
    ['weldingTypes', 'RAD'],
    ['connectionTypes', 'У-17'],
    ['materialGroups', 'M01'],
    ['materialGroups', 'М0I'],
  ] as const)('rejects unsupported characters for %s: %s', (key, value) => {
    expect(getDataListOptionInputError(key, value)).toContain('кириллические буквы')
  })

  it('does not apply the restriction to test types', () => {
    expect(getDataListOptionInputError('testTypes', 'VT-1')).toBeNull()
  })

  it.each(['Н2', '17С', 'ОП'])('rejects a new connection class: %s', value => {
    expect(getDataListOptionInputError('connectionTypes', value)).toContain('«С», «У» или «Т»')
  })

  it.each(['Н01', '01М', 'СТАЛЬ'])('requires Cyrillic М at the start of a new material group: %s', value => {
    expect(getDataListOptionInputError('materialGroups', value)).toContain('кириллической «М»')
  })

  it('normalizes valid additions without restoring removed connection types', () => {
    expect(prepareDataListSettingsChange(undefined, {
      connectionTypes: [' с2 ', 'у17'], materialGroups: [' м123 '],
    })).toMatchObject({ connectionTypes: ['С2', 'У17'], materialGroups: ['М01', 'М05', 'М11', 'М123'] })
  })

  it.each(['С17', 'У19', 'Т', 'Т1', 'Т3', 'Т4Д'])('keeps %s deleted across save, reload and remote synchronization', type => {
    const next = { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: DEFAULT_DATA_LIST_SETTINGS.connectionTypes.filter(value => value !== type) }
    expect(prepareDataListSettingsChange(DEFAULT_DATA_LIST_SETTINGS, next)).toEqual(next)
    saveDataListSettings(next, { syncRemote: false })
    expect(loadDataListSettings()).toEqual(next)
    applyRemoteDataListSettings(JSON.parse(localStorage.getItem('welding-data-list-settings')!))
    expect(loadDataListSettings()).toEqual(next)
    localStorage.removeItem('welding-data-list-settings')
  })

  it('accepts an intentionally empty list, including direct writes from an older client', () => {
    const next = prepareDataListSettingsChange(undefined, { connectionTypes: [] })
    expect(next.connectionTypes).toEqual([])
    expect(normalizeDataListSettings(JSON.parse(JSON.stringify(next))).connectionTypes).toEqual([])
  })

  it('rejects all invalid additions together without mutating stored settings', () => {
    const before = JSON.stringify(DEFAULT_DATA_LIST_SETTINGS)
    expect(() => prepareDataListSettingsChange(DEFAULT_DATA_LIST_SETTINGS, {
      ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: ['С2', 'Н1', 'C2'], materialGroups: ['М02', 'Н01', 'M02'],
    })).toThrow(/«Н1»[\s\S]*«C2»[\s\S]*«Н01»[\s\S]*«M02»/)
    expect(JSON.stringify(DEFAULT_DATA_LIST_SETTINGS)).toBe(before)
  })

  it('preserves legacy codes on unrelated additions, but cannot reintroduce them after removal', () => {
    const legacy = normalizeDataListSettings({ connectionTypes: ['ТШ', 'C17'], materialGroups: ['Н01', 'M01'] })
    const next = { ...legacy, connectionTypes: [...legacy.connectionTypes, 'С2'], materialGroups: [...legacy.materialGroups, 'М02'] }
    expect(prepareDataListSettingsChange(legacy, next)).toEqual(next)
    expect(prepareDataListSettingsChange(legacy, DEFAULT_DATA_LIST_SETTINGS)).toEqual(DEFAULT_DATA_LIST_SETTINGS)
    expect(() => prepareDataListSettingsChange(DEFAULT_DATA_LIST_SETTINGS, legacy)).toThrow(/«C17»/)
  })
})
