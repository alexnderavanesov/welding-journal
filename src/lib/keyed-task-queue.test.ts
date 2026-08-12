import { describe, expect, it } from 'vitest'
import { createKeyedTaskQueue } from '@/lib/keyed-task-queue'

describe('createKeyedTaskQueue', () => {
  it('runs tasks for the same key in order', async () => {
    const queue = createKeyedTaskQueue<string>()
    const events: string[] = []
    let releaseFirst: (() => void) | undefined

    const first = queue.enqueue('settings', async () => {
      events.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      events.push('first:end')
    })
    const second = queue.enqueue('settings', async () => {
      events.push('second')
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['first:start'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second'])
  })

  it('continues the queue after a failed task', async () => {
    const queue = createKeyedTaskQueue<string>()
    const events: string[] = []

    const failed = queue.enqueue('settings', async () => {
      throw new Error('conflict')
    })
    const next = queue.enqueue('settings', async () => {
      events.push('next')
    })

    await expect(failed).rejects.toThrow('conflict')
    await expect(next).resolves.toBeUndefined()
    expect(events).toEqual(['next'])
  })

  it('does not block tasks for different keys', async () => {
    const queue = createKeyedTaskQueue<string>()
    let releaseFirst: (() => void) | undefined
    const events: string[] = []

    const first = queue.enqueue('first', () => new Promise<void>((resolve) => {
      releaseFirst = resolve
    }))
    const second = queue.enqueue('second', async () => {
      events.push('second')
    })

    await second
    expect(events).toEqual(['second'])
    releaseFirst?.()
    await first
  })
})
