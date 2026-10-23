export const QUERY_WINDOW_FOCUS_REFRESH_AGE_MS = 30_000

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
