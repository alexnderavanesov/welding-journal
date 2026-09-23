import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DISPATCHER_GROUP_BATCH_SIZE,
  DISPATCHER_CODE_BATCH_SIZE,
  DISPATCHER_OBJECT_BATCH_SIZE,
  DISPATCHER_JOINT_TASK_BATCH_SIZE,
  DISPATCHER_TASK_BATCH_SIZE,
  getNextDispatcherGroupCount,
  useIncrementalDispatcherGroups,
} from '@/lib/use-incremental-dispatcher-groups'

describe('incremental dispatcher groups', () => {
  it('loads dispatcher groups in bounded batches', () => {
    expect(getNextDispatcherGroupCount(0, 1178)).toBe(DISPATCHER_GROUP_BATCH_SIZE)
    expect(getNextDispatcherGroupCount(DISPATCHER_GROUP_BATCH_SIZE, 1178)).toBe(DISPATCHER_GROUP_BATCH_SIZE * 2)
  })

  it('never exceeds the complete group count', () => {
    expect(getNextDispatcherGroupCount(1120, 1178)).toBe(1178)
    expect(getNextDispatcherGroupCount(80, 42)).toBe(42)
  })

  it('uses the requested batch size for long task lists', () => {
    expect(getNextDispatcherGroupCount(0, 1178, DISPATCHER_TASK_BATCH_SIZE))
      .toBe(DISPATCHER_TASK_BATCH_SIZE)
    expect(getNextDispatcherGroupCount(DISPATCHER_TASK_BATCH_SIZE, 1178, DISPATCHER_TASK_BATCH_SIZE))
      .toBe(DISPATCHER_TASK_BATCH_SIZE * 2)
  })

  it('limits DZ headings to fifteen, objects to ten, and tasks to ten', () => {
    expect(getNextDispatcherGroupCount(0, 538, DISPATCHER_CODE_BATCH_SIZE)).toBe(15)
    expect(getNextDispatcherGroupCount(15, 538, DISPATCHER_CODE_BATCH_SIZE)).toBe(30)
    expect(getNextDispatcherGroupCount(0, 538, DISPATCHER_OBJECT_BATCH_SIZE)).toBe(10)
    expect(getNextDispatcherGroupCount(10, 538, DISPATCHER_JOINT_TASK_BATCH_SIZE)).toBe(20)
  })

  it('returns an expanded list to its first batch on demand', () => {
    const groups = Array.from({ length: 1_200 }, (_, index) => index)
    const { result } = renderHook(() =>
      useIncrementalDispatcherGroups(groups, DISPATCHER_TASK_BATCH_SIZE),
    )

    expect(result.current.visibleCount).toBe(DISPATCHER_TASK_BATCH_SIZE)

    act(() => result.current.loadMore())
    act(() => result.current.loadMore())
    expect(result.current.visibleCount).toBe(DISPATCHER_TASK_BATCH_SIZE * 3)
    expect(result.current.canCollapse).toBe(true)

    act(() => result.current.collapseList())
    expect(result.current.visibleCount).toBe(DISPATCHER_TASK_BATCH_SIZE)
    expect(result.current.canCollapse).toBe(false)
    expect(result.current.hasMore).toBe(true)
  })
})
