import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@tanstack/react-start/server-entry', () => ({ default: { fetch: mocks.fetch } }))
import entry from './server'

describe('server request cancellation boundary', () => {
  beforeEach(() => vi.resetAllMocks())
  it('forwards successful responses and handler options unchanged', async () => {
    const request = Object.assign(new Request('http://127.0.0.1/_serverFn/test', { headers: { cookie: 'session=test' } }), {
      runtime: { node: { req: { socket: { remoteAddress: '127.0.0.1' } } } }, context: { clientAddress: '127.0.0.1' }, ip: '127.0.0.1',
    })
    const response = new Response('ok')
    const options = { context: { nonce: 'test-nonce' } }
    mocks.fetch.mockResolvedValue(response)
    expect(await entry.fetch(request, options)).toBe(response)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][1]).toBe(options)
    const forwarded = mocks.fetch.mock.calls[0][0]
    expect(forwarded.url).toBe(request.url)
    expect(forwarded.headers.get('cookie')).toBe('session=test')
    expect(forwarded.runtime).toBe(request.runtime)
    expect(forwarded.context).toBe(request.context)
    expect(forwarded.ip).toBe(request.ip)
  })
  it('leaves the original SSR request and its streaming cancellation lifecycle unchanged', async () => {
    const controller = new AbortController()
    const request = new Request('http://127.0.0.1/journal', { signal: controller.signal })
    mocks.fetch.mockResolvedValue(new Response('page'))
    await entry.fetch(request)
    expect(mocks.fetch).toHaveBeenCalledWith(request)
    controller.abort()
    expect(mocks.fetch.mock.calls[0][0].signal.reason).toBe(controller.signal.reason)
  })
  it('supports the server adapter Request shape without native private slots', async () => {
    const native = new Request('http://127.0.0.1/_serverFn/test', { method: 'POST', body: 'payload' })
    const adapted = Object.create(Request.prototype)
    for (const key of ['url', 'method', 'headers', 'body', 'signal'] as const) {
      Object.defineProperty(adapted, key, { value: native[key] })
    }
    mocks.fetch.mockImplementation(async (forwarded: Request) => new Response(await forwarded.text()))
    expect(await (await entry.fetch(adapted)).text()).toBe('payload')
  })
  it.each([
    new DOMException('Client disconnected', 'AbortError'),
    Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
  ])('classifies only the actual request cancellation as 499 (%s)', async (reason) => {
    const controller = new AbortController()
    const request = new Request('http://127.0.0.1/_serverFn/test', { signal: controller.signal })
    controller.abort(reason)
    mocks.fetch.mockImplementation(async (forwarded: Request) => forwarded.signal.reason)
    const response = await entry.fetch(request)
    expect(response.status).toBe(499)
    expect(await response.text()).toBe('')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('normalizes a disconnect during a POST without dropping its body', async () => {
    const controller = new AbortController()
    const request = new Request('http://127.0.0.1/_serverFn/test', { method: 'POST', body: '{"data":{}}', signal: controller.signal })
    mocks.fetch.mockImplementation(async (forwarded: Request) => {
      expect(await forwarded.text()).toBe('{"data":{}}')
      controller.abort()
      expect(forwarded.signal.aborted).toBe(true)
      return forwarded.signal.reason
    })
    expect((await entry.fetch(request)).status).toBe(499)
  })
  it('preserves binary POST data and content type without reading the body in the wrapper', async () => {
    const bytes = new Uint8Array([0, 10, 128, 255, 13, 65])
    const request = new Request('http://127.0.0.1/_serverFn/upload', {
      method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test' },
    })
    mocks.fetch.mockImplementation(async (forwarded: Request) => {
      expect(forwarded.bodyUsed).toBe(false)
      expect(forwarded.method).toBe('POST')
      expect(forwarded.headers.get('content-type')).toBe('application/octet-stream')
      expect(forwarded.headers.get('authorization')).toBe('Bearer test')
      expect(new Uint8Array(await forwarded.arrayBuffer())).toEqual(bytes)
      return new Response('ok')
    })
    expect((await entry.fetch(request)).status).toBe(200)
  })
  it.each([false, true])('removes its abort listener after settling the request (failure=%s)', async (failure) => {
    const request = new Request('http://127.0.0.1/_serverFn/test')
    const added = vi.spyOn(request.signal, 'addEventListener')
    const removed = vi.spyOn(request.signal, 'removeEventListener')
    const error = new Error('handler failure')
    if (failure) mocks.fetch.mockRejectedValue(error)
    else mocks.fetch.mockResolvedValue(new Response('ok'))
    try {
      if (failure) await expect(entry.fetch(request)).rejects.toBe(error)
      else await entry.fetch(request)
      expect(added).toHaveBeenCalledTimes(1)
      expect(removed).toHaveBeenCalledExactlyOnceWith('abort', added.mock.calls[0][1])
    } finally { added.mockRestore(); removed.mockRestore() }
  })
  it.each([false, true])('does not hide an unrelated DB failure or internal AbortError (disconnected=%s)', async (disconnected) => {
    const controller = new AbortController()
    const request = new Request('http://127.0.0.1/_serverFn/test', { signal: controller.signal })
    if (disconnected) controller.abort()
    for (const error of [new Error('database unavailable'), new DOMException('internal operation aborted', 'AbortError')]) {
      mocks.fetch.mockRejectedValue(error)
      await expect(entry.fetch(request)).rejects.toBe(error)
    }
  })
  it('does not classify a non-transport request abort reason as a browser disconnect', async () => {
    const controller = new AbortController()
    const request = new Request('http://127.0.0.1/_serverFn/test', { signal: controller.signal })
    const error = new Error('internal failure')
    controller.abort(error)
    mocks.fetch.mockRejectedValue(error)
    await expect(entry.fetch(request)).rejects.toBe(error)
  })
})
