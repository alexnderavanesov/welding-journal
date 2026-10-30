import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { APIError } from 'better-auth/api'
import { requireDb } from '@/db'
import { authAccounts, authRateLimits, authSessions, authUsers, authVerifications } from '@/db/schema'

export function getAuthConfiguration() {
  const secret = process.env.BETTER_AUTH_SECRET
  const baseURL = process.env.BETTER_AUTH_URL
  if (!secret || secret.length < 32 || !baseURL) throw new Error('Авторизация ещё не настроена администратором.')
  const url = new URL(baseURL)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Для авторизации требуется HTTPS.')
  }
  return { secret, baseURL: url.origin }
}

export function createAuth(database: ReturnType<typeof requireDb>) {
  const configuration = getAuthConfiguration()
  return betterAuth({
    ...configuration, appName: 'Учёт сварки',
    plugins: [tanstackStartCookies()],
    trustedOrigins: [configuration.baseURL],
    database: drizzleAdapter(database, { provider: 'pg', transaction: true, schema: {
      user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications, rateLimit: authRateLimits,
    } }),
    emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: true,
      minPasswordLength: 6, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 86400, updateAge: 3600, cookieCache: { enabled: false } },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false }, additionalFields: {
      title: { type: 'string', input: false, defaultValue: '' },
      role: { type: 'string', input: false, defaultValue: 'user' },
      status: { type: 'string', input: false, defaultValue: 'pending' },
    } },
    account: { accountLinking: { enabled: false } },
    verification: { storeIdentifier: 'hashed' },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 60 } } },
    advanced: { useSecureCookies: configuration.baseURL.startsWith('https:'),
      ipAddress: { ipAddressHeaders: process.env.AUTH_TRUST_PROXY === 'true' ? ['x-forwarded-for'] : [] } },
    databaseHooks: { session: { create: { before: async session => {
      const { eq } = await import('drizzle-orm')
      const [user] = await database.select({ status: authUsers.status, verified: authUsers.emailVerified })
        .from(authUsers).where(eq(authUsers.id, session.userId))
      if (user?.status !== 'active' || !user.verified) throw new APIError('UNAUTHORIZED', { message: 'Требуется активация приглашения.' })
      return { data: session }
    } } } },
  })
}
let instance: ReturnType<typeof createAuth> | undefined
export function getAuth() { return instance ??= createAuth(requireDb()) }

// Only the library's session endpoints are public. Account management, first
// password and recovery use the application transaction and its access rules.
export const AUTH_HTTP_ENDPOINTS = new Map([
  ['/sign-in/email', 'POST'], ['/sign-out', 'POST'], ['/get-session', 'GET'],
])
export async function handleAuthRequest(request: Request) {
  const path = new URL(request.url).pathname.slice('/api/auth'.length)
  if (AUTH_HTTP_ENDPOINTS.get(path) !== request.method) return new Response('Не найдено.', { status: 404 })
  if (path === '/sign-in/email') {
    const { createHash } = await import('node:crypto')
    const { accountRateLimit } = await import('./account-management')
    const payload = await request.clone().json().catch(() => null)
    const emailKey = createHash('sha256').update(String(payload?.email ?? '').trim().toLowerCase()).digest('hex')
    try {
      // Bound anonymous key creation before storing a new per-email bucket.
      // Proxy headers are accepted only after the operator explicitly enables trust.
      const ip = process.env.AUTH_TRUST_PROXY === 'true' ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 100) || 'shared' : 'shared'
      await accountRateLimit(`signin-path:${ip}`, 60)
      await accountRateLimit(`signin:${emailKey}`, 8)
    }
    catch { return Response.json({ message: 'Слишком много попыток. Повторите через минуту.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } }) }
  }
  const response = await getAuth().handler(request)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
