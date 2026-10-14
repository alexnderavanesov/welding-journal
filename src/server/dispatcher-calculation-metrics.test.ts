import { channel } from 'node:diagnostics_channel'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startDispatcherCalculationMetrics } from './dispatcher-calculation-metrics'

const diagnostics = channel('welding.dispatcher.full-calculation')
const listeners = new Set<(message: unknown) => void>()

beforeEach(() => { vi.stubGlobal('window', undefined) })

function collectMetrics() {
  const messages: unknown[] = []
  const listener = (message: unknown) => { messages.push(message) }
  listeners.add(listener)
  diagnostics.subscribe(listener)
  return messages
}

afterEach(() => {
  for (const listener of listeners) diagnostics.unsubscribe(listener)
  listeners.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('does not initialize server diagnostics in the browser', () => {
  collectMetrics()
  vi.stubGlobal('window', {})
  expect(startDispatcherCalculationMetrics()).toBeUndefined()
})

it('returns undefined without a subscriber, without reading the clock, scheduling timers or publishing', () => {
  vi.useFakeTimers()
  const now = vi.spyOn(performance, 'now')
  const timeout = vi.spyOn(globalThis, 'setTimeout')
  const interval = vi.spyOn(globalThis, 'setInterval')
  const publish = vi.spyOn(diagnostics, 'publish')

  expect(diagnostics.hasSubscribers).toBe(false)
  expect(startDispatcherCalculationMetrics()).toBeUndefined()
  expect(now).not.toHaveBeenCalled()
  expect(timeout).not.toHaveBeenCalled()
  expect(interval).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(publish).not.toHaveBeenCalled()
})

it('aggregates repeated stages into non-overlapping intervals and publishes only on finish', () => {
  const messages = collectMetrics()
  let now = 100
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const metrics = startDispatcherCalculationMetrics()!
  expect(metrics).toBeDefined()

  now = 110
  metrics.mark('read-weld-batch')
  now = 140
  metrics.mark('business-checks')
  now = 160
  metrics.mark('read-weld-batch')
  now = 175
  metrics.mark('publish-pages')
  expect(messages).toEqual([])

  now = 205
  metrics.finish('completed')
  expect(messages).toStrictEqual([{
    outcome: 'completed',
    milliseconds: 105,
    stages: {
      initialization: { milliseconds: 10, visits: 1 },
      'read-weld-batch': { milliseconds: 45, visits: 2 },
      'business-checks': { milliseconds: 20, visits: 1 },
      'publish-pages': { milliseconds: 30, visits: 1 },
    },
  }])
})

it('preserves the failed outcome and elapsed time of the interrupted stage', () => {
  const messages = collectMetrics()
  let now = 30
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const metrics = startDispatcherCalculationMetrics()!
  expect(metrics).toBeDefined()

  now = 35
  metrics.mark('relations-and-preparation')
  now = 55
  metrics.finish('failed')

  expect(messages).toStrictEqual([{
    outcome: 'failed',
    milliseconds: 25,
    stages: {
      initialization: { milliseconds: 5, visits: 1 },
      'relations-and-preparation': { milliseconds: 20, visits: 1 },
    },
  }])
})

it('publishes only aggregate fields, with no extra data or stage history shared between calculations', () => {
  const messages = collectMetrics()
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const first = startDispatcherCalculationMetrics()!
  expect(first).toBeDefined()
  now = 2
  first.mark('supporting-data')
  now = 4
  first.finish('completed')

  now = 10
  const second = startDispatcherCalculationMetrics()!
  expect(second).toBeDefined()
  now = 13
  second.finish('failed')

  // An exact envelope also rejects added rows, IDs, credentials, error details,
  // timestamps or per-visit events; only named aggregate durations are allowed.
  expect(messages).toStrictEqual([
    {
      outcome: 'completed',
      milliseconds: 4,
      stages: {
        initialization: { milliseconds: 2, visits: 1 },
        'supporting-data': { milliseconds: 2, visits: 1 },
      },
    },
    {
      outcome: 'failed',
      milliseconds: 3,
      stages: { initialization: { milliseconds: 3, visits: 1 } },
    },
  ])
})
