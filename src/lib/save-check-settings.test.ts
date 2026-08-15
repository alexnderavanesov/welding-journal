import { describe, expect, it } from 'vitest'
import {
  SAVE_CHECK_SETTING_CODES,
  SAVE_CHECK_SETTING_ITEMS,
} from '@/lib/save-check-settings'
import { SAVE_CHECK_SETTING_HELP } from '@/lib/save-check-settings-help'

describe('save check settings help', () => {
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
})
