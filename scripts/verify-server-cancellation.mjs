import assert from 'node:assert/strict'

// Run against the built entry and its real internal error adapter, not a mock.
// Abort before dispatch; the handler must not start business or database work.
const database = new URL(process.env.DATABASE_URL ?? '')
assert.equal(database.hostname, '127.0.0.1')
assert.equal(database.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const { default: entry } = await import('../.output/server/_ssr/ssr.mjs')
for (const reason of [new DOMException('Client disconnected', 'AbortError'),
  Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })]) {
  const controller = new AbortController()
  controller.abort(reason)
  const response = await entry.fetch(new Request('http://127.0.0.1/_serverFn/cancelled-before-dispatch', {
    method: 'POST', body: '{"data":{}}', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-tsr-serverfn': 'true' },
  }))
  assert.equal(response.status, 499)
  assert.equal(await response.text(), '')
}
console.log(JSON.stringify({ cancellations: 2, status: 499 }))
