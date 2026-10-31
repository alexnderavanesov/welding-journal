import { expect, test } from '@playwright/test'
import { connect } from 'node:net'
import { rpcName } from '../rpc'

test('aborting partial or fully sent read RPCs does not broadcast a dev error overlay', async ({ page, context, baseURL }) => {
  test.setTimeout(120_000)
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD === '1', 'Exercises the Vite/Nitro development adapter.')
  const errors: string[] = []
  let readUrl = '', readBody = '', sockets = 0
  page.on('websocket', socket => {
    sockets++
    socket.on('framereceived', frame => {
      try { const message = JSON.parse(String(frame.payload)); if (message.type === 'error') errors.push(message.err?.message ?? String(frame.payload)) } catch {}
    })
  })
  page.on('request', request => {
    if (request.method() === 'POST' && /^(readJournalGrid|getJournalReportSummary)_/.test(rpcName(request.url()))) { readUrl = request.url(); readBody = request.postData() ?? '' }
  })
  await page.goto('/journal')
  await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toBeVisible({ timeout: 45_000 })
  await expect.poll(() => readUrl, { timeout: 45_000 }).not.toBe('')
  await expect.poll(() => sockets).toBeGreaterThan(0)
  const url = new URL(readUrl), cookie = (await context.cookies(baseURL)).map(item => `${item.name}=${item.value}`).join('; ')
  for (const [complete, delay] of [[false, 50], [false, 200], [false, 500], [true, 0], [true, 1], [true, 5]] as const) {
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host: url.hostname, port: Number(url.port) }, () => {
        // Valid JSON padding widens the race where HTTP parsing is complete
        // but the adapter has not consumed the body before the client closes.
        const body = complete ? readBody + ' '.repeat(1_000_000) : '{"data":'
        socket.write(`POST ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${url.origin}\r\nSec-Fetch-Site: same-origin\r\nCookie: ${cookie}\r\nContent-Type: application/json\r\nx-tsr-serverFn: true\r\nContent-Length: ${complete ? Buffer.byteLength(body) : 1_000_000}\r\n\r\n${body}`)
        setTimeout(() => socket.destroy(), delay)
      })
      socket.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error) })
      socket.on('close', () => resolve())
    })
  }
  // Let the adapter propagate a delayed rejection, then verify a fresh read.
  await page.waitForTimeout(1000)
  expect(errors).toEqual([])
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toBeVisible({ timeout: 45_000 })
  expect(errors).toEqual([])
})
