export const CONNECTION_RULES_HREF = '/account?tab=rules&section=connections'
export const ASSIGNMENT_CALCULATIONS_HREF = '/account?tab=rules&section=assignments'
export const CHECK_PARAMETERS_HREF = '/account?tab=rules&section=checks'
export const ASSIGNMENT_WARNINGS_HREF = '/settings#rules-warnings'

/** Compatibility redirect only; this URL no longer renders a registry tab. */
export function isLegacyCheckParametersLocation(href: string) {
  try {
    const url = new URL(href, 'http://local.invalid')
    return url.pathname === '/references' && url.searchParams.get('tab') === 'checks'
  } catch { return false }
}

export type ReferenceTab = 'registry' | 'specialists' | 'technologyCards'
export function getReferenceTab(search: string): ReferenceTab {
  const value = new URLSearchParams(search).get('tab')
  return value === 'specialists' || value === 'technologyCards' ? value : 'registry'
}

export type SystemRulesSection = 'connections' | 'checks' | 'assignments'
export function getSystemRulesSection(search: string): SystemRulesSection {
  const section = new URLSearchParams(search).get('section')
  return section === 'checks' || section === 'assignments' ? section : 'connections'
}
