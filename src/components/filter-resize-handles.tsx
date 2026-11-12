import { useEffect, useRef, type RefObject, type PointerEvent, type KeyboardEvent } from 'react'
import './filter-popup-resize.css'

type Edge = 'right' | 'bottom' | 'corner'

/** Resize only the popup DOM, without changing filter state or rendering its grid. */
export function FilterResizeHandles({ panel }: { panel: RefObject<HTMLDivElement | null> }) {
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const prepare = () => {
    const content = panel.current!
    const popup = content.closest<HTMLElement>('.ag-filter-menu, [data-filter-popup]') ?? content
    const rect = popup.getBoundingClientRect()
    const left = popup.offsetLeft, top = popup.offsetTop
    popup.style.width = `${rect.width}px`; popup.style.height = `${rect.height}px`
    popup.style.right = 'auto'; popup.style.bottom = 'auto'
    popup.style.left = `${left}px`; popup.style.top = `${top}px`
    popup.style.maxWidth = 'calc(100vw - 24px)'; popup.style.maxHeight = 'calc(100dvh - 24px)'
    popup.dataset.filterResized = 'true'
    return (dx: number, dy: number) => {
      const width = Math.max(Math.min(240, rect.width), Math.min(window.innerWidth - 24, rect.width + dx))
      const height = Math.max(Math.min(160, rect.height), Math.min(window.innerHeight - 24, rect.height + dy))
      popup.style.width = `${width}px`; popup.style.height = `${height}px`
      popup.style.left = `${left + Math.max(12 - rect.left, Math.min(0, window.innerWidth - 12 - rect.left - width))}px`
      popup.style.top = `${top + Math.max(12 - rect.top, Math.min(0, window.innerHeight - 12 - rect.top - height))}px`
    }
  }
  const start = (event: PointerEvent<HTMLDivElement>, edge: Edge) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); cleanup.current?.()
    const handle = event.currentTarget, pointer = event.pointerId, x = event.clientX, y = event.clientY
    const resize = prepare()
    let frame = 0, dx = 0, dy = 0
    const draw = () => { frame = 0; resize(dx, dy) }
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointer) return
      dx = edge === 'bottom' ? 0 : next.clientX - x
      dy = edge === 'right' ? 0 : next.clientY - y
      if (!frame) frame = requestAnimationFrame(draw)
    }
    const finish = () => {
      if (frame) { cancelAnimationFrame(frame); draw() }
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      handle.removeEventListener('lostpointercapture', finish)
      handle.removeAttribute('data-resizing')
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer)
      cleanup.current = null
    }
    cleanup.current = finish
    handle.dataset.resizing = 'true'
    handle.setPointerCapture(pointer)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
    handle.addEventListener('lostpointercapture', finish)
  }
  const key = (event: KeyboardEvent<HTMLDivElement>, edge: Edge) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const step = event.shiftKey ? 40 : 10
    prepare()(edge === 'bottom' ? 0 : event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
      edge === 'right' ? 0 : event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
  }
  return <>{(['right', 'bottom', 'corner'] as const).map(edge => <div key={edge} role="button" tabIndex={edge === 'corner' ? 0 : -1}
    aria-label={edge === 'right' ? 'Изменить ширину фильтра' : edge === 'bottom' ? 'Изменить высоту фильтра' : 'Изменить размер фильтра'}
    title="Потяните край или угол, чтобы изменить размер" className={`filter-resize-handle filter-resize-${edge}`}
    onPointerDown={event => start(event, edge)} onKeyDown={event => key(event, edge)} />)}</>
}
