import assert from 'node:assert/strict'

// Run against the built entry and its real internal error adapter, not a mock.
// Requires the prepared disposable E2E database: readiness middleware runs
// before dispatch. An already aborted request must not reach its business handler.
const database = new URL(process.env.DATABASE_URL ?? '')
assert.equal(database.hostname, '127.0.0.1')
assert.equal(database.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
// Nitro may rename the bundled SSR export. Its renderer is the stable public
// adapter used by the built server and preserves the incoming abort signal.
const { default: render } = await import('../.output/server/_chunks/ssr-renderer.mjs')
for (const reason of [new DOMException('Client disconnected', 'AbortError'),
  Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })]) {
  const controller = new AbortController()
  controller.abort(reason)
  const response = await render({ req: new Request('http://127.0.0.1/_serverFn/cancelled-before-dispatch', {
    method: 'POST', body: '{"data":{}}', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-tsr-serverfn': 'true' },
  }) })
  assert.equal(response.status, 499)
  assert.equal(await response.text(), '')
}
console.log(JSON.stringify({ cancellations: 2, status: 499 }))
