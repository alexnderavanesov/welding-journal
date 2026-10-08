import { describe, expect, it } from 'vitest'
import { RULE_CONNECTIONS, getRuleConnections, getRuleSettingsReference, getRuleSettingsTab, getRuleSettingsTarget } from './rule-settings-navigation'

describe('rule settings navigation', () => {
  it('uses existing current codes and exposes every connection in both directions', () => {
    const pairs = new Set<string>()
    for (const [left, right, explanation] of RULE_CONNECTIONS) {
      expect(left).not.toBe(right)
      expect(getRuleSettingsReference(left)).toBeDefined()
      expect(getRuleSettingsReference(right)).toBeDefined()
      expect(getRuleConnections(left)).toContainEqual(expect.objectContaining({ code: right, explanation }))
      expect(getRuleConnections(right)).toContainEqual(expect.objectContaining({ code: left, explanation }))
      const key = [left, right].sort().join(':')
      expect(pairs.has(key)).toBe(false)
      pairs.add(key)
    }
  })
  it('resolves old rule links and new optional-rule/registry anchors to the proper visible panel', () => {
    expect(getRuleSettingsTab(getRuleSettingsTarget('#system-rule-sp-05'))).toBe('system')
    expect(getRuleSettingsTab(getRuleSettingsTarget('#save-check-setting-officialArchive'))).toBe('input')
    expect(getRuleSettingsTab(getRuleSettingsTarget('#dispatcher-setting-welder-stamp-expiry'))).toBe('tasks')
    expect(getRuleSettingsTab(getRuleSettingsTarget('#rules-accepted-exceptions'))).toBe('exceptions')
    expect(getRuleSettingsTab(getRuleSettingsTarget('#rules-dispatcher-background'))).toBe('parameters')
    expect(getRuleSettingsTarget('#unknown')).toBeUndefined()
  })
})
