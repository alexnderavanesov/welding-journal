import { StrictMode, useLayoutEffect, useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi, ICellRendererParams, IRowNode } from 'ag-grid-community'
import { useProgramDetailMotion } from './line-program-detail-motion'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('resumes a detail after layout-effect replay and retains its live closing handler', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [{}] as unknown as DOMRectList)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { height: this.style.height ? parseFloat(this.style.height) : 200 } as DOMRect
  })
  const master = { data: { id: 1 }, expanded: false, setExpanded: vi.fn((open: boolean) => { master.expanded = open }) }
  const api = { isDestroyed: () => false, forEachNode: (callback: (node: IRowNode) => void) => callback(master as unknown as IRowNode) } as unknown as GridApi
  const params = { node: { id: 'detail_1', parent: master }, api } as unknown as ICellRendererParams
  function Content() { return <div>Retained detail</div> }
  function Harness({ mounted, expanded }: { mounted: boolean; expanded: boolean }) {
    const current = useRef({ detailRenderer: Content, isExpanded: () => expanded })
    current.current.isExpanded = () => expanded
    const motion = useProgramDetailMotion(current)
    useLayoutEffect(() => motion.synchronize(api), [expanded, motion.synchronize])
    const Detail = motion.renderer
    return <>{mounted ? <Detail {...params} /> : null}{motion.portals}</>
  }
  const view = render(<StrictMode><Harness mounted={false} expanded /></StrictMode>)
  // AG mounts the detail after setExpanded. StrictMode replays its layout
  // setup/cleanup with the same DOM, just like refreshing this local component.
  view.rerender(<StrictMode><Harness mounted expanded /></StrictMode>)
  const shell = view.container.querySelector<HTMLElement>('.program-detail-motion')!
  expect(shell.dataset.programMotion).toBe('opening')
  await act(() => vi.advanceTimersByTimeAsync(32))
  expect(shell.style.transition).toContain('height 200ms')
  await act(() => vi.advanceTimersByTimeAsync(260))
  expect(shell.dataset.programMotion).toBeUndefined()
  expect(shell.style.height).toBe('')
  view.rerender(<StrictMode><Harness mounted expanded={false} /></StrictMode>)
  expect(shell.dataset.programMotion).toBe('closing')
  expect(master.expanded).toBe(true)
  await act(() => vi.advanceTimersByTimeAsync(280))
  expect(master.expanded).toBe(false)
  expect(shell.dataset.programMotion).toBeUndefined()
  // AG's retained closed row can replay its effects without replacing its DOM.
  // It must not register as open while the shell is still inert and 1px high.
  params.api = { ...api }
  view.rerender(<StrictMode><Harness mounted expanded={false} /></StrictMode>)
  expect(shell.style.height).toBe('1px')
  view.rerender(<StrictMode><Harness mounted expanded /></StrictMode>)
  expect(shell.dataset.programMotion).toBe('opening')
  await act(() => vi.advanceTimersByTimeAsync(280))
  expect(master.expanded).toBe(true)
  expect(shell.style.height).toBe('')
  expect(shell.inert).toBe(false)
})


it('keeps nested content alive through cached row moves, then disposes real evictions', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const starts = vi.fn(), stops = vi.fn()
  function Content({ data }: ICellRendererParams) {
    useLayoutEffect(() => { starts(data.id); return () => { stops(data.id) } }, [])
    return <div data-testid={`content-${data.id}`}>Retained {data.id}</div>
  }
  const api = { isDestroyed: () => false } as unknown as GridApi
  const params = [1, 2].map(id => ({ data: { id }, api, node: { id: `detail_${id}`, parent: { data: { id }, expanded: true } } }) as ICellRendererParams)
  function Harness({ order }: { order: number[] }) {
    const current = useRef({ detailRenderer: Content, isExpanded: () => true })
    const motion = useProgramDetailMotion(current), Host = motion.renderer
    return <><div>{order.map(index => <Host key={index} {...params[index]} />)}</div>{motion.portals}</>
  }
  const view = render(<StrictMode><Harness order={[0, 1]} /></StrictMode>)
  const retained = view.getByTestId('content-1'), initialStarts = starts.mock.calls.length, initialStops = stops.mock.calls.length
  // AG puts cached rows after live rows, then returns them on reopening.
  // React 19 replays refs/effects on those existing keyed moves in StrictMode.
  for (let index = 0; index < 20; index++) {
    view.rerender(<StrictMode><Harness order={index % 2 ? [0, 1] : [1, 0]} /></StrictMode>)
  }
  await act(async () => {})
  expect(view.getByTestId('content-1')).toBe(retained)
  expect(starts).toHaveBeenCalledTimes(initialStarts)
  expect(stops).toHaveBeenCalledTimes(initialStops)
  view.rerender(<StrictMode><Harness order={[1]} /></StrictMode>)
  await act(async () => {})
  expect(retained.isConnected).toBe(false)
  expect(stops).toHaveBeenCalledTimes(initialStops + 1)
  expect(stops).toHaveBeenLastCalledWith(1)
  expect(view.getByTestId('content-2')).toBeInTheDocument()
  view.unmount()
  await act(async () => {})
  expect(stops).toHaveBeenCalledTimes(initialStops + 2)
})

it('refreshes retained data and does not remove a replacement host from an older cleanup', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const mounts = vi.fn()
  function Content({ data }: ICellRendererParams) {
    useLayoutEffect(() => { mounts() }, [])
    return <div data-testid="detail-data">{data.label}</div>
  }
  const api = { isDestroyed: () => false } as unknown as GridApi
  const node = { id: 'detail_1', parent: { data: { id: 1 }, expanded: true } } as IRowNode
  function Harness({ data, version = 0 }: { data: { label: string }; version?: number }) {
    const current = useRef({ detailRenderer: Content, isExpanded: () => true })
    const motion = useProgramDetailMotion(current), Host = motion.renderer
    return <><Host key={version} {...{ data, node, api } as ICellRendererParams} />{motion.portals}</>
  }
  const view = render(<Harness data={{ label: 'Initial' }} />)
  const content = view.getByTestId('detail-data')
  view.rerender(<Harness data={{ label: 'Updated' }} />)
  expect(view.getByTestId('detail-data')).toBe(content)
  expect(content).toHaveTextContent('Updated')
  expect(mounts).toHaveBeenCalledTimes(1)
  view.rerender(<Harness data={{ label: 'Replacement' }} version={1} />)
  await act(async () => {})
  expect(content.isConnected).toBe(false)
  expect(view.getByTestId('detail-data')).toHaveTextContent('Replacement')
  expect(mounts).toHaveBeenCalledTimes(2)
})
