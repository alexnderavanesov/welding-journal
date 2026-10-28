import { afterEach, expect, it, vi } from 'vitest'
import { retryAppModules } from './app-module-retry'

afterEach(() => { document.head.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('refreshes only own loaded modules at the same URLs, deduplicated, before one reload', async () => {
  document.head.innerHTML = '<script type="module" src="/assets/index.js"></script><link rel="modulepreload" href="/assets/page.js">'
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { name: new URL('/assets/page.js', location.href).href }, { name: '/assets/styles.css' },
    { name: 'https://other.invalid/assets/file.js' }, { name: '/_serverFn/query' },
  ] as PerformanceEntry[])
  const events: string[] = []
  const fetch = vi.fn(async (url: string) => { events.push(url); return new Response('') })
  vi.stubGlobal('fetch', fetch)
  const reload = vi.fn(() => { events.push('reload') })
  await retryAppModules(['/assets/index.js', '/assets/broken.js', 'http://['], reload)
  expect(events).toEqual(['/assets/index.js', '/assets/broken.js', '/assets/page.js'].map(path => new URL(path, location.href).href).concat('reload'))
  expect(fetch.mock.calls).toHaveLength(3)
  for (const call of vi.mocked(globalThis.fetch).mock.calls) expect(call[1]).toMatchObject({ cache: 'reload', signal: expect.any(AbortSignal) })
  expect(reload).toHaveBeenCalledOnce()
})

it('a persistent failure still allows one reload without a retry loop', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')))
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
  const reload = vi.fn()
  await retryAppModules(['/assets/missing.js'], reload)
  expect(reload).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('bounds stalled recovery requests and then reloads once', async () => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Timed out')), { once: true })
  })))
  const reload = vi.fn(), pending = retryAppModules(['/assets/stalled.js'], reload)
  expect(reload).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5000)
  await pending
  expect(reload).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})


it('waits for the entire replacement body before navigating away', async () => {
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
  let finish!: () => void
  const body = new Promise<void>(resolve => { finish = resolve })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ arrayBuffer: () => body }))
  const reload = vi.fn(), pending = retryAppModules(['/assets/incomplete.js'], reload)
  await Promise.resolve()
  expect(reload).not.toHaveBeenCalled()
  finish()
  await pending
  expect(reload).toHaveBeenCalledOnce()
})
