import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ready: vi.fn(), refresh: vi.fn(), fresh: vi.fn(), db: {} }))
vi.mock('@/db', () => ({ requireDb: () => mocks.db }))
vi.mock('./release-readiness', () => ({ isDatabaseReleaseReady: mocks.ready }))
vi.mock('./dispatcher-task-index', () => ({ ensureDispatcherTaskIndexFresh: mocks.refresh, isDispatcherTaskIndexFresh: mocks.fresh }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }))
import { prepareDispatcherCalculation } from './dispatcher-prewarm'
import { Route } from '@/routes/api/maintenance/dispatcher-prewarm'

const state = { sourceRevision: 8, computedRevision: 8, computedAt: new Date('2026-11-14T03:30:00.000Z'), repeatedTasks: 'private task payload' }
const post = (headers: Record<string, string> = {}) => (Route as unknown as {
  server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } }
}).server.handlers.POST({ request: new Request('http://local/api/maintenance/dispatcher-prewarm', { method: 'POST', headers }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ready.mockResolvedValue(true)
  mocks.refresh.mockResolvedValue(state)
  mocks.fresh.mockReturnValue(true)
  vi.stubEnv('MAINTENANCE_TOKEN', 'operator-only-secret')
})
afterEach(() => vi.unstubAllEnvs())

it('uses only the existing conditional engine and returns no task/row payload', async () => {
  expect(await prepareDispatcherCalculation()).toEqual({ ready: true, sourceRevision: 8, computedRevision: 8, computedAt: state.computedAt.toISOString() })
  expect(mocks.ready).toHaveBeenCalledExactlyOnceWith(mocks.db)
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith()
  expect(mocks.fresh).toHaveBeenCalledExactlyOnceWith(state)
})

it('does not start a calculation before release preparation is complete', async () => {
  mocks.ready.mockResolvedValue(false)
  await expect(prepareDispatcherCalculation()).rejects.toThrow('Сначала завершите подготовку базы')
  expect(mocks.refresh).not.toHaveBeenCalled()
})

it('does not bless a stale result or introduce another automatic retry loop', async () => {
  mocks.fresh.mockReturnValue(false)
  await expect(prepareDispatcherCalculation()).rejects.toThrow('Актуальный результат пока не подтверждён')
  expect(mocks.refresh).toHaveBeenCalledOnce()
  mocks.refresh.mockRejectedValue(new Error('calculation failed'))
  await expect(prepareDispatcherCalculation()).rejects.toThrow('calculation failed')
  expect(mocks.refresh).toHaveBeenCalledTimes(2)
})

it('permits the configured operator token only, before accessing the database', async () => {
  vi.stubEnv('MAINTENANCE_TOKEN', '')
  expect((await post()).status).toBe(503)
  vi.stubEnv('MAINTENANCE_TOKEN', 'operator-only-secret')
  for (const authorization of ['', 'Bearer wrong-token', 'operator-only-secret']) {
    expect((await post({ authorization })).status).toBe(401)
  }
  expect(mocks.ready).not.toHaveBeenCalled()
  expect(mocks.refresh).not.toHaveBeenCalled()
  const response = await post({ authorization: 'Bearer operator-only-secret' })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ ready: true, computedRevision: 8 })
})

it('returns a truthful failure without SQL, credentials or an invented success', async () => {
  mocks.refresh.mockRejectedValue(new Error('private SQL and bind values'))
  const response = await post({ authorization: 'Bearer operator-only-secret' })
  expect(response.status).toBe(503)
  const body = await response.text()
  expect(body).toContain('Не удалось подготовить актуальный расчёт')
  expect(body).not.toMatch(/private SQL|operator-only-secret|"ready":true/)
})
