import { expect, test, type Request } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcPayload, deserializeRpcResponse, serializeRpcData, rpcName } from '../rpc'
import { unpackStatisticsResult, type StatisticsResultPayload, type StatisticsRpcRequest } from '../../src/lib/statistics-result-payload'
import type { StatisticsServerResult } from '../../src/lib/statistics-server-summary'

const project = 'E2E statistics lossless payload'
test.use({ actionTimeout: 20000 })
test.afterEach(() => cleanupLineProgramProjects([project]))

function selectedIds(request: Request): number[] | undefined {
  if (!request.url().includes('/_serverFn/') || !/^readJournalGrid(?:_|$)/.test(rpcName(request.url()))) return
  const body = request.postData()
  if (!body) return
  const payload = deserializeRpcPayload(body) as { data?: { report?: string; columnFilters?: Record<string, string> } }
  if (payload.data?.report !== 'lnk' || !payload.data.columnFilters?.__rowIdList) return
  return (JSON.parse(payload.data.columnFilters.__rowIdList) as { rowIds: number[] }).rowIds
}

test('statistics packed transport retains the complete sparse drilldown beyond the visible page', async ({ page }) => {
  test.setTimeout(180000)
  const expected = await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number; vik_result: string }>(`insert into weld_joints(project_title,subtitle_code,line,joint,
      connection_type,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,psto_required)
      select $1,'PAYLOAD','PAYLOAD-LINE',case when n%10=0 then 'ОП' else 'F' end||lpad(n::text,4,'0'),
      case when n%10=0 then 'Т1' else 'С17' end,'2026-10-01','действующий','актуальная','да','PAYLOAD-V','2026-10-02',
      case when n%3=0 then 'ремонт' else 'годен' end,'PAYLOAD-C','2026-10-03','нет'
      from generate_series(1,600) n returning id,vik_result`, [project])
    return rows.filter(row => row.vik_result === 'годен').map(row => row.id).sort((a, b) => a - b)
  })
  expect(expected).toHaveLength(400)
  try {
    await page.goto('/statistics')
    await page.getByRole('main').getByRole('button', { name: 'ЛНК', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(project.toLowerCase())
    const response = page.waitForResponse(value => {
      if (!value.url().includes('/_serverFn/') || !/^getStatisticsServerResult(?:_|$)/.test(rpcName(value.url()))) return false
      const payload = deserializeRpcPayload(value.request().postData()!) as { data: StatisticsRpcRequest }
      return payload.data.tab === 'lnk' && payload.data.projectFilter === project.toLowerCase() && payload.data.from === '' && payload.data.to === ''
    })
    await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
    const wire = await response
    expect(wire.ok()).toBe(true)
    expect(await wire.text()).toContain('statistics-ids-v1')
    const good = page.getByTitle('Открыть: ВИК: годен', { exact: true })
    await expect(good).toContainText('400')
    await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled()
    // Reproduce an already-open old client's real HTTP call against the same
    // endpoint/cache: no transport flag must retain the original result shape.
    const { data: modernRequest } = deserializeRpcPayload(wire.request().postData()!) as { data: StatisticsRpcRequest }
    const { transport: _transport, ...legacyRequest } = modernRequest
    const legacyResponse = await page.request.post(wire.url(), { data: await serializeRpcData(legacyRequest),
      headers: { origin: new URL(wire.url()).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    expect(legacyResponse.ok()).toBe(true)
    const legacy = await deserializeRpcResponse(await legacyResponse.text()) as { result: StatisticsServerResult; error?: unknown }
    const modern = await deserializeRpcResponse(await wire.text()) as { result: StatisticsResultPayload; error?: unknown }
    expect(legacy.error).toBeUndefined()
    expect(modern.error).toBeUndefined()
    expect(legacy.result).not.toHaveProperty('format')
    expect(legacy.result).toEqual(unpackStatisticsResult(modern.result))
    const request = page.waitForRequest(value => selectedIds(value) !== undefined)
    await good.click()
    const sent = selectedIds(await request)!
    expect(sent).toHaveLength(expected.length)
    expect([...sent].sort((a, b) => a - b)).toEqual(expected)
    await expect(page).toHaveURL(/\/lnk(?:\?|$)/)
    await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 })
    await expect(page.getByText('Найдено: 400', { exact: true })).toBeVisible()
    expect(await page.locator('.journal-grid-frame .ag-row').count()).toBeLessThan(expected.length)
  } finally { await page.close() }
})
