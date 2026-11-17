import { afterEach, expect, it, vi } from 'vitest'
import { inspect } from 'node:util'
import { DrizzleQueryError } from 'drizzle-orm'
import { errorDiagnostics, logAuthEvent, safeServerError } from './error-diagnostics'

afterEach(() => vi.restoreAllMocks())

it('retains a nested pool timeout without logging query, token, message, stack or arbitrary metadata', () => {
  const token = 'synthetic-session-token-private'
  const cause = Object.assign(new Error('timeout exceeded when trying to connect'), { detail: token })
  const query = new DrizzleQueryError('select secret_column from auth_sessions where token = $1', [token], cause)
  const wrapped = new Error('API error ' + token, { cause: query })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  logAuthEvent('error', 'INTERNAL_SERVER_ERROR', wrapped, { headers: { cookie: token }, password: token })
  const safe = safeServerError(wrapped, 'getCurrentAccount')
  expect(safe).toBeInstanceOf(Error)
  expect(safe).not.toBe(wrapped)
  expect(inspect(safe)).not.toContain(token)
  const output = inspect(log.mock.calls)
  expect(output).toContain('connection-pool-timeout')
  expect(output).toContain('getCurrentAccount')
  for (const secret of [token, 'secret_column', 'auth_sessions', 'select ', 'API error ', 'headers']) expect(output).not.toContain(secret)
  expect(query.params).toEqual([token]) // Never mutate the error used by rollback/business handlers.
})

it('keeps SQLSTATE and network codes but not database detail or unrecognised codes', () => {
  const error = Object.assign(new Error('password=private'), { code: '23505', detail: 'Key (email)=(private)' })
  expect(errorDiagnostics(error)).toEqual([{ type: 'error', code: '23505' }])
  expect(errorDiagnostics({ code: 'ECONNRESET' })).toEqual([{ type: 'error', code: 'ECONNRESET' }])
  expect(errorDiagnostics({ code: 'secret-token' })).toEqual([{ type: 'error' }])
})

it('does not serialize arbitrary logger strings, objects or cyclic causes', () => {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = new Error('private')
  error.cause = error
  expect(errorDiagnostics(error)).toHaveLength(1)
  logAuthEvent('warn', 'Failed query: select private', { token: 'private' }, 'private', error)
  expect(inspect(log.mock.calls)).not.toContain('private')
  logAuthEvent('warn', 'Rate limiting could not determine a client IP and is falling back to private')
  expect(inspect(log.mock.calls)).toContain('shared-ip-rate-limit')
  expect(inspect(log.mock.calls)).not.toContain('private')
})

it('leaves ordinary business rejections intact and does not add a log', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const error of [new Error('AUTH_REQUIRED: Сеанс завершён.'), new Error('СП-07: Проверьте стык.'),
    Object.assign(new Error('Внешнее хранилище недоступно'), { code: 'ECONNRESET' })]) {
    expect(safeServerError(error, 'save')).toBe(error)
  }
  expect(log).not.toHaveBeenCalled()
})
