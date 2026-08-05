import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LargeDialogShell } from '@/components/large-dialog-shell'

describe('LargeDialogShell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  })

  it('restores the horizontal and vertical report position after closing', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      frames.delete(frameId)
    })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(860)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1240)

    const view = render(
      <LargeDialogShell>
        <div>Диалог</div>
      </LargeDialogShell>,
    )

    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')

    view.unmount()
    expect(scrollTo).not.toHaveBeenCalled()

    act(() => {
      runNextFrame(frames)
      runNextFrame(frames)
    })

    expect(scrollTo).toHaveBeenCalledWith({
      left: 860,
      top: 1240,
      behavior: 'auto',
    })
  })

  it('uses the report position captured before the dialog opened', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      frames.delete(frameId)
    })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0)

    const view = render(
      <LargeDialogShell returnPageScrollPosition={{ left: 9460, top: 720 }}>
        <div>Редактирование стыка</div>
      </LargeDialogShell>,
    )

    view.unmount()
    act(() => {
      runNextFrame(frames)
      runNextFrame(frames)
    })

    expect(scrollTo).toHaveBeenCalledWith({
      left: 9460,
      top: 720,
      behavior: 'auto',
    })
  })
})

function runNextFrame(frames: Map<number, FrameRequestCallback>) {
  const nextFrame = frames.entries().next().value as [number, FrameRequestCallback] | undefined
  if (!nextFrame) throw new Error('Ожидался запланированный кадр')
  frames.delete(nextFrame[0])
  nextFrame[1](performance.now())
}
