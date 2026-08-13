import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export const QUERY_WINDOW_FOCUS_REFRESH_AGE_MS = 10 * 60_000

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

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: (query) => shouldRefetchQueryOnWindowFocus(
          query.state.dataUpdatedAt,
          query.state.errorUpdatedAt,
        ),
        refetchOnReconnect: (query) => shouldRefetchQueryOnWindowFocus(query.state.dataUpdatedAt),
        retry: shouldRetryQuery,
      },
    },
  })

  return createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
