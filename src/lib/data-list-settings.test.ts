import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATA_LIST_SETTINGS,
  getDataListOptionInputError,
  normalizeDataListSettings,
} from './data-list-settings'

describe('data list settings', () => {
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
