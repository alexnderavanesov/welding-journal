import { channel } from 'node:diagnostics_channel'
import { get, type ClientRequest } from 'node:http'
import type { Socket } from 'node:net'

function expectedTestOrigin() {
  return process.env.E2E_DATABASE_PROFILE === 'release-access' ? 'http://127.0.0.1:3115' : 'http://127.0.0.1:3100'
}

export function safeAuthLoadError(error: unknown) {
  const value = error as { name?: string; code?: string; message?: string }
  // Playwright's remaining lines contain request logs, including credentials.
  // Only retain the first error line, with any URL removed in its entirety.
  return { name: value?.name ?? 'Error', code: value?.code,
    message: String(value?.message ?? error).split('\n')[0].replace(/https?:\/\/\S+/g, '[url]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').slice(0, 350) }
}

/** Passive, bounded diagnostics for explicitly tagged local API requests only.
 * Never inspect cookies, other headers, body, query string or actor identity. */
export function observeAuthLoadTransport(origin: string) {
  const base = new URL(origin)
  if (base.origin !== expectedTestOrigin()) throw new Error('Auth transport diagnostics require the isolated E2E server')
  const started = performance.now(), events: Record<string, unknown>[] = []
  let dropped = 0, nextSocket = 0
  const sockets = new WeakMap<Socket, { id: number; lastRequest?: string; lastResponseMs?: number }>()
  const removers: Array<() => void> = []
  const now = () => Math.round((performance.now() - started) * 100) / 100
  const record = (event: string, fields: Record<string, unknown>) => {
    if (events.length < 3000) events.push({ event, ms: now(), ...fields }); else dropped++
  }
  const once = (emitter: ClientRequest | Socket, event: string, listener: (...args: any[]) => void) => {
    emitter.once(event, listener); removers.push(() => emitter.off(event, listener))
  }
  const subscriber = (message: unknown) => {
    const request = (message as { request?: ClientRequest }).request
    if (!request || String(request.getHeader('host')) !== base.host) return
    const id = request.getHeader('x-e2e-auth-load-request-id')
    if (typeof id !== 'string' || !/^auth-(20000|200000)-\d{1,2}-(login|read|save|verify)$/.test(id)) return
    record('request-start', { id, method: request.method, reusedSocket: request.reusedSocket })
    let assigned: Socket | undefined
    const socketAssigned = (socket: Socket) => {
      if (assigned === socket) return
      assigned = socket
      let state = sockets.get(socket)
      if (!state) {
        state = { id: ++nextSocket }; sockets.set(socket, state)
        const socketId = state.id
        once(socket, 'end', () => record('socket-end', { socketId }))
        once(socket, 'close', (hadError: boolean) => record('socket-close', { socketId, hadError }))
        once(socket, 'error', error => record('socket-error', { socketId, error: safeAuthLoadError(error) }))
      }
      record('socket-assigned', { id, socketId: state.id, reusedSocket: request.reusedSocket,
        previousRequestId: state.lastRequest, sincePreviousResponseMs: state.lastResponseMs === undefined ? null : now() - state.lastResponseMs,
        connecting: socket.connecting, destroyed: socket.destroyed, localPort: socket.localPort, remotePort: socket.remotePort })
      state.lastRequest = id
    }
    once(request, 'socket', socketAssigned)
    if (request.socket) socketAssigned(request.socket)
    once(request, 'response', response => {
      const state = request.socket && sockets.get(request.socket)
      record('response', { id, socketId: state?.id, status: response.statusCode,
        connection: response.headers.connection, keepAlive: response.headers['keep-alive'] })
      response.once('end', () => {
        if (state) state.lastResponseMs = now()
        record('response-end', { id, socketId: state?.id })
      })
    })
    once(request, 'error', error => record('request-error', { id, error: safeAuthLoadError(error), reusedSocket: request.reusedSocket }))
    once(request, 'close', () => record('request-close', { id, reusedSocket: request.reusedSocket, destroyed: request.destroyed }))
  }
  const source = channel('http.client.request.start')
  source.subscribe(subscriber)
  return {
    snapshot: () => ({ node: process.version, events, dropped, observedSockets: nextSocket,
      note: 'No events means transport instrumentation was unavailable; it does not prove requests were absent.' }),
    stop: () => { source.unsubscribe(subscriber); removers.forEach(remove => remove()) },
  }
}

/** Fresh unauthenticated sockets distinguish liveness/readiness from the failed
 * API connection. This is a diagnostic read, never a retry of an operation. */
export async function probeAuthLoadServer(origin: string) {
  if (new URL(origin).origin !== expectedTestOrigin()) throw new Error('Unexpected health probe target')
  return Promise.all(['/health/live', '/health/ready'].map(path => new Promise<Record<string, unknown>>(resolve => {
    const started = performance.now()
    const request = get(new URL(path, origin), { agent: false, timeout: 5000 }, response => {
      response.resume()
      response.once('end', () => resolve({ path, status: response.statusCode, ms: Math.round(performance.now() - started) }))
      response.once('error', error => resolve({ path, error: safeAuthLoadError(error), ms: Math.round(performance.now() - started) }))
    })
    request.once('timeout', () => request.destroy(Object.assign(new Error('Diagnostic health probe timed out'), { code: 'ETIMEDOUT' })))
    request.once('error', error => resolve({ path, error: safeAuthLoadError(error), ms: Math.round(performance.now() - started) }))
  })))
}
