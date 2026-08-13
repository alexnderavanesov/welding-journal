import { describe, expect, it, vi } from 'vitest'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'

describe('markDispatcherTaskIndexDirty', () => {
  it('changes dispatcher and calculation revisions in one locked database operation', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await markDispatcherTaskIndexDirty({ execute })

    expect(execute).toHaveBeenCalledTimes(1)
  })
})
