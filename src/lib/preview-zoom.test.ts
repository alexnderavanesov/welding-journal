import { afterEach, expect, it, vi } from 'vitest'
import { attachPreviewZoom } from './preview-zoom'

afterEach(() => vi.restoreAllMocks())

it('leaves ordinary scrolling alone, batches modifier wheels, bounds zoom and removes listeners', () => {
  let frame: FrameRequestCallback | undefined, scale = 1
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 7 })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const change = vi.fn((next: number) => { scale = next })
  const target = document.createElement('div')
  const detach = attachPreviewZoom(target, { min: .25, max: 3, getScale: () => scale, onZoom: change })
  const wheel = (options: WheelEventInit) => {
    const event = new WheelEvent('wheel', { cancelable: true, ...options })
    target.dispatchEvent(event)
    return event
  }
  expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
  expect(change).not.toHaveBeenCalled()
  expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true)
  wheel({ deltaY: -100, metaKey: true })
  expect(change).not.toHaveBeenCalled()
  frame!(0)
  expect(scale).toBeCloseTo(1.49)
  expect(change).toHaveBeenCalledOnce()
  for (let i = 0; i < 10; i++) wheel({ deltaY: -100, ctrlKey: true, deltaMode: 1 })
  frame!(0); expect(scale).toBe(3)
  for (let i = 0; i < 10; i++) wheel({ deltaY: 1, ctrlKey: true, deltaMode: 2 })
  frame!(0); expect(scale).toBe(.25)
  wheel({ deltaY: -100, ctrlKey: true })
  detach()
  expect(cancel).toHaveBeenCalledWith(7)
  expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(false)
})

it('uses the initial native pinch scale without double-applying simultaneous wheel events', () => {
  let frame: FrameRequestCallback | undefined, scale = 1.5
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const change = vi.fn((next: number) => { scale = next })
  const target = document.createElement('div')
  const detach = attachPreviewZoom(target, { min: .25, max: 3, getScale: () => scale, onZoom: change })
  const gesture = (type: string, factor = 1) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { scale: factor, clientX: 120, clientY: 80 })
    target.dispatchEvent(event)
    return event
  }
  expect(gesture('gesturestart').defaultPrevented).toBe(true)
  gesture('gesturechange', 1.2); frame!(0); expect(scale).toBe(1.8)
  target.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true }))
  gesture('gesturechange', 1.4); frame!(0); expect(scale).toBe(2.1)
  gesture('gesturechange', Number.NaN)
  expect(change).toHaveBeenCalledTimes(2)
  expect(gesture('gestureend').defaultPrevented).toBe(true)
  gesture('gesturechange', 2)
  expect(change).toHaveBeenCalledTimes(2)
  detach()
})
