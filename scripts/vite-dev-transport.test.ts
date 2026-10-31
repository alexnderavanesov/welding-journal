import { describe, expect, it } from 'vitest'
import { isClientTransportAbort } from './vite-dev-transport'

const inboundAbort = { code: 'ECONNRESET', message: 'aborted', stack: 'Error: aborted\n    at abortIncoming (node:_http_server:921:17)\n    at socketOnClose (node:_http_server:914:3)' }
const incomplete = { aborted: true, complete: false }

describe('development transport cancellation', () => {
  it.each([false, true])('recognizes a native cancellation after the connection has closed, complete=%s', complete => {
    expect(isClientTransportAbort(inboundAbort, { aborted: true, complete }, { destroyed: true })).toBe(true)
  })
  it.each([
    [{ ...incomplete, aborted: false }, { destroyed: true }],
    [{ aborted: false, complete: true }, { destroyed: true }],
    [incomplete, { destroyed: false }],
  ])('keeps errors from non-aborted/live requests visible', (request, response) => {
    expect(isClientTransportAbort(inboundAbort, request, response)).toBe(false)
  })
  it.each([
    new Error('Save failed'),
    { ...inboundAbort, stack: 'Error: aborted\n    at databaseQuery (/app/database.ts:42:3)' },
    { ...inboundAbort, code: '23505' },
    { ...inboundAbort, message: 'transaction aborted' },
    { name: 'AbortError', message: 'aborted' },
    null,
  ])('does not suppress unrelated errors even if the client disconnects', error => {
    expect(isClientTransportAbort(error, incomplete, { destroyed: true })).toBe(false)
  })
})
