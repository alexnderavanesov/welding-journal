import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E checkbox focused copy'
test.beforeAll(async () => { await withLineProgramFixture(db => db.query(`insert into weld_joints
  (project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,psto_required)
  select $1,'COPY','COPY-LINE','F'||n,'2026-10-01','действующий','актуальная','да','да'
  from generate_series(1,6) n`, [project])) })
test.afterAll(() => cleanupLineProgramProjects([project]))

for (const route of ['journal', 'lnk', 'psto']) test(`${route}: copy a real range starting on a checkbox while native focus stays on that checkbox`, async ({ page, context, browserName }) => {
  if (browserName === 'webkit') {
    // WebKit's automation does not grant native clipboard permissions. Only
    // that transport is substituted; pointer, keys and server copy stay real.
    await page.addInitScript(() => {
      let copied = ''
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text: string) => { copied = text }, readText: async () => copied,
      } })
    })
  } else await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/' + route)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText('Найдено: 6', { exact: true })).toBeVisible()
  await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await page.evaluate(() => navigator.clipboard.writeText('before-copy'))
  const first = await page.locator('.ag-row[row-index="0"] .journal-server-checkbox input').boundingBox()
  const last = await page.locator('.ag-row[row-index="2"] .ag-cell[col-id="line"]').boundingBox()
  expect(first).not.toBeNull(); expect(last).not.toBeNull()
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2)
  await page.mouse.down()
  await page.mouse.move(last!.x + 20, last!.y + last!.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.ag-cell-range-selected')).toHaveCount(6)
  await expect(page.locator('.journal-server-checkbox input:focus')).toHaveCount(1)
  const copies: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name.startsWith('copyJournalGridRange_')) copies.push(name) })
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replaceAll('\r\n', '\n'))).toBe('COPY-LINE\nCOPY-LINE\nCOPY-LINE')
  expect(copies).toHaveLength(1)
  // A portal's filter checkbox is not a table selection checkbox. Copy must
  // not reuse the underlying range while that popup owns keyboard focus.
  await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  const filter = page.locator('.journal-filter')
  await expect(filter).toBeVisible()
  await filter.getByRole('checkbox').first().focus()
  await page.evaluate(() => navigator.clipboard.writeText('filter-copy-unchanged'))
  await page.keyboard.press('ControlOrMeta+c')
  await page.waitForLoadState('networkidle')
  expect(copies).toHaveLength(1)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('filter-copy-unchanged')
})
