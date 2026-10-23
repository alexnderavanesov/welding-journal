import type { QueryClient } from '@tanstack/react-query'

// Report grids own their blocks and coalesce these notifications. Inactive
// reports have no subscriber and fetch their current data when opened.
const listeners = new WeakMap<QueryClient, Set<() => void>>()

export function subscribeWeldPageRefresh(queryClient: QueryClient, listener: () => void) {
  let subscriptions = listeners.get(queryClient)
  if (!subscriptions) { subscriptions = new Set(); listeners.set(queryClient, subscriptions) }
  subscriptions.add(listener)
  return () => { subscriptions.delete(listener) }
}

export async function invalidateWeldPageQueries(queryClient: QueryClient): Promise<void> {
  listeners.get(queryClient)?.forEach(listener => listener())
}
