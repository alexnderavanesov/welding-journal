import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { eq, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import { appSettings } from '@/db/schema'
import type {
  SecurityPublicSettings,
  SecurityScope,
  SecuritySettings,
} from '@/lib/security-settings'

const SECURITY_SETTING_KEY = 'security'
const SESSION_TTL_SECONDS = 10 * 60
const SERVER_PASSWORD_PLACEHOLDER = '__server__'
const SECURITY_SCOPES: SecurityScope[] = [
  'entry',
  'settings',
  'edit',
  'importReplace',
  'documentGeneration',
  'delete',
]

type StoredSecurityScope = {
  enabled: boolean
  salt: string
  passwordHash: string
  version: string
}

type StoredSecuritySettings = {
  scopes: Partial<Record<SecurityScope, StoredSecurityScope>>
}

export async function getRemoteSecuritySettingsData() {
  const settings = await loadStoredSecuritySettings()
  return toPublicSettings(settings)
}

export async function authenticateSecurityScopeOnServer(data: {
  scope: SecurityScope
  password: string
}) {
  const validatedData = {
    scope: requireSecurityScope(data?.scope),
    password: String(data?.password ?? ''),
  }
  const settings = await loadStoredSecuritySettings()
  const scopeSettings = settings.scopes[validatedData.scope]
  if (!scopeSettings?.enabled) return { ok: true, enabled: false }
  if (!verifyPassword(validatedData.password, scopeSettings)) {
    throw new Error('Пароль не подходит')
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  setCookie(
    getSecurityCookieName(validatedData.scope),
    createSessionToken(validatedData.scope, expiresAt, scopeSettings),
    {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    },
  )
  return { ok: true, enabled: true, expiresAt }
}

export async function saveRemoteSecuritySettingsOnServer(data: SecuritySettings) {
  const current = await loadStoredSecuritySettings()
  await assertSecurityScope('settings', current)

  const next: StoredSecuritySettings = { scopes: {} }
  for (const scope of SECURITY_SCOPES) {
    const password = getScopePassword(data, scope)
    const currentScope = current.scopes[scope]
    if (password === SERVER_PASSWORD_PLACEHOLDER && currentScope) {
      next.scopes[scope] = {
        ...currentScope,
        enabled: getScopeEnabled(data, scope),
      }
      continue
    }
    const enabled = Boolean(password) && getScopeEnabled(data, scope)
    if (!password) continue
    if (currentScope && verifyPassword(password, currentScope)) {
      next.scopes[scope] = { ...currentScope, enabled }
    } else {
      next.scopes[scope] = createStoredScope(password, enabled)
    }
  }

  const db = requireDb()
  await db
    .insert(appSettings)
    .values({ key: SECURITY_SETTING_KEY, value: JSON.stringify(next) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(next), updatedAt: sql`now()` },
    })
  return toPublicSettings(next)
}

export async function assertSecurityScope(
  scope: SecurityScope,
  storedSettings?: StoredSecuritySettings,
) {
  const settings = storedSettings ?? await loadStoredSecuritySettings()
  const scopeSettings = settings.scopes[scope]
  if (!scopeSettings?.enabled) return
  const token = getCookie(getSecurityCookieName(scope))
  if (!token || !verifySessionToken(token, scope, scopeSettings)) {
    throw new Error('Требуется подтверждение паролем. Повторите действие и введите пароль.')
  }
}

async function loadStoredSecuritySettings(): Promise<StoredSecuritySettings> {
  const db = requireDb()
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SECURITY_SETTING_KEY))
    .limit(1)
  if (!row?.value) return { scopes: {} }
  try {
    const parsed = JSON.parse(row.value) as StoredSecuritySettings
    return parsed && typeof parsed === 'object' && parsed.scopes ? parsed : { scopes: {} }
  } catch {
    return { scopes: {} }
  }
}

function createStoredScope(password: string, enabled: boolean): StoredSecurityScope {
  const salt = randomBytes(16).toString('base64url')
  return {
    enabled,
    salt,
    passwordHash: hashPassword(password, salt),
    version: randomBytes(12).toString('base64url'),
  }
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString('base64url')
}

function verifyPassword(password: string, settings: StoredSecurityScope) {
  const expected = Buffer.from(settings.passwordHash, 'base64url')
  const actual = Buffer.from(hashPassword(password, settings.salt), 'base64url')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function createSessionToken(scope: SecurityScope, expiresAt: number, settings: StoredSecurityScope) {
  const payload = `${scope}.${expiresAt}.${settings.version}`
  return `${payload}.${signSessionPayload(payload, settings)}`
}

function verifySessionToken(token: string, scope: SecurityScope, settings: StoredSecurityScope) {
  const parts = token.split('.')
  if (parts.length !== 4) return false
  const [tokenScope, rawExpiresAt, version, signature] = parts
  if (tokenScope !== scope || version !== settings.version) return false
  const expiresAt = Number(rawExpiresAt)
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false
  const payload = `${tokenScope}.${rawExpiresAt}.${version}`
  const expected = Buffer.from(signSessionPayload(payload, settings), 'base64url')
  const actual = Buffer.from(signature, 'base64url')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function signSessionPayload(payload: string, settings: StoredSecurityScope) {
  return createHmac('sha256', `${settings.passwordHash}:${settings.version}`)
    .update(payload)
    .digest('base64url')
}

function getSecurityCookieName(scope: SecurityScope) {
  return `welding_security_${scope}`
}

function toPublicSettings(settings: StoredSecuritySettings): SecurityPublicSettings {
  return {
    configured: SECURITY_SCOPES.some((scope) => Boolean(settings.scopes[scope])),
    configuredScopes: Object.fromEntries(
      SECURITY_SCOPES.map((scope) => [scope, Boolean(settings.scopes[scope])]),
    ) as Record<SecurityScope, boolean>,
    ...Object.fromEntries(
      SECURITY_SCOPES.map((scope) => [scope, Boolean(settings.scopes[scope]?.enabled)]),
    ),
  } as SecurityPublicSettings
}

function requireSecurityScope(value: unknown): SecurityScope {
  if (!SECURITY_SCOPES.includes(value as SecurityScope)) throw new Error('Неизвестная область защиты')
  return value as SecurityScope
}

function getScopePassword(settings: SecuritySettings, scope: SecurityScope) {
  if (scope === 'entry') return String(settings.entryPassword ?? '')
  if (scope === 'settings') return String(settings.settingsPassword ?? '')
  if (scope === 'edit') return String(settings.editPassword ?? '')
  if (scope === 'importReplace') return String(settings.importReplacePassword ?? '')
  if (scope === 'documentGeneration') return String(settings.documentGenerationPassword ?? '')
  return String(settings.deletePassword ?? '')
}

function getScopeEnabled(settings: SecuritySettings, scope: SecurityScope) {
  if (scope === 'entry') return settings.requirePasswordOnEntry === true
  if (scope === 'settings') return settings.protectSettings === true
  if (scope === 'edit') return settings.protectEdit === true
  if (scope === 'importReplace') return settings.protectImportReplace === true
  if (scope === 'documentGeneration') return settings.protectDocumentGeneration === true
  return settings.protectDelete === true
}
