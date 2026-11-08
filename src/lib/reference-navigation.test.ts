import { describe, expect, it } from 'vitest'
import { ASSIGNMENT_CALCULATIONS_HREF, CHECK_PARAMETERS_HREF, CONNECTION_RULES_HREF, getReferenceTab, getSystemRulesSection, isLegacyCheckParametersLocation } from './reference-navigation'

describe('direct reference navigation', () => {
  it('targets the exact explanation and rules tabs', () => {
    expect(isLegacyCheckParametersLocation('/references?tab=checks')).toBe(true)
    expect(new URL(CHECK_PARAMETERS_HREF, 'http://local.invalid').pathname).toBe('/account')
    expect(getSystemRulesSection(new URL(CHECK_PARAMETERS_HREF, 'http://local.invalid').search)).toBe('checks')
    expect(getSystemRulesSection('?section=unknown')).toBe('connections')
    expect(getSystemRulesSection(new URL(ASSIGNMENT_CALCULATIONS_HREF, 'http://local.invalid').search)).toBe('assignments')
    const target = new URL(CONNECTION_RULES_HREF, 'http://local.invalid')
    expect(target.pathname).toBe('/account')
    expect(target.searchParams.get('tab')).toBe('rules')
    expect(target.searchParams.get('section')).toBe('connections')
  })
  it.each(['/references', '/references?tab=registry', '/references?tab=specialists', '/references?tab=technologyCards', '/journal?tab=checks', '/references/other?tab=checks', '/references?tab=check', '/references?tab=registry&tab=checks'])('does not exempt a working registry or unrelated route: %s', href => {
    expect(isLegacyCheckParametersLocation(href)).toBe(false)
  })
  it('restores each valid registry tab and treats unknown input as the registry', () => {
    for (const tab of ['registry', 'specialists', 'technologyCards']) expect(getReferenceTab(`?tab=${tab}`)).toBe(tab)
    expect(getReferenceTab('?tab=unknown')).toBe('registry')
    expect(getReferenceTab('?tab=checks')).toBe('registry')
  })
})
