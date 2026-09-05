import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setContextActionMenuOpen } from '@/lib/context-action-menu-state'
import { useWorkflowRootCauseEscapeKey } from '@/lib/use-workflow-root-cause-escape-key'

describe('useWorkflowRootCauseEscapeKey', () => {
  afterEach(() => {
    setContextActionMenuOpen(false)
    document.querySelectorAll('[data-confirm-action-dialog="true"]').forEach((node) => node.remove())
  })

  it('returns from the active correction on Escape', () => {
    const onReturn = vi.fn()
    renderHook(() => useWorkflowRootCauseEscapeKey({ active: true, onReturn }))

    pressEscape()

    expect(onReturn).toHaveBeenCalledOnce()
  })

  it('leaves Escape for a confirmation dialog above the correction', () => {
    const marker = document.createElement('div')
    marker.dataset.confirmActionDialog = 'true'
    document.body.append(marker)
    const onReturn = vi.fn()
    renderHook(() => useWorkflowRootCauseEscapeKey({ active: true, onReturn }))

    pressEscape()

    expect(onReturn).not.toHaveBeenCalled()
  })

  it('leaves the first Escape for a correction context menu', () => {
    setContextActionMenuOpen(true)
    const onReturn = vi.fn()
    renderHook(() => useWorkflowRootCauseEscapeKey({ active: true, onReturn }))

    pressEscape()

    expect(onReturn).not.toHaveBeenCalled()
  })
})

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))
  })
}
