import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SecurityScope } from '@/lib/security-settings'

export const ENTRY_SECURITY_SESSION_TTL_SECONDS = 12 * 60 * 60
export const ACTION_SECURITY_SESSION_TTL_SECONDS = 10 * 60
export const ENTRY_SECURITY_SESSION_REFRESH_WINDOW_SECONDS = 2 * 60 * 60

type SecuritySessionSettings = {
  passwordHash: string
  version: string
}

export type ValidSecuritySession = {
  expiresAt: number
  shouldRefresh: boolean
}

export function getSecuritySessionTtlSeconds(scope: SecurityScope) {
  return scope === 'entry'
    ? ENTRY_SECURITY_SESSION_TTL_SECONDS
    : ACTION_SECURITY_SESSION_TTL_SECONDS
}

export function createSecuritySessionToken(
  scope: SecurityScope,
  expiresAt: number,
  settings: SecuritySessionSettings,
) {
  const payload = `${scope}.${expiresAt}.${settings.version}`
  return `${payload}.${signSessionPayload(payload, settings)}`
}

export function readValidSecuritySession(
  token: string,
  scope: SecurityScope,
  settings: SecuritySessionSettings,
  nowSeconds = Math.floor(Date.now() / 1000),
): ValidSecuritySession | null {
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [tokenScope, rawExpiresAt, version, signature] = parts
  if (tokenScope !== scope || version !== settings.version) return null
  const expiresAt = Number(rawExpiresAt)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) return null
  const payload = `${tokenScope}.${rawExpiresAt}.${version}`
  const expected = Buffer.from(signSessionPayload(payload, settings), 'base64url')
  const actual = Buffer.from(signature, 'base64url')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  return {
    expiresAt,
    shouldRefresh:
      scope === 'entry'
      && expiresAt - nowSeconds <= ENTRY_SECURITY_SESSION_REFRESH_WINDOW_SECONDS,
  }
}

function signSessionPayload(payload: string, settings: SecuritySessionSettings) {
  return createHmac('sha256', `${settings.passwordHash}:${settings.version}`)
    .update(payload)
    .digest('base64url')
}
