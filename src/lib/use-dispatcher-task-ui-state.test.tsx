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
})
