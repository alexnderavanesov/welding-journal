import { expect, test } from '@playwright/test'
import { rpcName, serializeRpcPayload, siblingRpcUrl } from '../rpc'

test('RPC rejects injected response state in an invalid read request, including document-style Accept', async ({ page }) => {
  // Exercise both summary and row POST boundaries used by the reports.
  for (const [path, name, error, target] of [
    ['/lnk', 'getJournalReportSummary_', 'Неизвестный вид отчета.'],
    ['/journal', 'readJournalGrid_', 'Некорректная выборка сварочного журнала.'],
    ['/journal', 'readJournalGrid_', 'Некорректный набор блоков журнала.', 'readJournalGridBlocks_createServerFn_handler'],
  ]) {
    const pending = page.waitForRequest(request => rpcName(request.url()).startsWith(name))
    await page.goto(path)
    const request = await pending
    await page.waitForLoadState('networkidle')
    const sameOriginHeaders = { origin: new URL(request.url()).origin, 'sec-fetch-site': 'same-origin' }
    // Deliberately invalid public data exercises the real error path. The
    // marker must never become an HTTP response body or reflected HTML page.
    const marker = '<p>LOCAL-AUDIT-INJECTED-RESPONSE</p>'
    const payload = await serializeRpcPayload({
      data: null,
      result: { body: marker, status: 200, headers: { 'content-type': 'text/html' } },
      error: null, method: 'POST',
    })
    for (const headers of [
      { accept: 'text/html' },
      { accept: 'application/json', 'x-tsr-serverFn': 'true' },
    ] as Record<string, string>[]) {
      const url = new URL(target ? siblingRpcUrl(request.url(), target) : request.url())
      if (request.method() === 'GET') url.searchParams.set('payload', payload)
      const response = await page.request.fetch(url.href, {
        method: request.method(),
        headers: { ...sameOriginHeaders, ...headers, ...(request.method() === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(request.method() === 'POST' ? { data: payload } : {}),
      })
      expect(response.headers()['content-type'] ?? '').not.toContain('text/html')
      const body = await response.text()
      expect(body).not.toContain('LOCAL-AUDIT-INJECTED-RESPONSE')
      expect(body).toContain(error)
    }
    const healthy = await page.request.fetch(request.url(), {
      method: request.method(), headers: { ...sameOriginHeaders, 'x-tsr-serverFn': 'true', 'content-type': 'application/json' },
      ...(request.method() === 'POST' ? { data: request.postData()! } : {}),
    })
    expect(healthy.ok()).toBe(true)
    expect(await healthy.text()).toContain('result')
  }
})
