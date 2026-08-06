import { describe, expect, it, vi } from 'vitest'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'

describe('markDispatcherTaskIndexDirty', () => {
  it('acquires the shared index lock before changing revisions and cache', async () => {
    let releaseLock: (() => void) | undefined
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const execute = vi
      .fn()
      .mockImplementationOnce(() => lock)
      .mockResolvedValue(undefined)

    const pending = markDispatcherTaskIndexDirty({ execute })

    await Promise.resolve()
    expect(execute).toHaveBeenCalledTimes(1)

    releaseLock?.()
    await pending

    expect(execute).toHaveBeenCalledTimes(4)
  })
})
