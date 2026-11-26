import { PublicRequestError } from '@/lib/public-request-error'
import { afterEach, expect, it, vi } from 'vitest'
import { inspect } from 'node:util'
import { readFile } from 'node:fs/promises'
import { DrizzleQueryError } from 'drizzle-orm'
import { errorDiagnostics, logAuthEvent, safeServerError, publicHttpError } from './error-diagnostics'

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

it('keeps a template filesystem path out of the RPC response and log', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  // The parent is this existing test file, so the operation deterministically fails with ENOTDIR.
  const error = await readFile(new URL(`${import.meta.url}/private-template.xlsx`)).catch(error => error)
  expect(error.code).toBe('ENOTDIR')
  const response = safeServerError(error, 'getRemoteDocumentTemplate') as Error
  expect(response.message).toContain('хранилищу файлов')
  const eventId = response.message.match(/[a-f0-9-]{36}/)?.[0]
  expect(eventId).toBeTruthy()
  expect(log.mock.lastCall?.[0]).toContain(eventId)
  expect(log.mock.lastCall?.[0]).toContain('ENOTDIR')
  expect(JSON.stringify([response.message, log.mock.calls])).not.toContain('private-template.xlsx')
})


it('returns only intentional client messages and a correlatable safe ID for technical HTTP failures', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(publicHttpError(new PublicRequestError('Доступ закрыт.', 403), 'export', 'Ошибка.')).toEqual({ message: 'Доступ закрыт.', status: 403 })
  for (const error of [new Error('private-marker'), new DrizzleQueryError('select private_table', ['private-marker'], new Error('private-marker'))]) {
    const result = publicHttpError(error, 'export', 'Ошибка.')
    expect(result.status).toBe(500)
    const id = result.message.match(/[a-f0-9-]{36}/)?.[0]
    expect(id).toBeTruthy()
    expect(log.mock.lastCall?.[0]).toContain(id)
    expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/private-marker|private_table/)
  }
})
