import { act, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { useReportSelectionState } from '@/lib/use-report-selection-state'
import { useWorkflowSelectionState } from '@/lib/use-workflow-selection-state'
import { WORKFLOW_SELECTION_LIMIT_MESSAGE } from '@/lib/workflow-selection-limit'

const ids = (count: number) => new Set(Array.from({ length: count }, (_, index) => index + 1))

describe('bounded workflow selection', () => {
  it('keeps no-op synchronization effects from looping or clearing a limit warning', () => {
    let effectCount = 0
    const { result } = renderHook(() => {
      const state = useWorkflowSelectionState(() => ids(5000))
      useEffect(() => {
        effectCount += 1
        if (effectCount > 10) throw new Error('selection synchronization loop')
        state[1]((current) => current)
      })
      return state
    })
    expect(effectCount).toBe(1)
    act(() => result.current[1](ids(5001)))
    expect(effectCount).toBe(2)
    expect(result.current[2]).toBe(WORKFLOW_SELECTION_LIMIT_MESSAGE)
  })
  it('accepts 5,000 and rejects the next checkbox without losing prior selection', () => {
    const { result } = renderHook(() => useWorkflowSelectionState(() => new Set<number>()))
    act(() => result.current[1](ids(5000)))
    const previous = result.current[0]
    act(() => result.current[1]((current) => new Set([...current, 5001])))
    expect(result.current[0]).toBe(previous)
    expect(result.current[2]).toBe(WORKFLOW_SELECTION_LIMIT_MESSAGE)
    act(() => result.current[1]((current) => new Set([...current].filter((id) => id !== 1))))
    expect(result.current[0].size).toBe(4999)
    expect(result.current[2]).toBeNull()
  })

  it('rejects select-all atomically and handles queued selections from different searches', () => {
    const { result } = renderHook(() => useWorkflowSelectionState(() => ids(4999)))
    act(() => {
      result.current[1]((current) => new Set([...current, 5000]))
      result.current[1]((current) => new Set([...current, 5001, 5002]))
    })
    expect(result.current[0]).toEqual(ids(5000))
    expect(result.current[2]).toBe(WORKFLOW_SELECTION_LIMIT_MESSAGE)
    act(() => result.current[3]())
    expect(result.current[0]).toEqual(ids(5000))
    expect(result.current[2]).toBeNull()
  })

  it('does not silently truncate an oversized initial selection', () => {
    const { result } = renderHook(() => useWorkflowSelectionState(() => ids(5001)))
    expect(result.current[0].size).toBe(0)
    expect(result.current[2]).toBe(WORKFLOW_SELECTION_LIMIT_MESSAGE)
  })

  it.each(['Lnk', 'HeatTreatment'] as const)('bounds %s report entry points and exposes a dismissible warning', (kind) => {
    const { result } = renderHook(() => useReportSelectionState())
    act(() => result.current[`setSelected${kind}Ids`](ids(5000)))
    act(() => result.current[`setSelected${kind}Ids`](ids(5001)))
    expect(result.current[`selected${kind}Ids`]).toEqual(ids(5000))
    expect(result.current.selectionWarning).toBe(WORKFLOW_SELECTION_LIMIT_MESSAGE)
    act(() => result.current.dismissSelectionWarning())
    expect(result.current.selectionWarning).toBeNull()
  })
})
