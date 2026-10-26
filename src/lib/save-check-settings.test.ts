import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  normalizeSaveCheckSettings,
  REQUIRED_SAVE_CHECK_SETTING_IDS,
  SAVE_CHECK_SETTING_CODES,
  SAVE_CHECK_SETTING_ITEMS,
} from '@/lib/save-check-settings'
import { SAVE_CHECK_SETTING_HELP } from '@/lib/save-check-settings-help'

describe('save check settings help', () => {
  it('drops the retired archive setting without changing the remaining name-format preference', () => {
    const settings = normalizeSaveCheckSettings({ officialArchive: false, manualJointName: false })
    expect(settings).not.toHaveProperty('officialArchive')
    expect(settings.manualJointName).toBe(false)
    expect(SAVE_CHECK_SETTING_CODES.manualJointName).toBe('ЗВ-01')
  })
  it('exposes only the one optional guards in the new numbering', () => {
    expect(SAVE_CHECK_SETTING_ITEMS.map(item => SAVE_CHECK_SETTING_CODES[item.id])).toEqual(['ЗВ-01'])
  })

  it('discards the obsolete repair toggle even when legacy settings disabled it', () => {
    const settings = normalizeSaveCheckSettings({ lnkResultRepairRules: false, officialRegistry: false })
    expect(settings).not.toHaveProperty('lnkResultRepairRules')
    expect(DEFAULT_SAVE_CHECK_SETTINGS).not.toHaveProperty('lnkResultRepairRules')
    expect(SAVE_CHECK_SETTING_HELP).not.toHaveProperty('lnkResultRepairRules')
    expect(SAVE_CHECK_SETTING_ITEMS.map((item) => item.id)).not.toContain('lnkResultRepairRules')
    expect(settings.officialRegistry).toBe(true)
  })

  it('provides detailed meaning and a case for every save check', () => {
    expect(Object.keys(SAVE_CHECK_SETTING_HELP).sort()).toEqual(Object.keys(SAVE_CHECK_SETTING_CODES).sort())

    for (const item of SAVE_CHECK_SETTING_ITEMS) {
      const help = SAVE_CHECK_SETTING_HELP[item.id]
      expect(help.meaning.length).toBeGreaterThanOrEqual(item.description.length)
      expect(help.example.length).toBeGreaterThan(40)
    }
  })

  it('distinguishes homogeneous ordinary/angular rules from ordered dissimilar sides', () => {
    expect(SAVE_CHECK_SETTING_HELP.officialDiameter.meaning).toContain('хотя бы на один из D1/D2')
    expect(SAVE_CHECK_SETTING_HELP.officialDiameter.meaning).toContain('«У…»')
    expect(SAVE_CHECK_SETTING_HELP.officialThickness.meaning).toContain('хотя бы на одну из T1/T2')
    expect(SAVE_CHECK_SETTING_HELP.officialThickness.meaning).toContain('при равных D проверяется Tmin')
    expect(SAVE_CHECK_SETTING_HELP.officialDls.meaning).toContain('Между сварщиками диапазоны не складываются')
    expect(SAVE_CHECK_SETTING_HELP.officialDiameter.meaning).toContain('Для однородного')
    expect(SAVE_CHECK_SETTING_HELP.officialDiameter.meaning).toContain('первая группа проверяется по D1/T1, вторая — по D2/T2')
    expect(SAVE_CHECK_SETTING_HELP.officialDls.meaning).toContain('РАД/М01 и РД/М05 не дают одному сварщику допуска')
  })

  it('keeps database date-format checks enabled in old and remote settings', () => {
    const normalized = normalizeSaveCheckSettings({
      dateFormat: false,
      lnkResultControlDateFormat: false,
      pstoResultDateFormat: false,
    })

    expect([...REQUIRED_SAVE_CHECK_SETTING_IDS]).toEqual(expect.arrayContaining([
      'dateFormat',
      'lnkResultControlDateFormat',
      'pstoResultDateFormat',
    ]))
    expect(normalized.dateFormat).toBe(true)
    expect(normalized.lnkResultControlDateFormat).toBe(true)
    expect(normalized.pstoResultDateFormat).toBe(true)
  })
})
