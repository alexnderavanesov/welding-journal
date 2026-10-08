import { describe, expect, it } from 'vitest'
import { assertLnkResultAllowed, assertNoLnkResultRuleIssues, getLnkResultRestrictionReasons, getLnkResultRuleIssues } from './lnk-result-policy'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { normalizeSaveCheckSettings } from './save-check-settings'
import { getWeldFormSaveBlockReason } from './weld-form-save-reasons'
import type { WeldInput } from './weld-fields'

describe('СП-07: agreed mandatory result matrix', () => {
  const settings = DEFAULT_SYSTEM_INDEX_SETTINGS
  const methodCases = [
    { method: 'ВИК', small: ['годен', 'ремонт'], large: ['годен', 'ремонт'], afterTwo: ['годен'] },
    { method: 'ПВК', small: ['годен', 'ремонт'], large: ['годен', 'ремонт'], afterTwo: ['годен'] },
    { method: 'РК', small: ['годен', 'вырез'], large: ['годен', 'ремонт', 'вырез'], afterTwo: ['годен', 'вырез'] },
    { method: 'УЗК', small: ['годен', 'вырез'], large: ['годен', 'ремонт', 'вырез'], afterTwo: ['годен', 'вырез'] },
  ]
  for (const { method, small, large, afterTwo } of methodCases) {
    for (const diameter of [57, 88.9, 89, 108]) {
      for (const joint of ['F1', 'F1R1', 'F1R2', 'F1R2W1']) {
        it(`${method}, D${diameter}, ${joint}`, () => {
          const allowed = joint.includes('R2') ? afterTwo : diameter < 89 ? small : large
          const actual = ['годен', 'ремонт', 'вырез'].filter(result =>
            !getLnkResultRestrictionReasons({ joint, d1: diameter, d2: 159 }, method, result, { systemIndexSettings: settings }).length)
          expect(actual).toEqual(allowed)
        })
      }
    }
  }

  it('uses the minimum diameter, regardless of side order', () => {
    expect(getLnkResultRestrictionReasons({ joint: 'F1', d1: 159, d2: 57 }, 'РК', 'ремонт')).toEqual([
      expect.stringContaining('57 мм'),
    ])
  })

  it('reports all applicable reasons without changing the selected value', () => {
    const row = { joint: 'F1R2', d1: 57, layeredControlAssigned: true, pvkResult: 'ремонт' }
    expect(getLnkResultRestrictionReasons(row, 'ПВК', 'ремонт', { pvkGoodOnly: true })).toHaveLength(3)
    expect(row.pvkResult).toBe('ремонт')
    expect(getLnkResultRestrictionReasons(row, 'РК', 'ремонт')).toHaveLength(3)
  })

  it('distinguishes the optional own-PVK setting from mandatory rules shared with duplicates', () => {
    const row = { joint: 'F1', d1: 57 }
    const options = { pvkGoodOnly: true, scope: 'duplicate' as const }
    expect(getLnkResultRestrictionReasons(row, 'ПВК', 'ремонт', options)).toEqual([])
    expect(getLnkResultRestrictionReasons(row, 'ПВК', 'ремонт', { pvkGoodOnly: true })).toEqual([
      'Включена настройка «ПВК — только годен».',
    ])
    expect(getLnkResultRestrictionReasons(row, 'ПВК', 'вырез', options)).toEqual([
      'По ПВК результат «вырез» не допускается.',
    ])
    expect(getLnkResultRestrictionReasons({ ...row, joint: 'F1R2' }, 'ПВК', 'ремонт', options).join(' ')).toContain('Третий ремонт')
  })

  it('normalizes method and result text and rejects surface cuts in every officiality', () => {
    for (const officiality of [null, 'неофициальный']) {
      expect(() => assertLnkResultAllowed({ officiality }, ' вик (дубль) ', ' ВыРеЗ ')).toThrow('СП-07')
      expect(() => assertLnkResultAllowed({ officiality }, 'ПВК до ТО', 'вырез')).toThrow('СП-07')
      expect(() => assertLnkResultAllowed({ officiality }, 'ВИК', 'вырез · назначение отменено')).toThrow('СП-07')
    }
  })

  it('keeps existing counter semantics: W is not R, a coil starts a fresh branch', () => {
    for (const joint of ['F1W2', 'F1R2Y1', 'F1R1W1']) {
      expect(getLnkResultRestrictionReasons({ joint, d1: 108 }, 'ВИК', 'ремонт')).toEqual([])
    }
    expect(getLnkResultRestrictionReasons({ joint: 'F1R2', officiality: 'неофициальный' }, 'ВИК', 'ремонт')).toEqual([])
  })

  it('uses configured repair letters instead of a hard-coded R', () => {
    expect(getLnkResultRestrictionReasons({ joint: 'F1A2' }, 'ВИК', 'ремонт', {
      systemIndexSettings: { ...settings, repair: 'A' },
    })).toEqual([expect.stringContaining('два ремонта')])
  })

  it('does not turn missing results into good or reject waiting statuses', () => {
    for (const result of [undefined, '', 'ожидает НК', 'годен', 'годен (отменен)']) {
      expect(getLnkResultRestrictionReasons({ joint: 'F1R2' }, 'ВИК', result)).toEqual([])
    }
  })

  it('collects main, pre-TO (even disabled history), and duplicate errors with their fields', () => {
    const row = {
      joint: 'F1', d1: 57, vikResult: 'вырез', rkResult: 'ремонт',
      preHeatTreatmentLnkEnabled: false,
      preHeatTreatmentControls: [{ method: 'ПВК', result: 'вырез' }],
      duplicateControls: [{ method: 'ВИК', result: 'вырез' }],
    } as WeldInput
    const issues = getLnkResultRuleIssues(row)
    expect(issues).toHaveLength(4)
    expect(issues.every(issue => issue.message.startsWith('СП-07'))).toBe(true)
    expect(issues.flatMap(issue => issue.fieldKeys)).toEqual(expect.arrayContaining(['vikResult', 'rkResult', 'd1', 'd2', 'prePvkResult']))
    expect(issues.map(issue => issue.message).join('\n')).toContain('ВИК (дубль)')
    expect(row.vikResult).toBe('вырез')
  })

  it('checks flattened pre-TO import values when relation data is absent', () => {
    expect(getLnkResultRuleIssues({ preVikResult: 'вырез' })).toEqual([
      { message: expect.stringContaining('ВИК до ТО'), fieldKeys: ['preVikResult'] },
    ])
  })

  it('does not allow old disabled ZV-20 settings to bypass validation', () => {
    const settings = normalizeSaveCheckSettings({ lnkResultRepairRules: false })
    expect(getWeldFormSaveBlockReason({ joint: 'F1', vikResult: 'вырез' }, {}, settings)).toContain('СП-07')
    expect(() => assertNoLnkResultRuleIssues([{ joint: 'F1', d1: 57, vikResult: 'ремонт' }])).not.toThrow()
  })
})
