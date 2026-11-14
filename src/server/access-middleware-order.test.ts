import { beforeEach, expect, it, vi } from 'vitest'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'

const state = vi.hoisted(() => ({ permissions: [] as string[], documents: [] as { id: number; type: string }[], reads: vi.fn() }))
vi.mock('@tanstack/react-start', () => ({ createMiddleware: () => ({ server: (handler: unknown) => handler }) }))
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn(), getRequestHeader: () => undefined, getRequestHeaders: () => new Headers() }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: () => {
  state.reads()
  return { from: () => ({ where: async () => state.documents }) }
} }) }))
vi.mock('./access-context', async () => ({ ...await vi.importActual<typeof import('./access-context')>('./access-context'),
  requireIdentity: async (): Promise<AccessIdentity> => ({ id: 'restricted-editor', name: 'Проверка доступа', email: '', title: '', role: 'user', revision: 1, permissions: state.permissions as Permission[] }),
}))
vi.mock('./audit-origin-policy', () => ({ createAuditOriginResolver: () => undefined }))
vi.mock('./workflow-conflict-diagnostics', () => ({ reportWorkflowConflict: vi.fn() }))

import { accessMiddleware } from './access-middleware'

type Middleware = (input: { next: () => Promise<{ result: unknown }>; data: unknown; serverFnMeta: { filename: string; name: string } }) => Promise<unknown>
function invoke(next = vi.fn(async () => ({ result: { ok: true } }))) {
  return { next, result: (accessMiddleware as unknown as Middleware)({ next, data: { documentIds: [42] },
    serverFnMeta: { filename: '/src/server/document-operations.ts', name: 'applyDocumentOperation' } }) }
}

beforeEach(() => { state.permissions = []; state.documents = []; state.reads.mockClear() })

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
