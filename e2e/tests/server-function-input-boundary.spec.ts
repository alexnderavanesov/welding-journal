import { expect, test } from '@playwright/test'
import { rpcName, serializeRpcPayload } from '../rpc'

test('RPC rejects injected response state in an invalid read request, including document-style Accept', async ({ page }) => {
  const summaryRequest = page.waitForRequest(request =>
    rpcName(request.url()).startsWith('getWeldReportSummary_'))
  await page.goto('/journal')
  const request = await summaryRequest
  await page.waitForLoadState('networkidle')
  const sameOriginHeaders = { origin: new URL(request.url()).origin, 'sec-fetch-site': 'same-origin' }
  const url = new URL(request.url())
  // Deliberately invalid public data exercises the error path. The harmless
  // marker must never become an HTTP response body or a reflected HTML page.
  const marker = '<p>LOCAL-AUDIT-INJECTED-RESPONSE</p>'
  url.searchParams.set('payload', await serializeRpcPayload({
    data: null,
    result: { body: marker, status: 200, headers: { 'content-type': 'text/html' } },
    error: null,
    method: 'POST',
  }))
  const variants: Record<string, string>[] = [
    { accept: 'text/html' },
    { accept: 'application/json', 'x-tsr-serverFn': 'true' },
  ]
  for (const headers of variants) {
    const response = await page.request.get(url.href, { headers: { ...sameOriginHeaders, ...headers } })
    expect(response.headers()['content-type'] ?? '').not.toContain('text/html')
    const body = await response.text()
    expect(body).not.toContain('LOCAL-AUDIT-INJECTED-RESPONSE')
    expect(body).toContain('Неизвестный вид отчета.')
  }
  // The same real read endpoint remains usable after malformed requests.
  const healthy = await page.request.get(request.url(), {
    headers: { ...sameOriginHeaders, 'x-tsr-serverFn': 'true' },
  })
  expect(healthy.ok()).toBe(true)
  expect(await healthy.text()).toContain('result')
})
