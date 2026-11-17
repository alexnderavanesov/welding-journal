import { beforeEach, expect, it, vi } from 'vitest'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
import { DrizzleQueryError } from 'drizzle-orm'
import { setResponseHeader } from '@tanstack/react-start/server'

const state = vi.hoisted(() => ({ permissions: [] as string[], documents: [] as { id: number; type: string }[], reads: vi.fn(), identityError: undefined as unknown }))
vi.mock('@tanstack/react-start', () => ({ createMiddleware: () => ({ server: (handler: unknown) => handler }) }))
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn(), getRequestHeader: () => undefined, getRequestHeaders: () => new Headers() }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: () => {
  state.reads()
  return { from: () => ({ where: async () => state.documents }) }
} }) }))
vi.mock('./access-context', async () => ({ ...await vi.importActual<typeof import('./access-context')>('./access-context'),
  requireIdentity: async (): Promise<AccessIdentity> => {
    if (state.identityError) throw state.identityError
    return { id: 'restricted-editor', name: 'Проверка доступа', email: '', title: '', role: 'user', revision: 1, permissions: state.permissions as Permission[] }
  },
}))
vi.mock('./audit-origin-policy', () => ({ createAuditOriginResolver: () => undefined }))
vi.mock('./workflow-conflict-diagnostics', () => ({ reportWorkflowConflict: vi.fn() }))

import { accessMiddleware } from './access-middleware'

type Middleware = (input: { next: () => Promise<{ result: unknown }>; data: unknown; serverFnMeta: { filename: string; name: string } }) => Promise<unknown>
function invoke(next = vi.fn(async () => ({ result: { ok: true } }))) {
  return { next, result: (accessMiddleware as unknown as Middleware)({ next, data: { documentIds: [42] },
    serverFnMeta: { filename: '/src/server/document-operations.ts', name: 'applyDocumentOperation' } }) }
}

beforeEach(() => { state.permissions = []; state.documents = []; state.identityError = undefined; vi.clearAllMocks() })

it('signals an expired identity but not a transient failure, and denies both before running an operation', async () => {
  for (const expired of [false, true]) {
    vi.mocked(setResponseHeader).mockClear()
    state.identityError = new Error(expired ? 'AUTH_REQUIRED: Сеанс завершён.' : 'Проверка временно недоступна.')
    const request = invoke()
    await expect(request.result).rejects.toBe(state.identityError)
    expect(request.next).not.toHaveBeenCalled()
    expect(state.reads).not.toHaveBeenCalled()
    expect(vi.mocked(setResponseHeader).mock.calls.some(([name]) => name === 'X-Access-Expired')).toBe(expired)
  }
})

it('sanitizes a database failure in the public account-check branch before transport logging', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const next = vi.fn().mockRejectedValue(new DrizzleQueryError('select private_query', ['private_token'], new Error('timeout exceeded when trying to connect')))
    const result = (accessMiddleware as unknown as Middleware)({ next, data: undefined,
      serverFnMeta: { filename: '/src/server/account-api.ts', name: 'getCurrentAccount' } })
    await expect(result).rejects.toThrow('Не удалось выполнить обращение к базе данных')
    expect(next).toHaveBeenCalledOnce()
    expect(JSON.stringify(log.mock.calls)).not.toContain('private_')
    expect(vi.mocked(setResponseHeader).mock.calls.some(([name]) => name === 'X-Access-Expired')).toBe(false)
  } finally { log.mockRestore() }
})

it.each([false, true])('denies before reading whether a protected document exists (%s)', async exists => {
  state.documents = exists ? [{ id: 42, type: 'system:pstoRequest' }] : []
  const request = invoke()
  await expect(request.result).rejects.toThrow('Недостаточно прав')
  expect(state.reads).not.toHaveBeenCalled()
  expect(request.next).not.toHaveBeenCalled()
})

it('requires the stored document specialty after the base permission passes', async () => {
  state.permissions = ['documents.view', 'documents.edit']
  state.documents = [{ id: 42, type: 'system:pstoRequest' }]
  const request = invoke()
  await expect(request.result).rejects.toThrow('Недостаточно прав')
  expect(state.reads).toHaveBeenCalledOnce()
  expect(request.next).not.toHaveBeenCalled()
})

it('runs the operation only with both base and stored specialty permissions', async () => {
  state.permissions = ['documents.view', 'documents.edit', 'psto.view', 'psto.edit']
  state.documents = [{ id: 42, type: 'system:pstoRequest' }]
  const request = invoke()
  await expect(request.result).resolves.toEqual({ result: { ok: true } })
  expect(state.reads).toHaveBeenCalledOnce()
  expect(request.next).toHaveBeenCalledOnce()
})
