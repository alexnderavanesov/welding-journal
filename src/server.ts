import defaultEntry from '@tanstack/react-start/server-entry'

// TanStack's internal H3 adapter logs rejected Error values before fetch returns.
// Give only actual transport cancellations a handled Response as their reason.
// DB work owns its transaction independently of the HTTP response lifecycle.
export default {
  async fetch(...args: Parameters<typeof defaultEntry.fetch>) {
    const [request, options] = args
    // Page/streaming SSR requests retain their original abort lifecycle.
    if (!new URL(request.url).pathname.startsWith('/_serverFn/')) return defaultEntry.fetch(...args)
    const controller = new AbortController()
    const onAbort = () => controller.abort(isTransportCancellation(request.signal.reason)
      ? new Response(null, { status: 499, statusText: 'Client Closed Request' })
      : request.signal.reason)
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) onAbort()
    try {
      // srvx supplies a Request-compatible object, not a native Request with
      // Undici's private slots. Construct from public fields; keep the body streaming.
      const normalized = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        ...{ duplex: 'half' },
      })
      // Preserve Nitro's peer address and request context (including security),
      // which the standard Request copy constructor does not carry over.
      for (const key of ['runtime', 'context', 'ip'] as const) {
        if (key in request) Object.defineProperty(normalized, key, { value: Reflect.get(request, key), configurable: true })
      }
      return await defaultEntry.fetch(normalized, options)
    } finally {
      request.signal.removeEventListener('abort', onAbort)
    }
  },
} satisfies typeof defaultEntry

function isTransportCancellation(reason: unknown) {
  if (!(reason instanceof Error) && !(reason instanceof DOMException)) return false
  return reason.name === 'AbortError' || Reflect.get(reason, 'code') === 'ECONNRESET'
}
