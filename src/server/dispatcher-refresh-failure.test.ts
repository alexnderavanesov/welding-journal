import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ execute: mocks.execute }) }))
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'

describe('coalesced dispatcher refresh failures', () => {
  it('reports an actual failure once, rejects all waiters, and permits an explicit retry', async () => {
    const error = new Error('database unavailable')
    mocks.execute.mockRejectedValue(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const results = await Promise.allSettled([ensureDispatcherTaskIndexFresh(), ensureDispatcherTaskIndexFresh()])
      expect(results).toEqual([{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }])
      expect(mocks.execute).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledExactlyOnceWith('Не удалось выполнить пересчет индекса диспетчера.', error)
      await expect(ensureDispatcherTaskIndexFresh()).rejects.toBe(error)
      expect(mocks.execute).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledTimes(2)
    } finally { log.mockRestore() }
  })
})
