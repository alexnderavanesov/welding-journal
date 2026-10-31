import { expect, type Page } from '@playwright/test'
import { auditSqlCount } from './audit-sql'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from './rpc'

export async function measureResultRequestSearch(page: Page, scenarios: Array<{
  scope: 'primary' | 'beforeHeatTreatment' | 'psto' | 'tvmt'
  methodCode?: string
  prefix: string
  exact: string
  absent: string
}>) {
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  await page.goto('/account')
  await expect.poll(() => observed).not.toBe('')
  const measurements = []
  for (const scenario of scenarios) for (const [kind, search] of [['wide', scenario.prefix], ['exact', scenario.exact], ['absent', scenario.absent]] as const) {
    const lnk = scenario.scope === 'primary' || scenario.scope === 'beforeHeatTreatment'
    const url = siblingRpcUrl(observed, `${lnk ? 'getLnkWorkflowRequestSummary' : 'getPstoWorkflowRequestOptions'}_createServerFn_handler`)
    const before = await auditSqlCount(url), started = performance.now()
    const response = await page.request.post(url, { timeout: 60_000, data: await serializeRpcData({ resultScope: scenario.scope, methodCode: scenario.methodCode, search }),
      headers: { origin: new URL(url).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    const body = await response.text(), elapsedMs = Math.round(performance.now() - started)
    const result = await deserializeRpcResponse(body) as { result?: { options?: Array<{ name: string }>; requestOptions?: Array<{ name: string }>; hasMore: boolean }; error?: Error }
    expect(result.error).toBeUndefined()
    const options = result.result?.options ?? result.result?.requestOptions ?? []
    expect(options.length).toBeLessThanOrEqual(200) // Existing suggestion page size, not a document/joint limit.
    expect(Buffer.byteLength(body)).toBeLessThan(128_000)
    if (kind === 'wide') { expect(options).toHaveLength(200); expect(result.result?.hasMore).toBe(true) }
    if (kind === 'exact') expect(options.map(option => option.name)).toEqual([scenario.exact])
    if (kind === 'absent') expect(options).toEqual([])
    const statements = before === undefined ? undefined : (await auditSqlCount(url))! - before
    if (statements !== undefined) {
      expect(statements).toBeGreaterThan(0)
      expect(statements).toBeLessThanOrEqual(8) // Session/identity reads plus one aggregate; independent of matching positions.
    }
    measurements.push({ scope: scenario.scope, method: scenario.methodCode ?? 'all', kind, elapsedMs, sql: statements, bytes: Buffer.byteLength(body), options: options.length })
  }
  console.info('RESULT_REQUEST_SEARCH_200K', JSON.stringify(measurements))
  return measurements
}
