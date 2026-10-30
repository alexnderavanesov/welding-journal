import { randomBytes } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { E2E_DATABASE_URL, assertSafeE2eDatabaseUrl, withE2eDatabase } from './database'

/** Separate fixture setup across cases. Keep HTTP sign-in/link throttling intact;
 * direct setup calls share the synthetic owner and the no-request operator key.
 * The rate limiter itself is exercised by verify-authentication.ts. */
export async function resetE2eAccountFixtureLimits() {
  await withE2eDatabase(db => db.query(`delete from auth_rate_limits where key = 'complete:operator'
    or key = 'invite:' || (select id from auth_users where email = 'owner@e2e.test')`))
}

/** Only the fixture runner, after it owns an empty local DB, calls this. */
export async function prepareE2eAuthentication(directory: string) {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const baseURL = `http://127.0.0.1:${process.env.E2E_PORT || 3100}`
  Object.assign(process.env, { DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), BETTER_AUTH_URL: baseURL,
    AUTH_MAIL_MODE: 'local', AUTH_MAIL_LOCAL_DIR: directory, SMTP_HOST: '127.0.0.1',
    E2E_AUTH_PASSWORD: randomBytes(16).toString('hex') })
  const { bootstrapOwner, completeAccountLink } = await import('../src/server/account-management')
  const { closeDatabase } = await import('../src/db')
  try {
    await bootstrapOwner({ name: 'Владелец E2E', email: 'owner@e2e.test', title: 'Тест' })
    const token = await latestE2eToken(directory)
    await completeAccountLink({ token, kind: 'invite', password: process.env.E2E_AUTH_PASSWORD! })
    const { getAuth } = await import('../src/server/auth')
    const response = await getAuth().handler(new Request(`${baseURL}/api/auth/sign-in/email`, { method: 'POST',
      headers: { origin: baseURL, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@e2e.test', password: process.env.E2E_AUTH_PASSWORD }) }))
    if (!response.ok) throw new Error(`E2E login failed: ${response.status}`)
    const cookies = response.headers.getSetCookie().map(cookie => {
      const [pair] = cookie.split(';'), separator = pair.indexOf('=')
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1), domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' as const, expires: Math.floor(Date.now() / 1000) + 86400 }
    })
    if (!cookies.length) throw new Error('E2E login did not return cookies')
    process.env.E2E_AUTH_STATE = join(directory, 'storage-state.json')
    await writeFile(process.env.E2E_AUTH_STATE, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 })
  } finally { await closeDatabase() }
}
export async function latestE2eToken(directory = process.env.AUTH_MAIL_LOCAL_DIR!) {
  const file = (await readdir(directory)).filter(file => file.endsWith('.eml')).sort().at(-1)
  if (!file) throw new Error('No local account message')
  const raw = await readFile(join(directory, file), 'utf8')
  const body = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n')
  const text = /Content-Transfer-Encoding: base64/i.test(raw) ? Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') : body.replace(/=\r?\n/g, '').replace(/=3D/g, '=')
  const token = /token=([A-Za-z0-9_-]{48})/.exec(text)?.[1]
  if (!token) throw new Error('Local message is missing its account link')
  return token
}

/** Set the runner's owner session without loading application HTML/JS before a
 * Safari measurement. Only the JSON session endpoint is opened at this stage. */
export async function authenticateE2eSafari(command: (path: string, body?: unknown, method?: string) => Promise<any>, session: string) {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  const origin = new URL(process.env.BETTER_AUTH_URL ?? '')
  if (origin.hostname !== '127.0.0.1' || origin.port !== (process.env.E2E_PORT || '3100') || !process.env.E2E_AUTH_STATE) throw new Error('Safari authentication requires the prepared local E2E runner.')
  const state = JSON.parse(await readFile(process.env.E2E_AUTH_STATE, 'utf8'))
  if (!Array.isArray(state.cookies) || !state.cookies.length) throw new Error('Missing E2E session cookies.')
  await command(session + '/url', { url: origin.origin + '/api/auth/get-session' })
  for (const cookie of state.cookies) {
    if (cookie.domain !== origin.hostname || cookie.path !== '/') throw new Error('E2E cookie belongs to another origin.')
    await command(session + '/cookie', { cookie: { name: cookie.name, value: cookie.value, domain: cookie.domain,
      path: cookie.path, httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite,
      ...(cookie.expires > 0 ? { expiry: Math.floor(cookie.expires) } : {}) } })
  }
}
