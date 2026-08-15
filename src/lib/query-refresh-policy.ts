export const QUERY_WINDOW_FOCUS_REFRESH_AGE_MS = 10 * 60_000
export const WELD_PAGE_ACTIVATION_REFRESH_AGE_MS = 60_000

export function shouldRefetchQueryOnWindowFocus(
  dataUpdatedAt: number,
  errorUpdatedAt = 0,
  now = Date.now(),
) {
  return now - Math.max(dataUpdatedAt, errorUpdatedAt) >= QUERY_WINDOW_FOCUS_REFRESH_AGE_MS
}

export function shouldRetryQuery(failureCount: number) {
  return failureCount < 1
}

export function shouldRefreshWeldPageOnActivation(
  dataUpdatedAt: number,
  refreshRequired: boolean,
  now = Date.now(),
) {
  return refreshRequired || now - dataUpdatedAt >= WELD_PAGE_ACTIVATION_REFRESH_AGE_MS
}
