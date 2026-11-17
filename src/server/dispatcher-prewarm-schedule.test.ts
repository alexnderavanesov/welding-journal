// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextDispatcherPrewarmAt, startDispatcherPrewarmSchedule } from './dispatcher-prewarm-schedule'

let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-16T03:29:59.000Z'))
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks() })

it.each([
  ['2026-11-16T03:29:59.123Z', '2026-11-16T03:30:00.000Z'],
  ['2026-11-16T03:30:00.000Z', '2026-11-17T03:30:00.000Z'],
  ['2026-11-16T21:15:00.000Z', '2026-11-17T03:30:00.000Z'],
  ['2026-12-31T23:15:00.000Z', '2027-01-01T03:30:00.000Z'],
  ['2026-11-21T04:00:00.000Z', '2026-11-22T03:30:00.000Z'],
])('schedules Moscow 06:30 including weekends/year rollover: %s', (now, expected) => {
  expect(nextDispatcherPrewarmAt(new Date(now)).toISOString()).toBe(expected)
})

it('does no startup work or polling, runs once at 06:30 and repeats the next day', async () => {
  const prepare = vi.fn().mockResolvedValue({ ready: true })
  stop = startDispatcherPrewarmSchedule(prepare)
  expect(prepare).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(999)
  expect(prepare).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(prepare).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(86_399_999)
  expect(prepare).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(prepare).toHaveBeenCalledTimes(2)
})

it('reports failure without secret/error details and waits until tomorrow, without retry loops', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const prepare = vi.fn().mockRejectedValueOnce(new Error('private connection string')).mockResolvedValue({ ready: true })
  stop = startDispatcherPrewarmSchedule(prepare)
  await vi.advanceTimersByTimeAsync(1000)
  expect(error).toHaveBeenCalledTimes(1)
  expect(String(error.mock.calls)).not.toContain('private connection string')
  await vi.advanceTimersByTimeAsync(86_400_000)
  expect(prepare).toHaveBeenCalledTimes(2)
  expect(error).toHaveBeenCalledTimes(1)
})

it('never overlaps a slow run and does not replay missed days when it completes', async () => {
  let complete!: () => void
  const prepare = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve }))
    .mockResolvedValue({ ready: true })
  stop = startDispatcherPrewarmSchedule(prepare)
  await vi.advanceTimersByTimeAsync(1000 + 2 * 86_400_000)
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  complete()
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(86_400_000)
  expect(prepare).toHaveBeenCalledTimes(2)
})

it('cancels the timer on stop and never starts work afterwards', async () => {
  const prepare = vi.fn()
  stop = startDispatcherPrewarmSchedule(prepare)
  stop()
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(86_400_000)
  expect(prepare).not.toHaveBeenCalled()
})

it('does not reschedule when stopped while a calculation is finishing', async () => {
  let complete!: () => void
  stop = startDispatcherPrewarmSchedule(() => new Promise<void>(resolve => { complete = resolve }))
  await vi.advanceTimersByTimeAsync(1000)
  stop()
  complete()
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('rechecks the clock after a backward correction instead of running early', async () => {
  const prepare = vi.fn().mockResolvedValue({ ready: true })
  stop = startDispatcherPrewarmSchedule(prepare)
  vi.setSystemTime(new Date('2026-11-16T03:00:00.000Z'))
  await vi.advanceTimersByTimeAsync(1000)
  expect(prepare).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(29 * 60_000 + 59_000)
  expect(prepare).toHaveBeenCalledTimes(1)
})

it('skips an expired day after a forward clock correction', async () => {
  const prepare = vi.fn().mockResolvedValue({ ready: true })
  stop = startDispatcherPrewarmSchedule(prepare)
  vi.setSystemTime(new Date('2026-11-18T08:00:00.000Z'))
  await vi.advanceTimersByTimeAsync(1000)
  expect(prepare).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
})
