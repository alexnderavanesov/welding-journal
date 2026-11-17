// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ hook: vi.fn(), schedule: vi.fn(), stop: vi.fn(), prepare: vi.fn() }))
vi.mock('nitro', () => ({ definePlugin: (plugin: unknown) => plugin }))
vi.mock('nitro/app', () => ({ useNitroHooks: () => ({ hook: mocks.hook }) }))
vi.mock('./dispatcher-prewarm-schedule', () => ({
  startDispatcherPrewarmSchedule: mocks.schedule,
  nextDispatcherPrewarmAt: () => new Date('2026-11-17T03:30:00Z'),
}))
vi.mock('./dispatcher-prewarm', () => ({ prepareDispatcherCalculation: mocks.prepare }))
import plugin from './dispatcher-prewarm-plugin'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.schedule.mockReturnValue(mocks.stop)
  mocks.prepare.mockResolvedValue({ ready: true, computedAt: '2026-11-17T03:30:01Z' })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(process, 'once').mockReturnValue(process)
  vi.spyOn(process, 'off').mockReturnValue(process)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

it.each([['development', '1'], ['test', '1'], ['production', undefined], ['production', '0']])(
  'does not activate for NODE_ENV=%s and flag=%s', (mode, flag) => {
    vi.stubEnv('NODE_ENV', mode)
    vi.stubEnv('DISPATCHER_PREWARM_ENABLED', flag)
    plugin({} as Parameters<typeof plugin>[0])
    expect(mocks.schedule).not.toHaveBeenCalled()
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.hook).not.toHaveBeenCalled()
  },
)

it('starts without database work or a maintenance token, then calls the protected conditional service', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('DISPATCHER_PREWARM_ENABLED', '1')
  vi.stubEnv('MAINTENANCE_TOKEN', '')
  plugin({} as Parameters<typeof plugin>[0])
  expect(mocks.schedule).toHaveBeenCalledTimes(1)
  expect(mocks.prepare).not.toHaveBeenCalled()
  await mocks.schedule.mock.calls[0][0]()
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith()
  const close = mocks.hook.mock.calls.find(([name]) => name === 'close')![1]
  expect(process.once).toHaveBeenCalledWith('SIGTERM', close)
  expect(process.once).toHaveBeenCalledWith('SIGINT', close)
  close()
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  expect(process.off).toHaveBeenCalledWith('SIGTERM', close)
  expect(process.off).toHaveBeenCalledWith('SIGINT', close)
})
