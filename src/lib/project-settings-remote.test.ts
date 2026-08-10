import { describe, expect, it } from 'vitest'
import {
  PROJECT_SETTING_KEYS,
  projectSettingAffectsDerivedCalculations,
  projectSettingAffectsDispatcherIndex,
} from '@/lib/project-settings-remote'

describe('projectSettingAffectsDispatcherIndex', () => {
  it.each([
    PROJECT_SETTING_KEYS.dataList,
    PROJECT_SETTING_KEYS.dispatcher,
    PROJECT_SETTING_KEYS.dispatcherReminders,
  ])('rebuilds the dispatcher for %s changes', (key) => {
    expect(projectSettingAffectsDispatcherIndex(key)).toBe(true)
  })

  it.each([
    PROJECT_SETTING_KEYS.other,
    PROJECT_SETTING_KEYS.requestConclusion,
    PROJECT_SETTING_KEYS.saveCheck,
    PROJECT_SETTING_KEYS.systemIndex,
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
