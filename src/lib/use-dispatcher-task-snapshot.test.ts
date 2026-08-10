import { describe, expect, it } from 'vitest'
import { filterDismissedDispatcherTasks } from '@/lib/use-dispatcher-task-snapshot'

describe('dispatcher task snapshot visibility', () => {
  it('hides cards locally without changing the complete server task snapshot', () => {
    const snapshotTasks = [
      { key: 'task-visible', code: 'ДЗ-01' },
      { key: 'task-hidden', code: 'ДЗ-18' },
    ]

    expect(filterDismissedDispatcherTasks(snapshotTasks, new Set(['task-hidden']))).toEqual([
      { key: 'task-visible', code: 'ДЗ-01' },
    ])
    expect(snapshotTasks).toEqual([
      { key: 'task-visible', code: 'ДЗ-01' },
      { key: 'task-hidden', code: 'ДЗ-18' },
    ])
  })
})
