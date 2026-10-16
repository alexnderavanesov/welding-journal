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

    expect(document.body.style.overflow).toBe('')
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

  it('keeps wide body overflow intact and restores root styles only after the last nested dialog closes', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    document.body.style.overflow = 'visible'
    document.documentElement.style.setProperty('overflow-x', 'auto', 'important')
    document.documentElement.style.setProperty('overflow-y', 'scroll')
    const parent = render(<LargeDialogShell><div>Результат</div></LargeDialogShell>)
    const child = render(<LargeDialogShell><div>Документ</div></LargeDialogShell>)

    // Clipping body would collapse the viewport's horizontal range and remove
    // the source cell from the report's horizontal virtual window.
    expect(document.body.style.overflow).toBe('visible')
    expect(document.documentElement.style.overflow).toBe('hidden')
    child.unmount()
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('visible')

    parent.unmount()
    expect(document.body.style.overflow).toBe('visible')
    expect(document.documentElement.style.overflowX).toBe('auto')
    expect(document.documentElement.style.getPropertyPriority('overflow-x')).toBe('important')
    expect(document.documentElement.style.overflowY).toBe('scroll')
  })

  it('marks the panel as the active modal layer', () => {
    render(
      <LargeDialogShell>
        <div>Диалог</div>
      </LargeDialogShell>,
    )

    const dialog = document.querySelector('[data-modal-dialog="true"]')
    expect(dialog).toHaveAttribute('role', 'dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('renders the fixed layer in the document root instead of a report container', () => {
    const reportContainer = document.createElement('div')
    reportContainer.style.transform = 'translateX(10px)'
    document.body.appendChild(reportContainer)

    const view = render(
      <LargeDialogShell>
        <div>Диалог поверх отчета</div>
      </LargeDialogShell>,
      { container: reportContainer },
    )

    expect(reportContainer.querySelector('[data-modal-dialog="true"]')).toBeNull()
    expect(document.body.querySelector('[data-modal-dialog="true"]')).toBeInTheDocument()

    view.unmount()
    reportContainer.remove()
  })
})

function runNextFrame(frames: Map<number, FrameRequestCallback>) {
  const nextFrame = frames.entries().next().value as [number, FrameRequestCallback] | undefined
  if (!nextFrame) throw new Error('Ожидался запланированный кадр')
  frames.delete(nextFrame[0])
  nextFrame[1](performance.now())
}
