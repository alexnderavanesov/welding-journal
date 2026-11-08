import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LARGE_LINE_PROJECT, seedDispatcherLargeLineFixture } from '../dispatcher-large-line-fixture'
import { withLineProgramFixture } from '../line-program-fixtures'
import { createSmoothnessProbe } from '../smoothness-probe'
import { revealJournalColumn } from '../journal-grid'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'

test.skip(process.env.JOURNAL_SUGGESTION_MEASUREMENTS !== '1', 'Explicit local active-editor check on 250000 joints')
test.use({ trace: 'off', video: 'off' })

test('250000 joints: populated suggestions do not block free typing or survive a closed editor', async ({ page, request, baseURL }, info) => {
  test.setTimeout(300000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  await seedDispatcherLargeLineFixture(250000)
  // Populate every fixture row, rather than measuring a scan of an empty column.
  await withLineProgramFixture(db => db.query("update weld_joints set shielding_gas='Gas '||lpad((id%20)::text,2,'0') where project_title=$1", [LARGE_LINE_PROJECT]))
  const directory = resolve('.output/server')
  const manifest = readFileSync(resolve(directory, readdirSync(directory).find(name => name.includes('tanstack-start-server-fn-resolver'))!), 'utf8')
  const observed = `${baseURL}/_serverFn/${manifest.match(/"([a-f0-9]{64})":/)![1]}`
  const response = await request.post(siblingRpcUrl(observed, 'refreshDispatcherTaskSnapshot_createServerFn_handler'), {
    data: await serializeRpcData({}), timeout: 240000,
    headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
  })
  const payload = await deserializeRpcResponse(await response.text()) as { result: { isFresh: boolean }; error?: Error }
  expect(payload.error).toBeUndefined(); expect(payload.result.isFresh).toBe(true)
  await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
  })))
  const probe = await createSmoothnessProbe(page, info)
  const calls: { ms: number; durationMs?: number }[] = []
  let active = 0, maxActive = 0
  const pending = new Map<object, number>()
  page.on('request', req => {
    if (!req.url().includes('/_serverFn/') || !rpcName(req.url()).startsWith('listWeldFormSuggestions')) return
    pending.set(req, calls.length); calls.push({ ms: performance.now() }); maxActive = Math.max(maxActive, ++active)
  })
  const finished = (req: object) => {
    const index = pending.get(req)
    if (index === undefined) return
    calls[index].durationMs = performance.now() - calls[index].ms; pending.delete(req); active--
  }
  page.on('requestfinished', finished); page.on('requestfailed', finished)
  try {
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(LARGE_LINE_PROJECT)
    await expect(page.getByText('Найдено: 250000', { exact: true })).toBeVisible({ timeout: 60000 })
    await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByTestId('journal-inline-status')).toHaveCount(0)
    await revealJournalColumn(page, 'shieldingGas')
    expect(calls).toHaveLength(0)
    const editor = page.getByTestId('journal-inline-editor')
    await probe.measure('editor:open', async () => {
      await page.locator('.ag-grid-scrolling-rows .ag-row:not(.ag-row-group) [col-id="shieldingGas"]').first().dblclick()
      await expect(editor).toBeVisible()
    })
    const input = editor.getByRole('textbox', { name: 'Защитный газ', exact: true })
    await probe.measure('editor:all-suggestions', async () => {
      await input.fill('')
      await expect(editor.getByRole('button', { name: /^Gas / }).first()).toBeVisible({ timeout: 15000 })
      expect(await editor.getByRole('button', { name: /^Gas / }).count()).toBeLessThanOrEqual(8)
    })
    const first = calls.length
    await probe.measure('editor:typing-and-filtered-suggestions', async () => {
      await input.pressSequentially('Gas 19', { delay: 15 })
      await expect(input).toHaveValue('Gas 19')
      await expect(editor.getByRole('button', { name: /^Gas 19/ })).toBeVisible({ timeout: 15000 })
    })
    expect(calls.length - first).toBeLessThanOrEqual(2)
    expect(maxActive).toBe(1)
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(page.getByTestId('journal-inline-status')).toHaveCount(0)
    const closed = calls.length
    await page.waitForTimeout(700)
    expect(calls).toHaveLength(closed)
  } finally {
    await writeFile(info.outputPath('suggestions.json'), JSON.stringify({ rows: 250000, distinctValues: 20, maxActive, calls }, null, 2))
    await probe.finish()
  }
})
