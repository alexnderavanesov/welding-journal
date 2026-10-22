import { useEffect, type RefObject } from 'react'
import type { ColumnResizedEvent, GridApi } from 'ag-grid-community'

/** A single, static paint tile behind virtual rows. No extra row/cell nodes,
 * polling, vertical-scroll handler, or work proportional to the dataset. */
export function useJournalScrollPlaceholder(
  frame: RefObject<HTMLDivElement | null>, api: GridApi | null, enabled: boolean,
  rowHeight: number, theme: string, stripes: boolean,
) {
  useEffect(() => {
    const viewport = frame.current?.querySelector<HTMLElement>('.ag-grid-viewport')
    if (!enabled || !api || !viewport) return
    let raf = 0, resizing = false, scrolling = false
    const paint = () => {
      raf = 0
      if (resizing || scrolling || api.isDestroyed()) return
      const width = viewport.clientWidth, scrollLeft = viewport.scrollLeft
      if (!width) return
      const left = api.getDisplayedLeftColumns().reduce((sum, column) => sum + column.getActualWidth(), 0)
      const right = width - api.getDisplayedRightColumns().reduce((sum, column) => sum + column.getActualWidth(), 0)
      // Column geometry is already maintained by AG. Reading every header's
      // DOM rect here forces layout between its virtual-column commits.
      const columns = api.getAllDisplayedVirtualColumns().flatMap(column => {
        const pinned = column.getPinned()
        const cellWidth = column.getActualWidth()
        const x = (column.getLeft() ?? 0) + (pinned === 'right' ? right : pinned ? 0 : left - scrollLeft)
        const min = pinned === 'right' ? right : pinned ? 0 : left
        const max = pinned === 'left' ? left : pinned ? width : right
        if (x + cellWidth <= min || x >= max || !cellWidth) return []
        return [{ x, width: cellWidth, min, max, seed: [...column.getColId()].reduce((sum, char) => sum + char.charCodeAt(0), 0) }]
      })
      const odd = !stripes ? '#fff' : theme === 'alpine' ? '#f6faf8' : theme === 'balham' ? '#f5f7fa' : '#f9fbfd'
      const shapes: string[] = []
      for (let row = 0; row < 4; row++) {
        shapes.push(`<rect y="${row * rowHeight}" width="${width}" height="${rowHeight}" fill="${row % 2 ? odd : '#fff'}"/>`)
        for (const col of columns) {
          const start = Math.max(col.min, col.x + 10)
          const end = Math.min(col.max, col.x + 10 + Math.max(0, col.width - 20) * (.45 + (col.seed + row) % 5 * .1))
          if (end > start) shapes.push(`<rect x="${start}" y="${row * rowHeight + (rowHeight - 14) / 2}" width="${end - start}" height="14" rx="4" fill="#dfe3e6"/>`)
        }
        shapes.push(`<path d="M0 ${rowHeight * (row + 1) - .5}H${width}" stroke="#edf1f5"/>`)
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${rowHeight * 4}">${shapes.join('')}</svg>`
      const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
      if (viewport.style.getPropertyValue('--journal-gap-image') !== image) viewport.style.setProperty('--journal-gap-image', image)
    }
    const schedule = () => { if (!raf && !scrolling) raf = requestAnimationFrame(paint) }
    // Keep the already decoded tile throughout a native horizontal gesture.
    // Replacing an SVG at every step can expose its white loading surface while
    // the browser is also preparing newly visible columns. Only the fallback
    // picture waits; column movement and cell rendering remain immediate.
    const horizontal = (event: { direction: string }) => { if (event.direction === 'horizontal') scrolling = true }
    // A diagonal gesture can end with a vertical event. AG emits one end event
    // for the last direction, so release the horizontal guard in either case.
    const stopped = () => { if (scrolling) { scrolling = false; schedule() } }
    // Existing rows cover the placeholder while their widths change. Avoid
    // decoding/rasterising a new SVG at every drag step (particularly in WebKit).
    const resized = (event: ColumnResizedEvent) => { resizing = event.finished === false; if (!resizing) schedule() }
    const events = ['displayedColumnsChanged', 'virtualColumnsChanged', 'gridSizeChanged'] as const
    for (const name of events) api.addEventListener(name, schedule)
    api.addEventListener('columnResized', resized)
    api.addEventListener('bodyScroll', horizontal)
    api.addEventListener('bodyScrollEnd', stopped)
    schedule()
    return () => {
      cancelAnimationFrame(raf)
      if (!api.isDestroyed()) {
        for (const name of events) api.removeEventListener(name, schedule)
        api.removeEventListener('columnResized', resized)
        api.removeEventListener('bodyScroll', horizontal)
        api.removeEventListener('bodyScrollEnd', stopped)
      }
      viewport.style.removeProperty('--journal-gap-image')
    }
  }, [api, enabled, frame, rowHeight, stripes, theme])
}
