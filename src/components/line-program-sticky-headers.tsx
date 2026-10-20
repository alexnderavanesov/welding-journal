import { useEffect, type RefObject } from 'react'

type Entry = { grid: HTMLElement; header: HTMLElement; viewport: HTMLElement; area: HTMLElement }
type Pinned = { element: HTMLElement; spacer: HTMLElement }

/** Page-scroll adapter for AG Grid 36. The real controls stay in their original
 * React/grid tree. Fixed positioning avoids a scroll-frame translate chase;
 * spacers preserve layout and clipping preserves horizontal column alignment.
 * Program grids use suppressRowTransform so nested detail rows do not create
 * containing blocks for fixed controls. No cloned headers or duplicate inputs.
 */
export function useProgramStickyHeaders(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = root.current
    if (!page) return
    const context = document.createElement('div')
    context.className = 'program-sticky-context'; context.hidden = true
    // A sibling survives header handoffs and cannot be clipped by the
    // context title's text overflow (notably in Safari).
    const frameEdge = document.createElement('div')
    frameEdge.className = 'program-sticky-frame'; frameEdge.hidden = true
    frameEdge.setAttribute('aria-hidden', 'true')
    page.append(context, frameEdge)
    let frame = 0, dirty = true
    let entries: Entry[] = [], active: Entry | null = null, pinned: Pinned[] = []
    const reset = () => {
      for (const { element, spacer } of pinned) {
        element.classList.remove('program-stuck-control')
        for (const name of ['top', 'left', 'width', 'clip-left', 'clip-right', 'scroll-left', 'scroll-right']) element.style.removeProperty(`--program-sticky-${name}`)
        spacer.remove()
      }
      pinned = []; active = null; if (!context.hidden) context.hidden = true
    }
    const pin = (element: HTMLElement) => {
      const spacer = document.createElement('div')
      spacer.className = 'program-sticky-spacer'; spacer.setAttribute('aria-hidden', 'true')
      spacer.style.height = `${element.getBoundingClientRect().height}px`
      element.before(spacer)
      element.classList.add('program-stuck-control')
      pinned.push({ element, spacer })
    }
    const naturalTop = (element: HTMLElement) => (pinned.find(item => item.element === element)?.spacer ?? element).getBoundingClientRect().top
    const resize = new ResizeObserver(() => schedule())
    const update = () => {
      frame = 0
      if (active && (!active.header.isConnected || !active.grid.getClientRects().length || active.grid.closest('[hidden]'))) reset()
      if (dirty) {
        resize.disconnect(); resize.observe(page)
        const previous = new Map(entries.map(entry => [entry.grid, entry]))
        entries = [...page.querySelectorAll<HTMLElement>('[data-program-grid]:not([data-program-grid="assignments"])')].flatMap(grid => {
          if (grid.closest('[hidden]')) return []
          const header = grid.querySelector<HTMLElement>('.ag-grid-pinned-top-rows')
          const viewport = grid.querySelector<HTMLElement>('.ag-grid-viewport')
          const area = grid.querySelector<HTMLElement>('.ag-grid-scrollable-area')
          if (!header || header.closest('[data-program-grid]') !== grid || !viewport || !area) return []
          for (const element of [grid, header, viewport, area]) resize.observe(element)
          const old = previous.get(grid)
          const entry = old?.header === header ? old : { grid, header, viewport, area }
          return [entry]
        })
        dirty = false
      }
      const contextHeight = 36
      // Read each visible table once, not its rows. A child only replaces its
      // parent when its actual columns reach the pinned position. Expanded
      // headings, loading content and detail padding must never hide both.
      const measured = entries.flatMap(entry => {
        if (!entry.grid.getClientRects().length || entry.grid.closest('[hidden]')) return []
        const bounds = entry.grid.getBoundingClientRect()
        const overview = entry.grid.dataset.programGrid === 'lines'
        const top = overview ? 0 : contextHeight
        const height = entry.header.offsetHeight
        return [{ entry, bounds, overview, top, height, headerBottom: top + height, naturalTop: naturalTop(entry.header) }]
      })
      let selected: (typeof measured)[number] | null = null
      for (const candidate of measured) {
        const { entry, bounds, top, headerBottom } = candidate
        if (candidate.naturalTop > top || bounds.bottom <= headerBottom) continue
        if (!selected || selected.entry.grid.contains(entry.grid) || bounds.top > selected.bounds.top) selected = candidate
      }
      const chosen = selected?.entry ?? null
      if (!chosen) { reset(); frameEdge.hidden = true; return }
      if (active !== chosen) {
        reset(); active = chosen
        pin(chosen.header)
      }
      const viewport = chosen.viewport.getBoundingClientRect(), grid = chosen.grid.getBoundingClientRect()
      const overview = chosen.grid.dataset.programGrid === 'lines'
      if (context.hidden !== overview) context.hidden = overview
      const text = chosen.grid.dataset.programGridContext ?? ''
      if (context.textContent !== text) context.textContent = text
      const contextLeft = `${Math.max(0, viewport.left)}px`, contextWidth = `${Math.max(0, Math.min(window.innerWidth, viewport.right) - Math.max(0, viewport.left))}px`
      if (context.style.left !== contextLeft) context.style.left = contextLeft
      if (context.style.width !== contextWidth) context.style.width = contextWidth
      const frameBounds = measured.find(item => item.overview)?.bounds ?? viewport
      const frameLeft = `${Math.max(0, frameBounds.left)}px`
      const frameWidth = `${Math.max(0, Math.min(window.innerWidth, frameBounds.right) - Math.max(0, frameBounds.left))}px`
      if (frameEdge.style.left !== frameLeft) frameEdge.style.left = frameLeft
      if (frameEdge.style.width !== frameWidth) frameEdge.style.width = frameWidth
      if (frameEdge.hidden) frameEdge.hidden = false
      let y = overview ? 0 : contextHeight
      for (const { element, spacer } of pinned) {
        const header = element === chosen.header
        const left = header ? viewport.left + chosen.viewport.clientLeft - chosen.viewport.scrollLeft : grid.left
        const width = header ? chosen.area.getBoundingClientRect().width : grid.width
        const visibleLeft = Math.max(0, header ? viewport.left : grid.left)
        const visibleRight = Math.min(window.innerWidth, header ? viewport.left + chosen.viewport.clientWidth : grid.right)
        const values = { top: y, left, width, 'clip-left': Math.max(0, visibleLeft - left), 'clip-right': Math.max(0, left + width - visibleRight),
          // Sticky column sections inside a fixed header use the window as
          // their scrollport. Correct only the visible edge, including a header
          // that extends past the window while horizontally scrolled.
          'scroll-left': viewport.left + chosen.viewport.clientLeft - Math.max(0, left),
          'scroll-right': viewport.left + chosen.viewport.clientWidth - Math.min(window.innerWidth, left + width) }
        for (const [name, value] of Object.entries(values)) {
          const property = `--program-sticky-${name}`, next = `${value}px`
          if (element.style.getPropertyValue(property) !== next) element.style.setProperty(property, next)
        }
        const height = element.getBoundingClientRect().height
        if (spacer.style.height !== `${height}px`) spacer.style.height = `${height}px`
        y += height
      }
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update) }
    const inventorySelector = '[data-program-grid], [data-testid="line-calculation"], .ag-grid-pinned-top-rows, .ag-grid-viewport, .ag-grid-scrollable-area'
    const mutations = new MutationObserver(records => {
      // Virtual rows/cells constantly enter and leave the DOM while scrolling.
      // They don't change which tables own the fixed header.
      const structureChanged = records.some(record => record.target !== context && record.target !== frameEdge && (record.type === 'attributes' && record.attributeName === 'hidden'
        || record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(inventorySelector) || node.querySelector(inventorySelector)))))
      if (structureChanged) { dirty = true; schedule() }
      else if (records.some(record => record.attributeName === 'data-program-grid-context')) schedule()
    })
    mutations.observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-program-grid-context'] })
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule)
    schedule()
    return () => { cancelAnimationFrame(frame); reset(); context.remove(); frameEdge.remove(); resize.disconnect(); mutations.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule) }
  }, [root])
}
