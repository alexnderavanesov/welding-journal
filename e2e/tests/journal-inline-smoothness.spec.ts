import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { auditSqlCount } from '../audit-sql'
import type { JournalGridResult } from '../../src/lib/journal-server-grid'
import { createSmoothnessProbe } from '../smoothness-probe'
import { LARGE_LINE_PROJECT, seedDispatcherLargeLineFixture } from '../dispatcher-large-line-fixture'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'

test.skip(process.env.JOURNAL_INLINE_MEASUREMENTS !== '1', 'Explicit local 250000-row before/after comparison')
test.use({ trace: 'off', video: 'off' })

test('250000 joints: inline editing adds no idle suggestions or editors to wide flat/grouped scrolling', async ({ page, request, baseURL }, info) => {
  test.setTimeout(600000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  await seedDispatcherLargeLineFixture(250000)
  const directory = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
  const manifest = readFileSync(resolve(directory, readdirSync(directory).find(name => name.includes('tanstack-start-server-fn-resolver'))!), 'utf8')
  const observed = `${baseURL}/_serverFn/${manifest.match(/"([a-f0-9]{64})":/)![1]}`
  const call = async <T,>(name: string, data: unknown): Promise<T> => {
    const response = await request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
      data: await serializeRpcData(data), timeout: 300000,
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
    if (payload.error) throw payload.error
    expect(response.ok()).toBe(true); return payload.result
  }
  expect((await call<{ isFresh: boolean }>('refreshDispatcherTaskSnapshot', {})).isFresh).toBe(true)
  const probe = await createSmoothnessProbe(page, info), suggestions: string[] = []
  page.on('request', req => { if (req.url().includes('/_serverFn/') && rpcName(req.url()).startsWith('listWeldFormSuggestions')) suggestions.push(req.url()) })
  await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
  })))
  const grid = page.locator('.journal-grid-frame')
  const ready = async () => {
    await expect(page.getByText('Найдено: 250000', { exact: true })).toBeVisible({ timeout: 60000 })
    await expect(grid).toHaveAttribute('aria-busy', 'false')
    await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
  }
  try {
    await probe.measure('journal:first-open', async () => {
      await page.goto('/journal')
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(LARGE_LINE_PROJECT)
      await ready()
    })
    for (let round = 0; round < 3; round++) {
      await probe.measure(`journal:repeat-open:${round}`, async () => { await page.reload(); await ready() })
    }
    for (const grouped of [false, true]) {
      if (grouped) {
        await grid.locator('.ag-grid-viewport').evaluate(element => { element.scrollLeft = 0 })
        for (const column of ['line', 'projectTitle', 'subtitleCode']) {
          await grid.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
          await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
        }
        await grid.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
        await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
        await expect(grid.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^F\d+/)
        await ready()
      }
      for (let round = 0; round < 3; round++) {
        const label = `journal:${grouped ? 'grouped' : 'flat'}`
        await probe.scroll(`${label}:vertical:${round}`, grid)
        await probe.scroll(`${label}:horizontal:${round}`, grid, true)
        await probe.resize(`${label}:resize:${round}`, grid, 'line')
      }
    }
    expect(suggestions).toEqual([])
    await expect(page.getByTestId('journal-inline-editor')).toHaveCount(0)
  } finally { await probe.finish() }
  if (process.env.JOURNAL_INLINE_MUTATIONS === '1') {
    // Run writes only after gesture samples. Count the actual mutation RPC,
    // independent of background browser requests and fixture preparation.
    await page.close()
    const samples: { rows: number; ms: number; sql: number }[] = []
    for (const count of [1, 220]) {
      const query = { report: 'weldingJournal', columnFilters: { projectTitle: LARGE_LINE_PROJECT, line: 'L-6000' },
        groupBy: [], sort: { fieldKey: 'id', direction: 'asc' }, route: [], start: 0, end: 100 }
      const data = await call<JournalGridResult>('readJournalGrid', query)
      const url = siblingRpcUrl(observed, 'pasteJournalCells_createServerFn_handler')
      const before = (await auditSqlCount(url))!
      const start = performance.now()
      const result = await call<{ count: number }>('pasteJournalCells', { range: { ...query, revision: data.revision,
        anchor: 'line', parts: [{ route: [], start: 0, end: count, columns: ['weldingElectrodes'] }] }, values: [[`Load ${count}`]] })
      const ms = performance.now() - start
      expect(result.count).toBe(count)
      samples.push({ rows: count, ms, sql: (await auditSqlCount(url))! - before })
    }
    await writeFile(info.outputPath('paste-scale.json'), JSON.stringify(samples, null, 2))
    expect(samples[1].sql).toBeLessThan(samples[0].sql + 40)
  }
})
