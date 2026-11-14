import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { seedExtraDocumentBackground, growExtraDocumentRegistries, extraDocumentTitle } from '../supplemental-documents-scale-fixture'
import { openDocumentGridColumnMenu, openDocumentGridFilter } from '../document-grid'
import { createSmoothnessProbe } from '../smoothness-probe'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName } from '../rpc'
import type { DocumentHistoryGridRequest } from '../../src/lib/document-history-grid'

test.skip(process.env.SUPPLEMENTAL_DOCUMENT_SCALE !== '1', 'Explicit standalone 200k-joint / four additional registry profile')
test.use({ trace: 'off', video: 'off', actionTimeout: 30000 })

type GridRequest = DocumentHistoryGridRequest & { types?: string[]; columnFilters?: Record<string, string> }
function gridRequest(request: Request): GridRequest | null {
  if (!rpcName(request.url()).includes('GeneratedDocumentHistoryGrid')) return null
  const text = request.postData() ?? new URL(request.url()).searchParams.get('payload')
  return text ? (deserializeRpcPayload(text) as { data: GridRequest }).data : null
}
async function settled(page: Page, grid: Locator, count: number) {
  await expect(grid.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible({ timeout: 60000 })
  await expect(grid.locator('.document-grid-frame')).not.toHaveAttribute('data-journal-updating', '')
  await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
  await expect(grid.locator('[role="alert"]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
}

test('four additional registries: independent cardinalities, exact scopes and bounded browser queries', async ({ browser }, info) => {
  test.setTimeout(1200000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS_FILE).toBeTruthy()
  await seedExtraDocumentBackground()
  const manifests: unknown[] = [], measurements: Array<{ count: number; samples: Array<{ name: string; sqlStatements: number | null; readyMs?: number; requests?: unknown[] }> }> = []
  let previous = 0
  for (const count of [1000, 5000] as const) {
    const fixture = await growExtraDocumentRegistries(previous, count); previous = count
    manifests.push(fixture)
    await writeFile(info.outputPath('fixture-manifests.json'), JSON.stringify(manifests, null, 2))
    const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL,
      viewport: { width: 1600, height: 1000 } })
    const page = await context.newPage(), probe = await createSmoothnessProbe(page, info)
    const requests: GridRequest[] = []
    page.on('request', request => { const data = gridRequest(request); if (data) requests.push(data) })
    try {
      for (const profile of fixture.profiles) {
        const grid = page.locator(`[data-document-history-grid="generated:${profile.types.join('+')}"]`)
        const selectAll = grid.getByRole('checkbox', { name: 'Выбрать все документы', exact: true })
        const clearSelection = async () => {
          await expect(selectAll).toBeChecked()
          await expect(selectAll).not.toHaveAttribute('aria-busy', 'true')
          await selectAll.click()
          await expect(selectAll).not.toBeChecked()
          await expect(grid.getByText('Выбрано: 0', { exact: true })).toBeVisible()
        }
        const sample = (action: string, run: () => Promise<unknown>) => probe.measure(`${profile.id}:${action}`, run)
        await sample('open', async () => {
          await page.goto('/documents')
          await page.getByRole('button', { name: profile.label, exact: true }).click()
          await settled(page, grid, count)
        })
        await sample('sort-ascending', async () => {
          await openDocumentGridColumnMenu(page, 'title')
          await page.getByRole('menuitem', { name: 'По возрастанию', exact: true }).click()
          await settled(page, grid, count)
          for (let index = 0; index < 5; index++) await expect(grid.locator(`.ag-row[row-index="${index}"] [col-id="title"] button`)).toHaveText(profile.rows[index].title)
        })
        for (let round = 0; round < 2; round++) {
          await probe.scroll(`${profile.id}:vertical:${round}`, grid)
          await probe.scroll(`${profile.id}:horizontal:${round}`, grid, true)
          await probe.resize(`${profile.id}:resize:${round}`, grid, 'title')
        }
        await sample('deep-block', async () => {
          await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
          await expect(grid.locator(`.ag-row[row-index="${count - 1}"] [col-id="title"] button`)).toHaveText(extraDocumentTitle(profile.id, count), { timeout: 60000 })
          await settled(page, grid, count)
        })
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
        await expect(grid.locator('.ag-row[row-index="0"] [col-id="title"] button')).toHaveText(profile.rows[0].title)
        await sample('select-all', async () => {
          await expect(selectAll).not.toBeChecked()
          // The controlled header changes only after its complete idsOnly read;
          // check() requires a synchronous state change after the pointer click.
          const [response] = await Promise.all([
            page.waitForResponse(response => Boolean(gridRequest(response.request())?.idsOnly)),
            selectAll.click(),
          ])
          const payload = await deserializeRpcResponse(await response.text()) as { result?: { ids?: number[] }; error?: Error }
          expect(payload.error).toBeUndefined()
          expect(payload.result?.ids).toEqual(profile.rows.map(row => row.id).sort((a, b) => a - b))
          await expect(selectAll).toBeChecked()
          await expect(grid.getByText(`Выбрано: ${count}`, { exact: true })).toBeVisible()
        })
        await clearSelection()
        const matching = profile.rows.filter(row => row.lines.includes('XDS-L-000'))
        expect(matching).toHaveLength(profile.layered ? 50 : 25)
        await sample('facet-open', async () => {
          const dialog = await openDocumentGridFilter(page, 'line', 'Линия')
          await expect(dialog.locator('.document-filter-options')).toHaveAttribute('aria-busy', 'false')
          await expect(dialog.getByRole('checkbox').first()).toBeVisible()
        })
        const dialog = page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true })
        await sample('facet-search', async () => {
          await dialog.getByLabel('Найти значение фильтра').fill('XDS-L-000')
          await expect(dialog.locator('.document-filter-options')).toHaveAttribute('aria-busy', 'false')
          await expect(dialog.getByRole('checkbox')).toHaveCount(1)
          await expect(dialog.getByRole('checkbox')).toHaveAccessibleName(new RegExp(`XDS-L-000.*${matching.length}`))
        })
        await sample('filter', async () => {
          await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
          await settled(page, grid, matching.length)
        })
        await page.keyboard.press('Escape')
        await sample('filtered-sort-selection', async () => {
          const response = page.waitForResponse(response => {
            const request = gridRequest(response.request())
            return Boolean(request && !request.idsOnly && !request.cells && !request.countRoutes && !request.selectionOnly
              && request.startRow === 0 && request.sortModel.some(sort => sort.colId === 'title' && sort.sort === 'desc'))
          })
          await openDocumentGridColumnMenu(page, 'title')
          await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
          const payload = await deserializeRpcResponse(await (await response).text()) as { result?: { rows?: Array<{ id: number; title: string }> }; error?: Error }
          expect(payload.error).toBeUndefined()
          expect(payload.result?.rows?.map(row => ({ id: row.id, title: row.title }))).toEqual(
            [...matching].reverse().map(row => ({ id: row.id, title: row.title })))
          await settled(page, grid, matching.length)
          for (let index = 0; index < 5; index++) await expect(grid.locator(`.ag-row[row-index="${index}"] [col-id="title"] button`)).toHaveText(matching.at(-index - 1)!.title)
          await expect(selectAll).not.toBeChecked()
          await selectAll.click()
          await expect(selectAll).toBeChecked()
          await expect(grid.getByText(`Выбрано: ${matching.length}`, { exact: true })).toBeVisible()
          // Every matching card fits in one server block. Exact identities in
          // that block independently verify filter membership, not only count.
          const ids = await grid.locator('.ag-row[row-id^="document:"]').evaluateAll(rows => rows.map(row => Number(row.getAttribute('row-id')!.slice('document:'.length))))
          expect(ids.length).toBeGreaterThan(0)
          expect(ids.every(id => matching.some(row => row.id === id))).toBe(true)
        })
        await clearSelection()
        await openDocumentGridFilter(page, 'line', 'Линия')
        await page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true }).getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
        await page.keyboard.press('Escape'); await settled(page, grid, count)
        await sample('group', async () => {
          await openDocumentGridColumnMenu(page, 'line')
          await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
          await expect(grid.locator('.ag-row-group').first()).toBeVisible()
          await settled(page, grid, count)
        })
        await probe.scroll(`${profile.id}:grouped-scroll`, grid)
        await probe.resize(`${profile.id}:grouped-resize`, grid, 'title')
        await page.screenshot({ path: info.outputPath(`${profile.id}-${count}.png`) })
      }
      const blocks = requests.filter(request => !request.idsOnly && !request.cells && !request.countRoutes && !request.selectionOnly)
      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks.every(request => request.endRow - request.startRow <= 100)).toBe(true)
      await writeFile(info.outputPath(`requests-${count}.json`), JSON.stringify(requests, null, 2))
    } finally {
      await probe.finish()
      await copyFile(info.outputPath('smoothness.json'), info.outputPath(`smoothness-${count}.json`))
      const measured = JSON.parse(await readFile(info.outputPath('smoothness.json'), 'utf8'))
      measurements.push({ count, samples: measured.samples })
      await context.close()
    }
  }
  const comparisons = measurements[1].samples.filter(sample => /:(deep-block|sort-ascending|select-all|facet-open|facet-search|filter|group)$/.test(sample.name)).map(large => {
    const small = measurements[0].samples.find(sample => sample.name === large.name)
    expect(small, large.name).toBeDefined()
    expect(small!.sqlStatements, large.name).not.toBeNull()
    expect(large.sqlStatements, large.name).not.toBeNull()
    return { name: large.name, small, large, growth: large.sqlStatements! - small!.sqlStatements! }
  })
  await writeFile(info.outputPath('query-growth.json'), JSON.stringify(comparisons, null, 2))
  // Same gestures/scopes must not produce queries proportional to five times
  // more cards. Small slack allows background identity/activity refresh SQL.
  for (const comparison of comparisons) expect(comparison.growth, comparison.name).toBeLessThanOrEqual(8)
})
