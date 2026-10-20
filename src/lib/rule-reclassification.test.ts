import { describe, expect, it } from 'vitest'
import { SYSTEM_RULE_CATALOG } from './system-rule-catalog'
import { DEFAULT_SAVE_CHECK_SETTINGS, SAVE_CHECK_SETTING_ITEMS, getSaveCheckSettingCode, normalizeSaveCheckSettings } from './save-check-settings'
import { DISPATCHER_SETTING_GROUPS, DEFAULT_DISPATCHER_SETTINGS, getDispatcherSettingCode, isDispatcherSettingEnabled } from './dispatcher-settings'
import { getRequiredRootStampMessage } from './weld-record-transforms'
import { getLineProgramConfigurationIssue } from './line-program'

describe('agreed rule classification', () => {
  it('shows the new line-program code without rewriting stored legacy configuration conflicts', () => {
    const stored = { category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 10,
      configurationIssue: 'СП-02: противоречивые исходные требования. Настройте программу линии.' }
    expect(getLineProgramConfigurationIssue(stored)).toBe('СП-01: противоречивые исходные требования. Настройте программу линии.')
    expect(stored.configurationIssue).toContain('СП-02:')
    expect(getLineProgramConfigurationIssue({ ...stored, configurationIssue: 'Проверить исходный документ' })).toBe('Проверить исходный документ')
  })
  it('has eleven mandatory rules, two optional input guards and six reminders', () => {
    expect(SYSTEM_RULE_CATALOG.map(rule => rule.code)).toEqual(Array.from({ length: 11 }, (_, index) => `СП-${String(index + 1).padStart(2, '0')}`))
    expect(SAVE_CHECK_SETTING_ITEMS.map(item => getSaveCheckSettingCode(item.id))).toEqual(['ЗВ-01', 'ЗВ-02'])
    expect(DISPATCHER_SETTING_GROUPS.flatMap(group => group.items.map(item => getDispatcherSettingCode(item.id)))).toEqual(['ДЗ-01', 'ДЗ-02', 'ДЗ-03', 'ДЗ-04', 'ДЗ-05', 'ДЗ-06'])
  })

  it('does not let legacy toggles disable chronology, qualification or history protection', () => {
    const settings = normalizeSaveCheckSettings(Object.fromEntries(Object.keys(DEFAULT_SAVE_CHECK_SETTINGS).map(id => [id, false])))
    expect(settings).toMatchObject({ officialNaksDate: true, officialSuspension: true, lnkResultDateAfterWeldDate: true, pstoResultDateAfterWeldDate: true, controlHistoryProtection: true, officialArchive: false, manualJointName: false })
    expect(isDispatcherSettingEnabled('percentage-missing', { ...DEFAULT_DISPATCHER_SETTINGS, 'percentage-missing': false })).toBe(true)
    expect(isDispatcherSettingEnabled('check-incomplete-stamps', { ...DEFAULT_DISPATCHER_SETTINGS, 'check-incomplete-stamps': false })).toBe(true)
  })

  it('allows factual welding with temporarily empty official stamps, even with a weld date', () => {
    expect(getRequiredRootStampMessage({ joint: 'S1', weldDate: '2026-10-01', stamp1KFact: 'FACT', stamp1ZFact: 'FACT', stamp1OFact: 'FACT' })).toBeNull()
    expect(normalizeSaveCheckSettings({ requiredRootStampWithWeldDate: true }).requiredRootStampWithWeldDate).toBe(false)
  })
})
