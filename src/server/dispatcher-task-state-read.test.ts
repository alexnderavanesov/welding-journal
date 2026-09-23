import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readDispatcherTaskIndexState } from '@/server/dispatcher-task-index'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn(), limit: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ execute: mocks.execute, select: mocks.select }) }))

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
})
