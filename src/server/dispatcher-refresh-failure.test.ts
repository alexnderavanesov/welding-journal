import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ execute: mocks.execute }) }))
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'

describe('coalesced dispatcher refresh failures', () => {
  it('reports an actual failure once, rejects all waiters, and permits an explicit retry', async () => {
    const error = new Error('Failed query: private SQL and bind values')
    mocks.execute.mockRejectedValue(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const results = await Promise.allSettled([ensureDispatcherTaskIndexFresh(), ensureDispatcherTaskIndexFresh()])
      const publicError = expect.objectContaining({ message: 'Не удалось обновить расчёт. Повторите загрузку.', cause: error })
      expect(results).toEqual([{ status: 'rejected', reason: publicError }, { status: 'rejected', reason: publicError }])
      if (results[0].status === 'rejected' && results[1].status === 'rejected') expect(results[0].reason).toBe(results[1].reason)
      expect(mocks.execute).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledExactlyOnceWith('Не удалось выполнить пересчет индекса диспетчера.', error)
      await expect(ensureDispatcherTaskIndexFresh()).rejects.toMatchObject({ message: 'Не удалось обновить расчёт. Повторите загрузку.', cause: error })
      expect(mocks.execute).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledTimes(2)
    } finally { log.mockRestore() }
  })
})
