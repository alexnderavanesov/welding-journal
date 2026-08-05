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
