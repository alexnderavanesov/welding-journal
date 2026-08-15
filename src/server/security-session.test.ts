import { describe, expect, it } from 'vitest'
import {
  ACTION_SECURITY_SESSION_TTL_SECONDS,
  createSecuritySessionToken,
  ENTRY_SECURITY_SESSION_REFRESH_WINDOW_SECONDS,
  ENTRY_SECURITY_SESSION_TTL_SECONDS,
  getSecuritySessionTtlSeconds,
  readValidSecuritySession,
} from '@/server/security-session'

const SETTINGS = {
  passwordHash: 'password-hash',
  version: 'version-1',
}

describe('security session policy', () => {
  it('keeps action confirmations short and gives entry sessions a workday lifetime', () => {
    expect(getSecuritySessionTtlSeconds('entry')).toBe(12 * 60 * 60)
    expect(getSecuritySessionTtlSeconds('settings')).toBe(10 * 60)
    expect(ENTRY_SECURITY_SESSION_TTL_SECONDS).toBeGreaterThan(ACTION_SECURITY_SESSION_TTL_SECONDS)
  })

  it('accepts a signed entry session and refreshes it only near expiration', () => {
    const now = 1_000_000
    const freshToken = createSecuritySessionToken('entry', now + ENTRY_SECURITY_SESSION_TTL_SECONDS, SETTINGS)
    const oldToken = createSecuritySessionToken(
      'entry',
      now + ENTRY_SECURITY_SESSION_REFRESH_WINDOW_SECONDS,
      SETTINGS,
    )

    expect(readValidSecuritySession(freshToken, 'entry', SETTINGS, now)).toEqual({
      expiresAt: now + ENTRY_SECURITY_SESSION_TTL_SECONDS,
      shouldRefresh: false,
    })
    expect(readValidSecuritySession(oldToken, 'entry', SETTINGS, now)).toEqual({
      expiresAt: now + ENTRY_SECURITY_SESSION_REFRESH_WINDOW_SECONDS,
      shouldRefresh: true,
    })
  })

  it('does not slide action confirmations', () => {
    const now = 1_000_000
    const token = createSecuritySessionToken('settings', now + 30, SETTINGS)
    expect(readValidSecuritySession(token, 'settings', SETTINGS, now)).toEqual({
      expiresAt: now + 30,
      shouldRefresh: false,
    })
  })

  it('rejects expired, altered, wrong-scope, and old-version tokens', () => {
    const now = 1_000_000
    const expired = createSecuritySessionToken('entry', now, SETTINGS)
    const valid = createSecuritySessionToken('entry', now + 60, SETTINGS)

    expect(readValidSecuritySession(expired, 'entry', SETTINGS, now)).toBeNull()
    expect(readValidSecuritySession(`${valid}changed`, 'entry', SETTINGS, now)).toBeNull()
    expect(readValidSecuritySession(valid, 'settings', SETTINGS, now)).toBeNull()
    expect(readValidSecuritySession(valid, 'entry', { ...SETTINGS, version: 'version-2' }, now)).toBeNull()
  })
})
