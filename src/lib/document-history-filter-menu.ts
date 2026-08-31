const DOCUMENT_HISTORY_FILTER_MENU_WIDTH = 288
const DOCUMENT_HISTORY_FILTER_MENU_PREFERRED_HEIGHT = 420
const DOCUMENT_HISTORY_FILTER_MENU_GAP = 6
const DOCUMENT_HISTORY_FILTER_MENU_VIEWPORT_GUTTER = 12

export type DocumentHistoryFilterMenuPosition = {
  left: number
  width: number
  maxHeight: number
  placement: 'above' | 'below'
  offset: number
}

export function getDocumentHistoryFilterMenuPosition({
  anchorLeft,
  anchorRight,
  anchorTop,
  anchorBottom,
  viewportWidth,
  viewportHeight,
  alignRight = false,
}: {
  anchorLeft: number
  anchorRight: number
  anchorTop: number
  anchorBottom: number
  viewportWidth: number
  viewportHeight: number
  alignRight?: boolean
}): DocumentHistoryFilterMenuPosition {
  const availableWidth = Math.max(0, viewportWidth - DOCUMENT_HISTORY_FILTER_MENU_VIEWPORT_GUTTER * 2)
  const width = Math.min(DOCUMENT_HISTORY_FILTER_MENU_WIDTH, availableWidth)
  const maxLeft = Math.max(
    DOCUMENT_HISTORY_FILTER_MENU_VIEWPORT_GUTTER,
    viewportWidth - width - DOCUMENT_HISTORY_FILTER_MENU_VIEWPORT_GUTTER,
  )
  const preferredLeft = alignRight ? anchorRight - width : anchorLeft
  const left = Math.min(
    Math.max(preferredLeft, DOCUMENT_HISTORY_FILTER_MENU_VIEWPORT_GUTTER),
    maxLeft,
  )
  const availableBelow = Math.max(
    0,
    viewportHeight - anchorBottom - DOCUMENT_HISTORY_FILTER_MENU_GAP - DOCUMENT_HISTORY_FILTER_MENU_VIEWPORT_GUTTER,
  )
  const availableAbove = Math.max(
    0,
    anchorTop - DOCUMENT_HISTORY_FILTER_MENU_GAP - DOCUMENT_HISTORY_FILTER_MENU_VIEWPORT_GUTTER,
  )
  const placement = availableBelow < DOCUMENT_HISTORY_FILTER_MENU_PREFERRED_HEIGHT && availableAbove > availableBelow
    ? 'above'
    : 'below'
  const availableHeight = placement === 'above' ? availableAbove : availableBelow

  return {
    left,
    width,
    maxHeight: Math.min(DOCUMENT_HISTORY_FILTER_MENU_PREFERRED_HEIGHT, availableHeight),
    placement,
    offset: placement === 'above'
      ? viewportHeight - anchorTop + DOCUMENT_HISTORY_FILTER_MENU_GAP
      : anchorBottom + DOCUMENT_HISTORY_FILTER_MENU_GAP,
  }
}
