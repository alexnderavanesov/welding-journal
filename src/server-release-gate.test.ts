import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { handler, probe } = vi.hoisted(() => ({ handler: vi.fn(), probe: vi.fn() }))
vi.mock('@tanstack/react-start/server-entry', () => ({ default: { fetch: handler } }))
vi.mock('./db', () => ({ requireDb: () => ({}) }))
vi.mock('./server/release-readiness', () => ({ isDatabaseReleaseReady: probe }))

beforeEach(() => {
  vi.resetModules()
  handler.mockReset().mockResolvedValue(new Response('application'))
  probe.mockReset().mockResolvedValue(false)
  vi.stubEnv('NODE_ENV', 'production')
})
afterEach(() => vi.unstubAllEnvs())

it('blocks actual production entry before SSR, RPC and maintenance dispatch', async () => {
  const { default: server } = await import('./server')
  for (const [path, method] of [['/journal', 'GET'], ['/_serverFn/stale-save', 'POST'], ['/api/maintenance/dispatcher-refresh', 'POST']]) {
    expect((await server.fetch(new Request(`http://local${path}`, { method }))).status).toBe(503)
  }
  expect(handler).not.toHaveBeenCalled()
  expect(probe).toHaveBeenCalledTimes(1)
})

it('does not use the application or the DB for container liveness', async () => {
  const { default: server } = await import('./server')
  expect((await server.fetch(new Request('http://local/health/live'))).status).toBe(200)
  expect(handler).not.toHaveBeenCalled()
  expect(probe).not.toHaveBeenCalled()
})

it('allows ready production RPC and preserves its runtime context', async () => {
  probe.mockResolvedValue(true)
  const { default: server } = await import('./server')
  const request = new Request('http://local/_serverFn/known', { method: 'POST', body: '{}' })
  Object.defineProperty(request, 'context', { value: { requestId: 42 } })
  expect((await server.fetch(request)).status).toBe(200)
  expect(handler).toHaveBeenCalledTimes(1)
  expect(handler.mock.calls[0][0].context).toEqual({ requestId: 42 })
})

it('keeps the developer workflow unchanged', async () => {
  vi.stubEnv('NODE_ENV', 'development')
  const { default: server } = await import('./server')
  expect((await server.fetch(new Request('http://local/journal'))).status).toBe(200)
  expect(handler).toHaveBeenCalledTimes(1)
  expect(probe).not.toHaveBeenCalled()
})
