import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { APIError } from 'better-auth/api'
import { requireDb } from '@/db'
import { authAccounts, authRateLimits, authSessions, authUsers, authVerifications } from '@/db/schema'
import { logAuthEvent } from './error-diagnostics'

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
    logger: { log: logAuthEvent },
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
      // The public sign-in handler owns both the source and account budgets.
      customRules: { '/sign-in/email': false } },
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

// Count streamed bytes too, including requests with no Content-Length.
async function readSignInBody(request: Request): Promise<string | null> {
  const maxBytes = 16 * 1024
  if (Number(request.headers.get('content-length')) > maxBytes) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
  const cancel = () => { void reader.cancel().catch(() => {}) }
  deadline.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      deadline.throwIfAborted()
      const { done, value } = await reader.read()
      deadline.throwIfAborted()
      if (done) return Buffer.concat(chunks).toString('utf8')
      size += value.byteLength
      if (size > maxBytes) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } finally { deadline.removeEventListener('abort', cancel); reader.releaseLock() }
}

let activeSignIns = 0
function throttled() {
  return Response.json({ message: 'Слишком много попыток. Повторите через минуту.' },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } })
}

async function signIn(request: Request) {
  const { accountRateLimit, AccountRateLimitError, limitSignInAccount } = await import('./account-management')
  const { isIP } = await import('node:net')
  const forwarded = process.env.AUTH_TRUST_PROXY === 'true' ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined
  const ip = forwarded && isIP(forwarded) ? forwarded : 'shared'
  let busySource = false
  try { await accountRateLimit(`signin-path:${ip}`, 60) }
  catch (error) {
    if (!(error instanceof AccountRateLimitError)) return throttled()
    busySource = true
  }
  let body: string | null
  try { body = await readSignInBody(request) }
  catch { return new Response(null, { status: 408, headers: { 'Cache-Control': 'no-store' } }) }
  if (body === null) return Response.json({ message: 'Слишком большой запрос входа.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } })
  let email: unknown
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (type === 'application/x-www-form-urlencoded') {
    const addresses = new URLSearchParams(body).getAll('email')
    if (addresses.length !== 1) return Response.json({ message: 'Укажите один адрес почты.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    email = addresses[0]
  } else if (type === 'application/json' || !type) {
    try { email = JSON.parse(body)?.email } catch { /* Better Auth validates the body. */ }
  }
  else return Response.json({ message: 'Некорректный формат запроса входа.' }, { status: 415, headers: { 'Cache-Control': 'no-store' } })
  try { await limitSignInAccount(typeof email === 'string' ? email.trim().toLowerCase() : '', busySource, getAuthConfiguration().secret) }
  catch { return throttled() }
  return getAuth().handler(new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal }))
}

export async function handleAuthRequest(request: Request) {
  const path = new URL(request.url).pathname.slice('/api/auth'.length)
  if (AUTH_HTTP_ENDPOINTS.get(path) !== request.method) return new Response('Не найдено.', { status: 404 })
  let response: Response
  if (path === '/sign-in/email') {
    // Bound body readers and password work before touching the body or database.
    // Leave room for the supported 25-person office starting work together.
    if (activeSignIns >= 64) return throttled()
    activeSignIns++
    try { response = await signIn(request) }
    finally { activeSignIns-- }
  } else response = await getAuth().handler(request)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
