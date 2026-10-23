import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { invalidateWeldPageQueries, subscribeWeldPageRefresh } from './weld-page-refresh'
import { invalidateProgramApprovalCaches } from './program-approval-cache'

it('notifies mounted reports without fetching inactive queries or keeping removed subscribers', async () => {
  const client = new QueryClient(), first = vi.fn(), second = vi.fn()
  const invalidate = vi.spyOn(client, 'invalidateQueries'), refetch = vi.spyOn(client, 'refetchQueries')
  const unsubscribe = subscribeWeldPageRefresh(client, first)
  const unsubscribeSecond = subscribeWeldPageRefresh(client, second)
  await invalidateWeldPageQueries(client)
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce()
  unsubscribe(); await invalidateWeldPageQueries(client)
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledTimes(2)
  unsubscribeSecond(); await invalidateWeldPageQueries(client)
  expect(second).toHaveBeenCalledTimes(2)
  expect(invalidate).not.toHaveBeenCalled(); expect(refetch).not.toHaveBeenCalled()
  client.clear()
})
it('isolates refresh notifications between query clients', async () => {
  const first = new QueryClient(), second = new QueryClient(), listener = vi.fn()
  const unsubscribe = subscribeWeldPageRefresh(first, listener)
  await invalidateWeldPageQueries(second); expect(listener).not.toHaveBeenCalled()
  await invalidateWeldPageQueries(first); expect(listener).toHaveBeenCalledOnce()
  unsubscribe(); first.clear(); second.clear()
})
it('refreshes active report grids after a program exception changes without refreshing document history', async () => {
  const client = new QueryClient(), listener = vi.fn(), invalidate = vi.spyOn(client, 'invalidateQueries')
  const unsubscribe = subscribeWeldPageRefresh(client, listener)
  await invalidateProgramApprovalCaches(client, 7)
  expect(listener).toHaveBeenCalledOnce()
  expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['generated-documents'] }))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['line-program', 'calculation', 7], refetchType: 'active' })
  unsubscribe(); client.clear()
})
