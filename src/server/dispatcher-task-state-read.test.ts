import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureDispatcherTaskIndexFresh, readDispatcherTaskIndexState } from '@/server/dispatcher-task-index'
import { prepareDispatcherCalculation } from './dispatcher-prewarm'
import { serializeDispatcherTaskIndexPayload } from '@/lib/dispatcher-task-index-payload'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn(), limit: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ execute: mocks.execute, select: mocks.select }) }))
vi.mock('./release-readiness', () => ({ isDatabaseReleaseReady: async () => true }))

describe('dispatcher state initialization', () => {
  const state = { id: 1, sourceRevision: 0, computedRevision: -1, repeatedTasks: [],
    welderStampExpiryTasks: [], duplicateKeys: [], dirtyScopes: [], fullRebuild: true,
    computedAt: null, updatedAt: '2026-09-23T00:00:00.000Z' }
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: mocks.limit }) }) })
    mocks.limit.mockResolvedValue([state])
  })

  it('reads an existing or newly inserted state in one statement', async () => {
    mocks.execute.mockResolvedValue({ rows: [state] })
    expect(await readDispatcherTaskIndexState({ scheduleRefresh: false })).toMatchObject({ id: 1, sourceRevision: 0 })
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('uses a fresh snapshot when a concurrent first insert wins but is invisible to the CTE', async () => {
    mocks.execute.mockResolvedValue({ rows: [] })
    expect(await readDispatcherTaskIndexState({ scheduleRefresh: false })).toMatchObject({ id: 1, sourceRevision: 0 })
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.limit).toHaveBeenCalledWith(1)
  })

  it('coalesces operator and user checks and never starts a rebuild for a fresh calculation', async () => {
    const current = { ...state, sourceRevision: 7, computedRevision: 7, fullRebuild: false,
      repeatedTasks: serializeDispatcherTaskIndexPayload([]), dirtyScopes: '[]', computedAt: new Date(), updatedAt: new Date() }
    let finish!: (value: { rows: typeof current[] }) => void
    mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const requests = [prepareDispatcherCalculation(), prepareDispatcherCalculation(), ensureDispatcherTaskIndexFresh()]
    await Promise.resolve()
    expect(mocks.execute).toHaveBeenCalledOnce()
    finish({ rows: [current] })
    const [first, second, user] = await Promise.all(requests)
    expect(first).toMatchObject({ ready: true, computedRevision: 7 })
    expect(second).toEqual(first)
    expect(user).toMatchObject({ sourceRevision: 7, computedRevision: 7 })
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.select).not.toHaveBeenCalled()
    // No transaction/updates are provided by this DB mock: any attempt to
    // rebuild or republish the fresh result would fail the test.
  })
})
