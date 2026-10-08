import { describe, expect, it } from 'vitest'
import {
  SYSTEM_RULE_CATALOG,
  getSystemRule,
  getSystemRuleSettingsHref,
  getSystemRuleTargetId,
  resolveSystemRuleSettingsHash,
} from '@/lib/system-rule-catalog'

describe('system rule catalog navigation', () => {
  it('keeps all twelve mandatory rules with stable semantic deep links', () => {
    expect(SYSTEM_RULE_CATALOG.map((rule) => rule.code)).toEqual(Array.from({ length: 12 }, (_, i) => `СП-${String(i + 1).padStart(2, '0')}`))
    for (const rule of SYSTEM_RULE_CATALOG) {
      expect(resolveSystemRuleSettingsHash(`#${getSystemRuleTargetId(rule.code)}`)).toBe(rule)
      expect(rule.condition).not.toBe('')
      expect(rule.correction).not.toBe('')
      expect(rule.examples.length).toBeGreaterThan(0)
    }
  })

  it.each(['ЗВ20', 'зв-20', 'ЗВ 20', 'ДЗ17', 'ДЗ-17', 'СП07', 'СП-07', 'lnkResultRepairRules', 'check-repair-diameter'])(
    'resolves the former code or setting %s to SP-07', (reference) => {
      expect(getSystemRule(reference)?.code).toBe('СП-07')
      expect(getSystemRuleSettingsHref(reference)).toBe('/settings#system-rule-lnk-results')
    },
  )

  it.each(['#save-check-setting-lnkResultRepairRules', '#dispatcher-setting-check-repair-diameter', '#%D0%97%D0%92-20'])(
    'redirects old anchors %s to the mandatory rule', (hash) => {
      expect(resolveSystemRuleSettingsHash(hash)?.code).toBe('СП-07')
    },
  )

  it('does not reinterpret unrelated settings or malformed links', () => {
    expect(getSystemRuleSettingsHref('СП-13')).toBeUndefined()
    expect(resolveSystemRuleSettingsHash('#save-check-setting-dateFormat')).toBeUndefined()
    expect(resolveSystemRuleSettingsHash('#%invalid')).toBeUndefined()
  })

  it('distinguishes current code SP-05 from the old numeric SP-05 anchor', () => {
    expect(getSystemRule('СП05')?.code).toBe('СП-05')
    expect(resolveSystemRuleSettingsHash('#system-rule-sp-05')?.code).toBe('СП-07')
    expect(resolveSystemRuleSettingsHash('#system-rule-sp-01')?.code).toBe('СП-06')
  })
})
