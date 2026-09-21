export const REPORT_RIGHT_EDGE_GUTTER_PX = 24

export function getReportViewportWidth(stickyLeft: number) {
  return `calc(100vw - ${stickyLeft + REPORT_RIGHT_EDGE_GUTTER_PX}px)`
}
