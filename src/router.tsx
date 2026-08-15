import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import {
  shouldRefetchQueryOnWindowFocus,
  shouldRetryQuery,
} from '@/lib/query-refresh-policy'
import { routeTree } from './routeTree.gen'

export { shouldRefetchQueryOnWindowFocus, shouldRetryQuery }

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
