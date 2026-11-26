import assert from 'node:assert/strict'

/** The forced rollback must emit exactly one redacted dispatcher diagnostic. */
export async function assertDispatcherRollback(run: () => Promise<unknown>, expectedCause: (reason: unknown) => boolean) {
  const original = console.error
  const messages: unknown[][] = []
  try {
    console.error = (...args) => { messages.push(args) }
    await assert.rejects(run, expectedCause)
  } finally {
    console.error = original
  }
  assert.equal(messages.length, 1)
  assert.equal(messages[0].length, 1)
  const [message] = messages[0]
  assert.ok(typeof message === 'string')
  const { eventId, ...record } = JSON.parse(message)
  assert.match(eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assert.deepEqual(record, { event: 'technical-error', operation: 'dispatcherIndex', errors: [{ type: 'database-query' }, { type: 'error' }] })
}
