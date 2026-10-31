import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

export function isClientTransportAbort(
  error: unknown,
  request: Pick<IncomingMessage, 'aborted' | 'complete'>,
  response: Pick<ServerResponse, 'destroyed'>,
) {
  if (!request.aborted || !response.destroyed || !error || typeof error !== 'object') return false
  const cause = error as { code?: unknown; message?: unknown; stack?: unknown }
  // Only Node's inbound HTTP cancellation on a closed connection qualifies.
  // `complete` means all HTTP bytes arrived, not that their consumer finished:
  // Node can still abort that request while the adapter is reading its body.
  // Database resets and application errors must continue to surface.
  return cause.code === 'ECONNRESET' && cause.message === 'aborted'
    && typeof cause.stack === 'string' && /\bat abortIncoming \(node:_http_server:\d+:\d+\)/.test(cause.stack)
}

export function devTransportCancellation(): Plugin {
  return {
    name: 'dev-transport-cancellation',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      // Nitro's dev proxy forwards cancelled client requests to Connect's error
      // handler. Register after that proxy, before Vite broadcasts an overlay.
      return () => {
        server.middlewares.use((error: unknown, request: IncomingMessage, response: ServerResponse, next: Connect.NextFunction) => {
          if (isClientTransportAbort(error, request, response)) return
          next(error)
        })
      }
    },
  }
}
