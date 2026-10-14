import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), gate: vi.fn() }))
vi.mock('@tanstack/react-start/server-entry', () => ({ default: { fetch: mocks.fetch } }))
vi.mock('./server/release-request-gate', () => ({ createReleaseRequestGate: () => mocks.gate }))
import entry from './server'

describe('server request cancellation boundary', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.gate.mockResolvedValue(null) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
  it('forwards successful responses and handler options unchanged', async () => {
    const request = Object.assign(new Request('http://127.0.0.1/_serverFn/test', { headers: { cookie: 'session=test' } }), {
      runtime: { node: { req: { socket: { remoteAddress: '127.0.0.1' } } } }, context: { clientAddress: '127.0.0.1', security: { session: 'test-session' } }, ip: '127.0.0.1',
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
    expect(mocks.fetch).not.toHaveBeenCalled()
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
  it('still waits for an already dispatched handler to finish after transport cancellation', async () => {
    const controller = new AbortController()
    const request = new Request('http://local/_serverFn/save', { method: 'POST', body: 'payload', signal: controller.signal })
    let finish!: () => void
    const finished = new Response('saved')
    mocks.fetch.mockReturnValue(new Promise<Response>(resolve => { finish = () => resolve(finished) }))
    let settled = false
    const running = entry.fetch(request).then(response => { settled = true; return response })
    try {
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      controller.abort(new DOMException('Client disconnected', 'AbortError'))
      await Promise.resolve()
      expect(settled).toBe(false)
      finish()
      expect(await running).toBe(finished)
    } finally { finish() }
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
    for (const error of [new Error('database unavailable'), new DOMException('internal operation aborted', 'AbortError')]) {
      const controller = new AbortController()
      const request = new Request('http://127.0.0.1/_serverFn/test', { signal: controller.signal })
      mocks.fetch.mockImplementation(async () => {
        if (disconnected) controller.abort()
        throw error
      })
      await expect(entry.fetch(request)).rejects.toBe(error)
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it('does not classify a non-transport request abort reason as a browser disconnect', async () => {
    const controller = new AbortController()
    const request = new Request('http://127.0.0.1/_serverFn/test', { signal: controller.signal })
    const error = new Error('internal failure')
    controller.abort(error)
    mocks.fetch.mockRejectedValue(error)
    await expect(entry.fetch(request)).rejects.toBe(error)
  })

  for (const reason of [new DOMException('Client disconnected', 'AbortError'), Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })]) {
    it.each(['locked', 'disturbed', 'throwing'] as const)('short-circuits an already cancelled %s body before Request construction or handler dispatch', async bodyState => {
      const controller = new AbortController()
      const request = new Request('http://local/_serverFn/save', { method: 'POST', body: 'payload', signal: controller.signal })
      const reader = request.body!.getReader()
      if (bodyState === 'disturbed') { await reader.read(); reader.releaseLock() }
      const body = vi.spyOn(request, 'body', 'get')
      if (bodyState === 'throwing') body.mockImplementation(() => { throw new TypeError('Response body object should not be disturbed or locked') })
      controller.abort(reason)
      const constructor = vi.spyOn(globalThis, 'Request')
      try {
        expect((await entry.fetch(request)).status).toBe(499)
        expect(constructor).not.toHaveBeenCalled()
        expect(body).not.toHaveBeenCalled()
        expect(mocks.fetch).not.toHaveBeenCalled()
      } finally { if (bodyState !== 'disturbed') reader.releaseLock() }
    })

    it('checks cancellation again after the production release gate finishes', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      let release!: () => void
      mocks.gate.mockReturnValue(new Promise<Response | null>(resolve => { release = () => resolve(null) }))
      const controller = new AbortController()
      const request = new Request('http://local/_serverFn/save', { method: 'POST', body: 'payload', signal: controller.signal })
      const reader = request.body!.getReader()
      const body = vi.spyOn(request, 'body', 'get')
      const constructor = vi.spyOn(globalThis, 'Request')
      const running = entry.fetch(request)
      try {
        expect(mocks.gate).toHaveBeenCalledExactlyOnceWith(request)
        controller.abort(reason)
        release()
        expect((await running).status).toBe(499)
        expect(constructor).not.toHaveBeenCalled()
        expect(body).not.toHaveBeenCalled()
        expect(mocks.fetch).not.toHaveBeenCalled()
      } finally { release(); reader.releaseLock() }
    })

    it.each([false, true])('handles transport abort inside the body getter (throws=%s) before starting the handler', async throws => {
      const controller = new AbortController()
      const request = new Request('http://local/_serverFn/save', { method: 'POST', body: 'payload', signal: controller.signal })
      const stream = request.body!
      const reader = stream.getReader()
      const added = vi.spyOn(request.signal, 'addEventListener')
      const removed = vi.spyOn(request.signal, 'removeEventListener')
      vi.spyOn(request, 'body', 'get').mockImplementation(() => {
        controller.abort(reason)
        if (throws) throw new TypeError('Response body object should not be disturbed or locked')
        return stream
      })
      const constructor = vi.spyOn(globalThis, 'Request')
      try {
        expect((await entry.fetch(request)).status).toBe(499)
        expect(constructor).not.toHaveBeenCalled()
        expect(mocks.fetch).not.toHaveBeenCalled()
        expect(removed).toHaveBeenCalledExactlyOnceWith('abort', added.mock.calls[0][1])
      } finally { reader.releaseLock() }
    })
  }

  it.each([false, true])('does not swallow a body getter error without a transport cancellation (internal abort=%s)', async internalAbort => {
    const controller = new AbortController()
    const request = new Request('http://local/_serverFn/save', { method: 'POST', body: 'payload', signal: controller.signal })
    const error = new TypeError('Response body object should not be disturbed or locked')
    vi.spyOn(request, 'body', 'get').mockImplementation(() => {
      if (internalAbort) controller.abort(new Error('internal cancellation'))
      throw error
    })
    await expect(entry.fetch(request)).rejects.toBe(error)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(['locked', 'disturbed'] as const)('does not swallow a non-aborted %s body constructor failure', async state => {
    const request = new Request('http://local/_serverFn/save', { method: 'POST', body: 'payload' })
    const reader = request.body!.getReader()
    if (state === 'disturbed') { await reader.read(); reader.releaseLock() }
    try {
      await expect(entry.fetch(request)).rejects.toThrow(/disturbed|locked/)
      expect(mocks.fetch).not.toHaveBeenCalled()
    } finally { if (state === 'locked') reader.releaseLock() }
  })

  it('forwards a normal POST stream without buffering and retains security/runtime/IP context', async () => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('streamed '))
      controller.enqueue(new TextEncoder().encode('payload'))
      controller.close()
    } })
    const request = Object.assign(new Request('http://local/_serverFn/save', {
      method: 'POST', body: stream, ...{ duplex: 'half' }, headers: { cookie: 'session=test' },
    }), { context: { security: { session: 'test-session' } }, runtime: { node: {} }, ip: '127.0.0.1' })
    const options = { context: { nonce: 'test-nonce' } }
    mocks.fetch.mockImplementation(async (forwarded: typeof request, forwardedOptions: typeof options) => {
      expect(forwarded.body).toBe(stream)
      expect(forwarded.bodyUsed).toBe(false)
      expect(stream.locked).toBe(false)
      expect(forwarded.context).toBe(request.context)
      expect(forwarded.runtime).toBe(request.runtime)
      expect(forwarded.ip).toBe(request.ip)
      expect(forwarded.headers.get('cookie')).toBe('session=test')
      expect(forwardedOptions).toBe(options)
      return new Response(await forwarded.text())
    })
    expect(await (await entry.fetch(request, options)).text()).toBe('streamed payload')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
