import { describe, expect, it } from 'vitest'
import { getSupportJointRuleIssues } from './support-joint-rules'
import { parseJointName, validateManualJointName } from './joint-name'
import { getLnkResultRestrictionReasons } from './lnk-result-policy'
import { calculateWdi } from './wdi'
import { DEFAULT_OTHER_SETTINGS } from './other-settings'
import { getWeldFormSaveBlockReason } from './weld-form-save-reasons'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { normalizeWeldInput } from './weld-record-transforms'
import { buildRepeatedJointDraft } from './repeated-joint-draft'

describe('Т/ОП: mandatory physical shape independent of optional name settings', () => {
  it('rejects both material heterogeneity and combined methods, including an unsaved C → T draft', () => {
    const row = { joint: 'ОП1', connectionType: 'Т4', materialGroup: 'М01 + М05', weldingMethod: 'РАД+РД' }
    const issues = getSupportJointRuleIssues(row, { ...row, joint: 'S1', connectionType: 'С17' })
    expect(issues).toHaveLength(2)
    expect(issues.flatMap(issue => issue.fieldKeys)).toEqual(expect.arrayContaining(['materialGroup', 'weldingMethod', 'connectionType']))
    expect(getWeldFormSaveBlockReason(row, {})).toContain('комбинированная')
    expect(getSupportJointRuleIssues({ ...row, materialGroup: 'М01', weldingMethod: 'МП' })).toEqual([])
    expect(getSupportJointRuleIssues({ ...row, joint: 'S1', connectionType: 'С17' })).toEqual([])
  })
  it.each(['ОП44', 'ОП-44', 'ОП-44-1', 'ОП44/3'])('accepts free support base %s', joint => {
    expect(validateManualJointName(joint)).toBeNull()
    expect(parseJointName(`${joint}R10`)).toMatchObject({ base: joint, segments: [{ suffix: 'R', index: 10 }], hasRequiredPrefix: true })
    expect(getSupportJointRuleIssues({ joint, connectionType: 'Т4д' })).toEqual([])
  })
  it('blocks both family/name mismatches and changing both persisted inputs together', () => {
    expect(getSupportJointRuleIssues({ joint: 'S13', connectionType: 'Т' })).toHaveLength(1)
    expect(getSupportJointRuleIssues({ joint: 'ОП13', connectionType: 'С17' })).toHaveLength(1)
    const previous = { id: 7, joint: 'ОП-13R5', connectionType: 'Т' }
    expect(getSupportJointRuleIssues({ ...previous, joint: 'S13R5', connectionType: 'С17' }, previous)[0].message).toContain('Сохранённое')
    expect(getWeldFormSaveBlockReason({ ...previous, joint: 'S13R5', connectionType: 'С17' }, previous, { ...DEFAULT_SAVE_CHECK_SETTINGS, manualJointName: false })).toContain('Сохранённое')
  })
  it.each(['\t\u1c841\ufeff', '\u00a0\u1c851 '])('keeps a saved legacy support %j in its original family', connectionType => {
    const previous = { id: 7, joint: 'ОП13', connectionType }
    expect(getSupportJointRuleIssues({ ...previous, joint: 'S13', connectionType: 'С17' }, previous)
      .some(issue => issue.message.includes('Сохранённое соединение нельзя переводить'))).toBe(true)
    expect(getSupportJointRuleIssues({ ...previous, connectionType: 'Т3' }, previous)).toEqual([])
  })
  it('checks official and factual groups separately, without requiring every layer', () => {
    const row = { joint: 'ОП13', connectionType: 'Т', stamp1K: 'А', stamp1Z: 'А', stamp1KFact: 'Б', stamp1OFact: 'Б' }
    expect(getSupportJointRuleIssues(row)).toEqual([])
    const issues = getSupportJointRuleIssues({ ...row, stamp1Z: 'Б', stamp2O: 'А', stamp2KFact: 'Б', weldLength: -2, hasRk: 'да' })
    expect(issues).toHaveLength(4)
    expect(issues.flatMap(item => item.fieldKeys)).toEqual(expect.arrayContaining(['stamp1K', 'stamp1Z', 'stamp2O', 'stamp2KFact', 'weldLength', 'hasRk']))
  })
  it('keeps entered fractional length and inherits its full value on every repair', () => {
    const row = { id: 1, joint: 'ОП13', connectionType: 'Т', weldLength: 600.123456, stamp1K: 'A' }
    expect(normalizeWeldInput(row).weldLength).toBe('600.123456')
    expect(buildRepeatedJointDraft(row, 'ОП13R1').weldLength).toBe('600.123456')
    expect(getSupportJointRuleIssues({ ...row, weldLength: null })).toEqual([])
    expect(getSupportJointRuleIssues({ ...row, weldLength: 0 })[0].fieldKeys).toContain('weldLength')
    expect(getSupportJointRuleIssues({ joint: 'S1', connectionType: 'С17', weldLength: 600 })[0].fieldKeys).toContain('weldLength')
  })
  it('allows repair beyond R10 below 89 mm; forbids RK/cut/coil and preserves good-only PVK', () => {
    const row = { joint: 'ОП13R10', connectionType: 'Т1', d1: 57 }
    expect(getLnkResultRestrictionReasons(row, 'УЗК', 'ремонт')).toEqual([])
    expect(getLnkResultRestrictionReasons(row, 'РК', 'годен', { scope: 'duplicate' })).not.toEqual([])
    expect(getLnkResultRestrictionReasons(row, 'УЗК', 'вырез')).not.toEqual([])
    expect(getSupportJointRuleIssues({ ...row, joint: 'ОП13Y1' })).not.toEqual([])
    expect(getSupportJointRuleIssues({ ...row, layeredControlAssigned: true })).not.toEqual([])
    expect(getLnkResultRestrictionReasons(row, 'ПВК', 'ремонт', { pvkGoodOnly: true })).toEqual(['Включена настройка «ПВК — только годен».'])
    expect(getLnkResultRestrictionReasons({ ...row, connectionType: 'С17', joint: 'S13R2' }, 'УЗК', 'ремонт')).toHaveLength(2)
  })
  it.each(['manual', 'formula', 'table'] as const)('never computes WDI for Т in %s mode', wdiCalculationMode => {
    expect(calculateWdi({ connectionType: 'Т', d1: 57, t1: 3, wdi: 10 }, { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode })).toBeNull()
  })
})
