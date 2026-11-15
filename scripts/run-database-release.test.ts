import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), end: vi.fn(), query: vi.fn(), prepare: vi.fn(), ready: vi.fn(), prewarm: vi.fn(), spawn: vi.fn(),
}))
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawn, default: { spawnSync: mocks.spawn } }))
vi.mock('pg', () => ({ default: { Client: class {
  connect = vi.fn()
  query = mocks.query
  end = mocks.end
} } }))
vi.mock('../src/server-env', () => ({ loadServerEnv: vi.fn() }))
vi.mock('../src/db/ssl', () => ({ getDatabaseConnectionConfig: () => ({}) }))
vi.mock('../src/lib/release-command', () => ({
  parseReleaseCommand: () => ({ remote: false, databaseUrl: 'postgresql://localhost/welding_prewarm_test', host: 'localhost', database: 'welding_prewarm_test', dataOnly: true }),
  releaseMigrationSteps: () => [],
}))
vi.mock('../src/db/index', () => ({ requireDb: () => ({ transaction: mocks.transaction, $client: { end: mocks.end } }) }))
vi.mock('../src/server/release-data-transition', () => ({ prepareReleaseData: mocks.prepare }))
vi.mock('../src/server/release-readiness', () => ({ isDatabaseReleaseReady: mocks.ready }))
vi.mock('../src/server/dispatcher-prewarm', () => ({ prepareDispatcherCalculation: mocks.prewarm }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('WELDING_ENV_LOADED', '')
  mocks.spawn.mockReturnValue({ status: 0 })
  mocks.query.mockImplementation(async (query: string) => ({ rows: [query.includes('current_database') ? { database: 'welding_prewarm_test' } : { acquired: true }] }))
  mocks.transaction.mockResolvedValue({ skipped: true })
  mocks.ready.mockResolvedValue(true)
  mocks.prewarm.mockResolvedValue({ ready: true })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('prewarms only after data preparation commits and readiness is verified', async () => {
  let committed = false, verified = false
  mocks.transaction.mockImplementation(async () => { await Promise.resolve(); committed = true; return { skipped: true } })
  mocks.ready.mockImplementation(async () => { expect(committed).toBe(true); verified = true; return true })
  mocks.prewarm.mockImplementation(async () => { expect(committed && verified).toBe(true); return { ready: true } })
  await import('./run-database-release')
  expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith(mocks.prepare)
  expect(mocks.prewarm).toHaveBeenCalledOnce()
  expect(mocks.end).toHaveBeenCalledTimes(2)
})

it.each(['transaction', 'readiness'] as const)('does not prewarm after a failed %s step', async failure => {
  if (failure === 'transaction') mocks.transaction.mockRejectedValue(new Error('preparation failed'))
  else mocks.ready.mockResolvedValue(false)
  await expect(import('./run-database-release')).rejects.toThrow()
  expect(mocks.prewarm).not.toHaveBeenCalled()
  expect(mocks.end).toHaveBeenCalledTimes(2)
})

it('reports failed prewarming separately without revoking an already completed release', async () => {
  mocks.prewarm.mockRejectedValue(new Error('calculation failed'))
  await import('./run-database-release')
  expect(mocks.prewarm).toHaveBeenCalledOnce()
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('предварительный расчёт не готов'))
  const complete = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])
  expect(complete).toMatchObject({ phase: 'complete', ready: true, dispatcher: { ready: false } })
  expect(mocks.end).toHaveBeenCalledTimes(2)
})
