export type PageScrollPosition = {
  left: number
  top: number
}

export function getPageScrollPosition(): PageScrollPosition {
  const scrollingElement = document.scrollingElement
  return {
    left: Math.max(
      window.scrollX,
      scrollingElement?.scrollLeft ?? 0,
      document.documentElement.scrollLeft,
      document.body.scrollLeft,
    ),
    top: Math.max(
      window.scrollY,
      scrollingElement?.scrollTop ?? 0,
      document.documentElement.scrollTop,
      document.body.scrollTop,
    ),
  }
}

export function resetPageScrollPosition() {
  const scrollingElement = document.scrollingElement

  if (scrollingElement) scrollingElement.scrollLeft = 0
  document.documentElement.scrollLeft = 0
  document.body.scrollLeft = 0
  window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
}
