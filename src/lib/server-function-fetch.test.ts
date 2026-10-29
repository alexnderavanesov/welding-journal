import { afterEach, expect, it, vi } from 'vitest'
import { serverFunctionFetch } from './server-function-fetch'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('explains an empty upstream response without replaying a possibly committed mutation', async () => {
  const request = vi.fn().mockResolvedValue(new Response(null, { status: 502 }))
  vi.stubGlobal('fetch', request)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(serverFunctionFetch('http://localhost/_serverFn/id?payload=private', { method: 'POST', body: 'private' })).rejects.toThrow('HTTP 502')
  expect(request).toHaveBeenCalledOnce()
  expect(warning).toHaveBeenCalledWith('Unexpected server-function response', { path: '/_serverFn/id', status: 502, contentType: '' })
})
it('passes serialized business errors intact and disables the HTTP cache', async () => {
  const response = new Response('{"error":"business"}', { status: 500, headers: { 'content-type': 'application/json' } })
  const request = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', request)
  expect(await serverFunctionFetch('/_serverFn/id', { method: 'GET' })).toBe(response)
  expect(request).toHaveBeenCalledWith('/_serverFn/id', { method: 'GET', cache: 'no-store' })
})
it('preserves cancellation and never retries a failed network write', async () => {
  const controller = new AbortController(); controller.abort()
  const abort = new DOMException('Aborted', 'AbortError')
  const request = vi.fn().mockRejectedValueOnce(abort).mockRejectedValueOnce(new TypeError('Load failed'))
  vi.stubGlobal('fetch', request)
  await expect(serverFunctionFetch('/_serverFn/id', { signal: controller.signal })).rejects.toBe(abort)
  await expect(serverFunctionFetch('/_serverFn/id', { method: 'POST' })).rejects.toThrow('проверьте результат')
  expect(request).toHaveBeenCalledTimes(2)
})
