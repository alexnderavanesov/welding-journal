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

export function restorePageScrollPosition(position: PageScrollPosition) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const scrollingElement = document.scrollingElement
      if (scrollingElement) {
        scrollingElement.scrollLeft = position.left
        scrollingElement.scrollTop = position.top
      }
      document.documentElement.scrollLeft = position.left
      document.documentElement.scrollTop = position.top
      document.body.scrollLeft = position.left
      document.body.scrollTop = position.top
      window.scrollTo({ left: position.left, top: position.top, behavior: 'auto' })
    })
  })
}
