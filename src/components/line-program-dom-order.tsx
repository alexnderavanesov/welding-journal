import { useLayoutEffect, type RefObject } from 'react'

/** AG's React row order moves every following row when a cached detail returns.
 * React 19 StrictMode then replays all their refs (including cell measurements).
 * Keep those React siblings stable; order the existing DOM nodes for reading and
 * Tab navigation instead. No clones, replacement nodes or grid-internal APIs.
 */
export function orderProgramGridDom(root: HTMLElement) {
  const groups = new Map<HTMLElement, HTMLElement[]>()
  for (const element of root.querySelectorAll<HTMLElement>('.ag-row[row-index], .ag-cell[aria-colindex], .ag-header-cell[aria-colindex]')) {
    if (element.closest('[data-program-grid]') !== root || !element.parentElement) continue
    const siblings = groups.get(element.parentElement) ?? []
    siblings.push(element); groups.set(element.parentElement, siblings)
  }
  const focus = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null
  let moved = false
  for (const [parent, elements] of groups) {
    const index = (element: HTMLElement) => Number(element.getAttribute(element.classList.contains('ag-row') ? 'row-index' : 'aria-colindex'))
    const ordered = [...elements].sort((a, b) => index(a) - index(b))
    if (ordered.every((element, i) => element === elements[i])) continue
    let anchor = elements.at(-1)!.nextElementSibling
    for (let i = ordered.length - 1; i >= 0; i--) {
      const element = ordered[i]
      if (element.nextElementSibling !== anchor) {
        // moveBefore also preserves focus/selection in supporting browsers.
        if ('moveBefore' in parent) (parent as HTMLElement & { moveBefore(node: Node, child: Node | null): void }).moveBefore(element, anchor)
        else parent.insertBefore(element, anchor)
        moved = true
      }
      anchor = element
    }
  }
  if (moved && focus?.isConnected && document.activeElement !== focus) focus.focus({ preventScroll: true })
}

export function useProgramDomOrder(root: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let frame = 0
    const update = () => { frame = 0; orderProgramGridDom(element); observer.takeRecords() }
    const observer = new MutationObserver(records => {
      // Nested grids own their order. Height/top animation does not enter this
      // observer, so there is no traversal on each disclosure/scroll frame.
      if (!frame && records.some(record => record.target instanceof Element && record.target.closest('[data-program-grid]') === element)) frame = requestAnimationFrame(update)
    })
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['row-index', 'aria-colindex'] })
    update()
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [root])
}
