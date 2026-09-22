import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DispatcherTask } from '@/lib/dispatcher-types'
import { useDispatcherTaskUiState } from '@/lib/use-dispatcher-task-ui-state'

describe('dispatcher task UI state', () => {
  it('restores only the hidden task opened from the next-action hint', () => {
    const first = { key: 'task-1' } as DispatcherTask
    const second = { key: 'task-2' } as DispatcherTask
    const { result } = renderHook(() => useDispatcherTaskUiState())

    act(() => result.current.dismissRepeatedJointTasks([first, second]))
    expect(result.current.dismissedRepeatedJointTaskKeys).toEqual(new Set(['task-1', 'task-2']))

    act(() => result.current.restoreDismissedRepeatedJointTask(first))
    expect(result.current.dismissedRepeatedJointTaskKeys).toEqual(new Set(['task-2']))
  })

  it('collapses every opened task description in one action', () => {
    const first = { key: 'task-1' } as DispatcherTask
    const second = { key: 'task-2' } as DispatcherTask
    const { result } = renderHook(() => useDispatcherTaskUiState())

    act(() => result.current.toggleRepeatedJointTaskDetails(first))
    act(() => result.current.toggleRepeatedJointTaskDetails(second))
    expect(result.current.isRepeatedJointTaskExpanded(first)).toBe(true)
    expect(result.current.isRepeatedJointTaskExpanded(second)).toBe(true)

    act(() => result.current.resetExpandedRepeatedJointTasks())
    expect(result.current.isRepeatedJointTaskExpanded(first)).toBe(false)
    expect(result.current.isRepeatedJointTaskExpanded(second)).toBe(false)
  })
})
