import { PublicRequestError } from '@/lib/public-request-error'
import { DrizzleQueryError } from 'drizzle-orm'

const POOL_TIMEOUT = 'timeout exceeded when trying to connect'
const SQL_STATE = /^[0-5][0-9A-Z]{4}$/
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE'])
const FILE_CODES = new Set(['EACCES', 'EBUSY', 'EDQUOT', 'EEXIST', 'EIO', 'EISDIR', 'ELOOP', 'EMFILE', 'ENAMETOOLONG',
  'ENFILE', 'ENOENT', 'ENOSPC', 'ENOTDIR', 'EPERM', 'EROFS', 'ESTALE'])

/** Allowlisted metadata only: message/stack/query/params/detail can all contain
 * credentials or user data, including inside nested causes and API errors. */
export function errorDiagnostics(error: unknown) {
  const diagnostics: { type: string; code?: string; reason?: string }[] = []
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error) && diagnostics.length < 5) {
    seen.add(error)
    const value = error as { code?: unknown; errno?: unknown; syscall?: unknown; path?: unknown; message?: unknown; cause?: unknown }
    const fileError = typeof value.path === 'string' && typeof value.syscall === 'string' && typeof value.errno === 'number'
    const code = typeof value.code === 'string' && (SQL_STATE.test(value.code) || NETWORK_CODES.has(value.code) ||
      fileError && FILE_CODES.has(value.code)) ? value.code : undefined
    diagnostics.push({ type: error instanceof DrizzleQueryError ? 'database-query' : fileError ? 'filesystem' : 'error',
      ...(code ? { code } : {}), ...(value.message === POOL_TIMEOUT ? { reason: 'connection-pool-timeout' } : {}) })
    error = value.cause
  }
  return diagnostics
}

export function logAuthEvent(level: string, message: unknown, ...args: unknown[]) {
  const event = message === 'INTERNAL_SERVER_ERROR' ? 'internal-error'
    : typeof message === 'string' && message.startsWith('Rate limiting could not determine a client IP') ? 'shared-ip-rate-limit'
      : 'auth-message'
  const record = JSON.stringify({ event, source: 'better-auth', level, time: new Date().toISOString(),
    errors: [message, ...args].flatMap(errorDiagnostics) })
  if (level === 'error') console.error(record)
  else if (level === 'warn') console.warn(record)
  else console.info(record)
}

/** Called only at the RPC boundary, after business error/rollback handling.
 * Keep the original error for ordinary validation and workflow conflicts. */
export function safeServerError(error: unknown, operation: string) {
  if (error instanceof PublicRequestError && error.cause !== undefined) return new Error(error.message)
  const diagnostics = errorDiagnostics(error)
  if (diagnostics.some(item => item.type === 'filesystem')) {
    const eventId = logTechnicalError(operation, error)
    return new Error(`Не удалось обратиться к хранилищу файлов. Если вы сохраняли данные, проверьте результат сохранения. Код события: ${eventId}.`)
  }
  if (!diagnostics.some(item => item.type === 'database-query' || item.code && SQL_STATE.test(item.code) || item.reason)) return error
  console.error(JSON.stringify({ event: 'database-error', operation, time: new Date().toISOString(), errors: diagnostics }))
  // No raw cause: the framework may serialize or print it independently.
  return new Error('Не удалось выполнить обращение к базе данных. Повторите загрузку. Если вы сохраняли данные, сначала проверьте результат сохранения.')
}

export function logTechnicalError(operation: string, error: unknown) {
  const eventId = globalThis.crypto.randomUUID()
  console.error(JSON.stringify({ event: 'technical-error', eventId, operation, errors: errorDiagnostics(error) }))
  return eventId
}

export function publicHttpError(error: unknown, operation: string, fallback: string) {
  if (error instanceof PublicRequestError) return { message: error.message, status: error.status }
  if (error instanceof DOMException && error.name === 'AbortError') return { status: 400, message: 'Операция отменена.' }
  const eventId = logTechnicalError(operation, error)
  return { status: 500, message: `${fallback} Код события: ${eventId}.` }
}

export async function readRequestJson(request: Request) {
  try { return await request.json() }
  catch (error) {
    if (error instanceof SyntaxError) throw new PublicRequestError('Некорректный формат запроса.')
    throw error
  }
}
