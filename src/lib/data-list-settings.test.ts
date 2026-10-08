import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATA_LIST_SETTINGS,
  getDataListOptionInputError,
  normalizeDataListSettings,
  isSystemDataListOption,
  saveDataListSettings,
  loadDataListSettings,
  applyRemoteDataListSettings,
} from './data-list-settings'

describe('data list settings', () => {
  it.each([undefined, null, {}, { weldingTypes: [], connectionTypes: [], materialGroups: [] }])('always restores all fixed system codes from %j', input => {
    expect(normalizeDataListSettings(input)).toEqual({
      weldingTypes: ['РАД', 'РД'], connectionTypes: ['С17', 'У19'], materialGroups: ['М01', 'М05', 'М11'], testTypes: ['ГИ', 'ПИ'],
    })
  })

  it('keeps custom and legacy codes, deduplicates system codes and allows an empty test list', () => {
    const settings = normalizeDataListSettings({ weldingTypes: ['МП', ' рд '], connectionTypes: ['У19', 'ТШ', 'C17'], materialGroups: ['М02', ' м01 ', 'M01'], testTypes: [] })
    expect(settings).toEqual({ weldingTypes: ['РАД', 'РД', 'МП'], connectionTypes: ['С17', 'У19', 'ТШ', 'C17'], materialGroups: ['М01', 'М05', 'М11', 'М02', 'M01'], testTypes: [] })
    expect(normalizeDataListSettings(settings)).toEqual(settings)
    expect(isSystemDataListOption('connectionTypes', 'С17')).toBe(true)
    expect(isSystemDataListOption('connectionTypes', 'C17')).toBe(false)
    expect(isSystemDataListOption('testTypes', 'ГИ')).toBe(false)
  })

  it('retains mandatory values across local edits and older remote settings without writing on load', () => {
    const old = JSON.stringify({ weldingTypes: ['МП'], connectionTypes: ['ТШ'], materialGroups: ['М02'], testTypes: [] })
    localStorage.setItem('welding-data-list-settings', old)
    expect(loadDataListSettings().materialGroups).toEqual(['М01', 'М05', 'М11', 'М02'])
    expect(localStorage.getItem('welding-data-list-settings')).toBe(old)
    saveDataListSettings({ weldingTypes: [], connectionTypes: [], materialGroups: [], testTypes: [] }, { syncRemote: false })
    expect(loadDataListSettings()).toEqual({ ...DEFAULT_DATA_LIST_SETTINGS, testTypes: [] })
    applyRemoteDataListSettings(JSON.parse(old))
    expect(loadDataListSettings().connectionTypes).toEqual(['С17', 'У19', 'ТШ'])
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
    ['connectionTypes', 'У17'],
    ['materialGroups', 'М01'],
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
})
