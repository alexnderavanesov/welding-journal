import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

test.beforeAll(async () => {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        project_title, subtitle_code, line, joint, weld_date, connection_type,
        officiality, revision_actuality, has_vik, psto_required, stamp_1_k
      ) select 'E2E filter', 'FILTER', 'FILTER-' || lpad(((n - 1) / 4 + 1)::text, 2, '0'),
        'F' || (n + 1000)::text, '2026-09-01', 'С17', 'действующий', 'актуальная', 'да', 'да', 'K1'
        from generate_series(1, 120) n
    `)
  })
})

for (const [path, pageRpc] of [
  ['/journal', 'listWeldingJournalPage'], ['/lnk', 'listLnkReportPage'], ['/psto', 'listHeatTreatmentReportPage'],
]) test(`${path}: фильтр не мигает и сохраняет фокус при выборе всех и очистке`, async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  let documentLoads = 0
  let blockNextPage = false
  let pageBlocked = false
  let releasePage!: () => void
  const pageGate = new Promise<void>((resolve) => { releasePage = resolve })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentLoads++
    const name = rpcName(request.url())
    if (name) requests.push(name)
  })
  await page.route('**/_serverFn/**', async (route) => {
    if (blockNextPage && rpcName(route.request().url()).startsWith(pageRpc + '_')) {
      blockNextPage = false
      pageBlocked = true
      await pageGate
    }
    await route.continue()
  })
  const count = (name: string) => requests.filter((value) => value.startsWith(name + '_')).length
  try {
    await page.goto(path!)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Линия. Открыть фильтр', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Фильтр: Линия' })
    const search = dialog.getByPlaceholder('Найти значение')
    await expect(dialog.getByRole('button', { name: /FILTER-01/ })).toBeVisible()
    await search.fill('FILTER-')
    const list = dialog.locator('.max-h-60')
    await list.evaluate(async (element) => {
      element.scrollTop = 210
      // The captured scroll event repositions the anchored menu asynchronously.
      // Measure the baseline after that event, not in the frame before it runs.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    const initial = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, height: document.documentElement.scrollHeight }))
    const initialMenu = (await dialog.boundingBox())!
    const initialOptionsRequests = count('listWeldColumnFilterOptions')
    const initialPageRequests = count(pageRpc!)
    blockNextPage = true

    await dialog.getByRole('button', { name: 'Выбрать все', exact: true }).click()
    await expect.poll(() => pageBlocked).toBe(true)
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('FILTER-')
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(initial.height)
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: initial.x, y: initial.y })
    expect(await list.evaluate((element) => element.scrollTop)).toBe(210)
    expect((await dialog.boundingBox())!.y).toBeCloseTo(initialMenu.y, 0)

    releasePage()
    await page.waitForLoadState('networkidle')
    await expect(search).toBeFocused()
    await expect(dialog.getByRole('button', { name: /FILTER-01/ })).toHaveAttribute('aria-pressed', 'true')
    expect(count(pageRpc!)).toBe(initialPageRequests + 1)
    expect(count('listWeldColumnFilterOptions')).toBe(initialOptionsRequests)

    await dialog.getByRole('button', { name: 'Очистить', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: /FILTER-01/ })).toHaveAttribute('aria-pressed', 'false')
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: initial.x, y: initial.y })
    expect(count('listWeldColumnFilterOptions')).toBe(initialOptionsRequests)
    expect(documentLoads).toBe(1)
    expect(errors).toEqual([])
  } finally {
    releasePage()
  }
})
