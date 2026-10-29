import { expect, test } from '@playwright/test'
import { rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'

test('custom Start entry preserves same-origin RPC protection and ordinary page access', async ({ page }) => {
  let request: { url: string; body: string } | undefined
  let getUrl: string | undefined
  page.on('request', value => {
    if (rpcName(value.url()).startsWith('readJournalGrid_')) request = { url: value.url(), body: value.postData()! }
    if (value.method() === 'GET' && value.url().includes('/_serverFn/')) getUrl = value.url()
  })
  const document = await page.goto('/journal')
  expect(document?.status()).toBe(200)
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  expect(request).toBeDefined()
  const { url, body } = request!
  const origin = new URL(url).origin
  const rpcHeaders = { 'content-type': 'application/json', 'x-tsr-serverFn': 'true' }
  for (const headers of [
    { 'sec-fetch-site': 'same-origin' }, { origin }, { referer: origin + '/journal' },
  ] as Array<Record<string, string>>) {
    expect((await page.request.post(url, { data: body, headers: { ...rpcHeaders, ...headers } })).status()).toBe(200)
  }
  const forbidden: Array<Record<string, string>> = [
    { 'sec-fetch-site': 'cross-site', origin: 'https://foreign.invalid' },
    { 'sec-fetch-site': 'same-site', origin },
    { origin: 'https://foreign.invalid' }, { referer: 'https://foreign.invalid/page' }, {},
  ]
  for (const headers of forbidden) {
    const response = await page.request.post(url, { data: body, headers: { ...rpcHeaders, ...headers } })
    expect(response.status(), JSON.stringify(headers)).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  }
  // A mutation must be rejected by the same gate, before payload validation.
  // The deliberately invalid payload cannot mutate the isolated fixture even
  // when this regression is run against an unprotected build.
  const write = await page.request.post(siblingRpcUrl(url, 'updateWeldJoint_createServerFn_handler'), {
    data: await serializeRpcData({}), headers: { ...rpcHeaders, 'sec-fetch-site': 'cross-site', origin: 'https://foreign.invalid' },
  })
  expect(write.status()).toBe(403)
  expect(await write.text()).toBe('Forbidden')
  // Replay an actual GET RPC, rather than sending GET to a POST-only handler.
  expect(getUrl).toBeDefined()
  expect((await page.request.get(getUrl!, { headers: { 'sec-fetch-site': 'same-origin' } })).status()).toBe(200)
  expect((await page.request.get(getUrl!, { headers: { 'sec-fetch-site': 'cross-site' } })).status()).toBe(403)
})
