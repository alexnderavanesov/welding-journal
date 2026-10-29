import type { QueryClient } from '@tanstack/react-query'

// Report grids own their blocks and coalesce these notifications. Inactive
// reports have no subscriber and fetch their current data when opened.
export type WeldPageRefresh = { reason: 'background' } | { reason: 'saved' }
const listeners = new WeakMap<QueryClient, Set<(event: WeldPageRefresh) => void>>()

export function subscribeWeldPageRefresh(queryClient: QueryClient, listener: (event: WeldPageRefresh) => void) {
  let subscriptions = listeners.get(queryClient)
  if (!subscriptions) { subscriptions = new Set(); listeners.set(queryClient, subscriptions) }
  subscriptions.add(listener)
  return () => { subscriptions.delete(listener) }
}

export async function invalidateWeldPageQueries(queryClient: QueryClient, event: WeldPageRefresh = { reason: 'saved' }): Promise<void> {
  listeners.get(queryClient)?.forEach(listener => listener(event))
}
