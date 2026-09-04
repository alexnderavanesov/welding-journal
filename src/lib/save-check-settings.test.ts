import { describe, expect, it } from 'vitest'
import {
  normalizeSaveCheckSettings,
  REQUIRED_SAVE_CHECK_SETTING_IDS,
  SAVE_CHECK_SETTING_CODES,
  SAVE_CHECK_SETTING_ITEMS,
} from '@/lib/save-check-settings'
import { SAVE_CHECK_SETTING_HELP } from '@/lib/save-check-settings-help'

describe('save check settings help', () => {
  it('keeps the complete ZV-01 through ZV-31 registry unique', () => {
    const codes = Object.values(SAVE_CHECK_SETTING_CODES).sort((left, right) =>
      left.localeCompare(right, 'ru', { numeric: true }),
    )

    expect(codes).toEqual(
      Array.from({ length: 31 }, (_, index) => `ЗВ-${String(index + 1).padStart(2, '0')}`),
    )
  })

  it('provides detailed meaning and a case for every save check', () => {
    expect(Object.keys(SAVE_CHECK_SETTING_HELP).sort()).toEqual(Object.keys(SAVE_CHECK_SETTING_CODES).sort())

    for (const item of SAVE_CHECK_SETTING_ITEMS) {
      const help = SAVE_CHECK_SETTING_HELP[item.id]
      expect(help.meaning.length).toBeGreaterThan(item.description.length)
      expect(help.example.length).toBeGreaterThan(40)
    }
  })

  it('documents the ordinary and angular D/T rules explicitly', () => {
    expect(SAVE_CHECK_SETTING_HELP.officialDiameter.meaning).toContain('хотя бы на один из D1/D2')
    expect(SAVE_CHECK_SETTING_HELP.officialDiameter.meaning).toContain('«У…»')
    expect(SAVE_CHECK_SETTING_HELP.officialThickness.meaning).toContain('хотя бы на одну из T1/T2')
    expect(SAVE_CHECK_SETTING_HELP.officialThickness.meaning).toContain('при равных D проверяется Tmin')
    expect(SAVE_CHECK_SETTING_HELP.officialDls.meaning).toContain('Между сварщиками диапазоны не складываются')
  })

  it('keeps database date-format checks enabled in old and remote settings', () => {
    const normalized = normalizeSaveCheckSettings({
      dateFormat: false,
      lnkResultControlDateFormat: false,
      pstoResultDateFormat: false,
    })

    expect([...REQUIRED_SAVE_CHECK_SETTING_IDS]).toEqual([
      'dateFormat',
      'lnkResultControlDateFormat',
      'pstoResultDateFormat',
    ])
    expect(normalized.dateFormat).toBe(true)
    expect(normalized.lnkResultControlDateFormat).toBe(true)
    expect(normalized.pstoResultDateFormat).toBe(true)
  })
})
