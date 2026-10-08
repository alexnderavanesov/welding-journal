import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WELD_FIELDS } from './weld-fields'
import type { WeldTableDisplaySection } from './weld-table-sections'
import { useWindowTableHorizontalVirtualization } from './use-window-table-horizontal-virtualization'

afterEach(() => vi.restoreAllMocks())

function setup() {
  let left = 0
  const table = document.createElement('table')
  const rect = vi.spyOn(table, 'getBoundingClientRect').mockImplementation(() => ({ left } as DOMRect))
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextId, callback); return nextId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const options = { tableRef: { current: table }, sections: [{ section: 'Все', fields: WELD_FIELDS.slice(0, 65), collapsed: false }] as WeldTableDisplaySection[], extraColumns: [], leadingWidth: 52 }
  const hook = renderHook(props => useWindowTableHorizontalVirtualization(props), { initialProps: options })
  const flush = () => act(() => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(0))
  })
  return { ...hook, options, frames, rect, flush, scroll: (x: number) => {
    left = -x
    act(() => document.dispatchEvent(new Event('scroll')))
    flush()
  } }
}

it('keeps one buffered column set during small forward/backward movements', () => {
  const { result, scroll } = setup()
  const first = result.current.visibleFieldKeys
  for (const offset of [10, 100, 250, 400, 250, 0]) {
    scroll(offset)
    expect(result.current.visibleFieldKeys).toBe(first)
  }
  scroll(1000)
  expect(result.current.visibleFieldKeys).not.toBe(first)
  expect(result.current.visibleFieldKeys.has('line')).toBe(true)
  expect(result.current.visibleFieldKeys.has('joint')).toBe(true)
})

it('ignores unrelated inner-list scrolling and cancels work when unmounted', () => {
  const { frames, flush, rect, unmount } = setup()
  const list = document.createElement('div')
  document.body.append(list)
  rect.mockClear()
  list.dispatchEvent(new Event('scroll'))
  flush()
  expect(rect).not.toHaveBeenCalled()
  document.dispatchEvent(new Event('scroll'))
  expect(frames.size).toBe(1)
  unmount()
  expect(frames.size).toBe(0)
  list.remove()
})

it('refreshes columns after a large jump, resize, changed sections and disabled virtualization', () => {
  const { result, scroll, rerender, options, flush } = setup()
  const first = result.current.visibleFieldKeys
  scroll(5000)
  const far = result.current.visibleFieldKeys
  expect(far).not.toEqual(first)
  scroll(0)
  expect(result.current.visibleFieldKeys).toEqual(first)
  window.dispatchEvent(new Event('resize'))
  flush()
  expect(result.current.visibleFieldKeys).toEqual(first)
  const short = [{ ...options.sections[0], fields: WELD_FIELDS.slice(0, 4) }]
  rerender({ ...options, sections: short })
  expect(result.current.enabled).toBe(false)
  expect([...result.current.visibleFieldKeys]).toEqual(short[0].fields.map(field => field.key))
  rerender(options)
  expect(result.current.enabled).toBe(true)
  expect(result.current.visibleFieldKeys.size).toBeLessThan(options.sections[0].fields.length)
})
