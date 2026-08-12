import { describe, expect, it } from 'vitest'
import {
  PROJECT_SETTING_KEYS,
  isProjectSettingKey,
  projectSettingAffectsDerivedCalculations,
  projectSettingAffectsDispatcherIndex,
} from '@/lib/project-settings-remote'

describe('isProjectSettingKey', () => {
  it('allows only project settings handled by the general settings synchronizer', () => {
    expect(isProjectSettingKey(PROJECT_SETTING_KEYS.dispatcher)).toBe(true)
    expect(isProjectSettingKey(PROJECT_SETTING_KEYS.requestConclusion)).toBe(true)
    expect(isProjectSettingKey('security')).toBe(false)
    expect(isProjectSettingKey('generated-document-counter:weldingJournal')).toBe(false)
  })
})

describe('projectSettingAffectsDispatcherIndex', () => {
  it.each([
    PROJECT_SETTING_KEYS.dataList,
    PROJECT_SETTING_KEYS.dispatcher,
    PROJECT_SETTING_KEYS.dispatcherReminders,
    PROJECT_SETTING_KEYS.saveCheck,
    PROJECT_SETTING_KEYS.systemIndex,
  ])('rebuilds the dispatcher for %s changes', (key) => {
    expect(projectSettingAffectsDispatcherIndex(key)).toBe(true)
  })

  it.each([
    PROJECT_SETTING_KEYS.other,
    PROJECT_SETTING_KEYS.requestConclusion,
  ])('does not rebuild the dispatcher for unrelated %s changes', (key) => {
    expect(projectSettingAffectsDispatcherIndex(key)).toBe(false)
  })

  it.each([
    PROJECT_SETTING_KEYS.other,
    PROJECT_SETTING_KEYS.systemIndex,
  ])('invalidates derived calculations for %s changes', (key) => {
    expect(projectSettingAffectsDerivedCalculations(key)).toBe(true)
  })
})
