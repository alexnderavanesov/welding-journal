import { createServer, type ServerResponse } from 'node:http'
import { expect, test } from '@playwright/test'
import { observeMixedClient } from '../mixed-resource-telemetry'

test('счётчик нагрузки отличает уход со страницы от живого запроса и не скрывает запись', async ({ browser }) => {
  const held: ServerResponse[] = []
  let canceledSockets = 0
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/_serverFn/')) {
      held.push(response)
      response.on('close', () => { if (!response.writableEnded) canceledSockets++ })
    } else response.end('<html>telemetry fixture</html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const context = await browser.newContext()
  const telemetry = observeMixedClient(context, 'telemetry-regression')
  try {
    const page = await context.newPage()
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a local ephemeral server')
    const origin = `http://127.0.0.1:${address.port}`
    const endpoint = (name: string) => '/_serverFn/' + Buffer.from(JSON.stringify({ export: name })).toString('base64url')
    await page.goto(origin + '/a')
    await page.evaluate(url => { void fetch(url, { method: 'POST' }).catch(() => {}) }, endpoint('refreshDispatcherTaskSnapshot_test'))
    await expect.poll(() => telemetry.pending.size).toBe(1)
    await page.evaluate(() => history.pushState({}, '', '/same-document'))
    expect(telemetry.pending.size).toBe(1)
    await page.goto(origin + '/b')
    await expect.poll(() => canceledSockets).toBe(1)
    expect(telemetry.pending.size).toBe(0)
    expect((await telemetry.summary()).abandonedOnNavigation).toEqual(['refreshDispatcherTaskSnapshot_test'])

    await page.evaluate(url => { void fetch(url, { method: 'POST' }).catch(() => {}) }, endpoint('refreshDispatcherTaskSnapshot_test'))
    await expect.poll(() => telemetry.pending.size).toBe(1)
    held.at(-1)!.end('finished')
    await expect.poll(() => telemetry.pending.size).toBe(0)
    expect((await telemetry.summary()).rpc).toBe(1)

    await page.evaluate(url => { void fetch(url, { method: 'POST' }).catch(() => {}) }, endpoint('updateWeldJoint_test'))
    await expect.poll(() => telemetry.pending.size).toBe(1)
    await page.goto(origin + '/c')
    // A write with an unknown outcome must never disappear from the audit.
    expect(telemetry.pending.size + telemetry.errors.length).toBeGreaterThanOrEqual(1)
    expect((await telemetry.summary()).abandonedOnNavigation).toHaveLength(1)
  } finally {
    await context.close()
    for (const response of held) response.destroy()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
