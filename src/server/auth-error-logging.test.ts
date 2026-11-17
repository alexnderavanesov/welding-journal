import { afterEach, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { inspect } from 'node:util'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import * as schema from '@/db/schema'

vi.mock('@/db', () => ({ requireDb: vi.fn() }))
import { createAuth } from './auth'
import { safeServerError } from './error-diagnostics'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('the installed Better Auth and Drizzle log a session query timeout without its real SQL parameters', async () => {
  const secret = 'local-test-secret-never-used-outside-this-test'
  const token = 'synthetic-private-session-token'
  vi.stubEnv('BETTER_AUTH_SECRET', secret)
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3100')
  vi.stubEnv('BETTER_AUTH_TELEMETRY', '0')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const query = vi.fn().mockRejectedValue(new Error('timeout exceeded when trying to connect'))
  const database = drizzle({ query } as unknown as Pool, { schema })
  const auth = createAuth(database)
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  const headers = new Headers({ cookie: `better-auth.session_token=${encodeURIComponent(token + '.' + signature)}` })
  const failure = await auth.api.getSession({ headers, query: { disableCookieCache: true } }).catch(error => error)
  expect(failure).toBeInstanceOf(Error)
  const responseError = safeServerError(failure, 'getCurrentAccount') as Error
  expect(responseError.message).toContain('Не удалось выполнить обращение к базе данных')
  expect(responseError.cause).toBeUndefined()
  expect(inspect(responseError)).not.toContain(token)
  expect(query).toHaveBeenCalled()
  // The token reached the real adapter/query; the logger must not emit it.
  expect(inspect(query.mock.calls)).toContain(token)
  expect(log).toHaveBeenCalled()
  const output = inspect(log.mock.calls)
  expect(output).toContain('connection-pool-timeout')
  for (const forbidden of [token, secret, 'select ', 'auth_sessions', 'cookie']) expect(output).not.toContain(forbidden)
})
