import defaultEntry from '@tanstack/react-start/server-entry'
import { createReleaseRequestGate } from './server/release-request-gate'

const releaseGate = createReleaseRequestGate(async () => {
  const [{ requireDb }, { isDatabaseReleaseReady }] = await Promise.all([
    import('./db'), import('./server/release-readiness'),
  ])
  return isDatabaseReleaseReady(requireDb())
})

// TanStack's internal H3 adapter logs rejected Error values before fetch returns.
// Give only actual transport cancellations a handled Response as their reason.
// DB work owns its transaction independently of the HTTP response lifecycle.
export default {
  async fetch(...args: Parameters<typeof defaultEntry.fetch>) {
    const [request, options] = args
    if (process.env.NODE_ENV === 'production') {
      const blocked = await releaseGate(request)
      if (blocked) return blocked
    }
    // Page/streaming SSR requests retain their original abort lifecycle.
    if (!new URL(request.url).pathname.startsWith('/_serverFn/')) return defaultEntry.fetch(...args)
    if (isTransportAborted(request)) return clientClosedResponse()
    const controller = new AbortController()
    const onAbort = () => controller.abort(isTransportCancellation(request.signal.reason)
      ? clientClosedResponse()
      : request.signal.reason)
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) onAbort()
    try {
      // srvx supplies a Request-compatible object, not a native Request with
      // Undici's private slots. Construct from public fields; keep the body streaming.
      let normalized: Request
      try {
        const init = {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
          duplex: 'half',
        }
        // The transport's body getter can itself observe a disconnect, return
        // an unusable stream or throw before the native Request is constructed.
        if (isTransportAborted(request)) return clientClosedResponse()
        normalized = new Request(request.url, init)
      } catch (error) {
        if (isTransportAborted(request)) return clientClosedResponse()
        throw error
      }
      // Preserve Nitro's peer address and request context (including security),
      // which the standard Request copy constructor does not carry over.
      for (const key of ['runtime', 'context', 'ip'] as const) {
        if (key in request) Object.defineProperty(normalized, key, { value: Reflect.get(request, key), configurable: true })
      }
      if (isTransportAborted(request)) return clientClosedResponse()
      // Deliberately outside the normalization catch: once dispatched, handler
      // and transaction failures must propagate even if the client disconnects.
      return await defaultEntry.fetch(normalized, options)
    } finally {
      request.signal.removeEventListener('abort', onAbort)
    }
  },
} satisfies typeof defaultEntry

function clientClosedResponse() {
  return new Response(null, { status: 499, statusText: 'Client Closed Request' })
}

function isTransportAborted(request: Request) {
  return request.signal.aborted && isTransportCancellation(request.signal.reason)
}

function isTransportCancellation(reason: unknown) {
  if (!(reason instanceof Error) && !(reason instanceof DOMException)) return false
  return reason.name === 'AbortError' || Reflect.get(reason, 'code') === 'ECONNRESET'
}
