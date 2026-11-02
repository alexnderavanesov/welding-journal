import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { eq, asc } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { revealJournalColumn } from '../journal-grid'

const project = 'E2E report group session'
test.beforeAll(async () => {
 await withLineProgramFixture(async db => {
  await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,psto_required,has_vik,officiality,revision_actuality,vik_request,vik_request_date,vik_result)
    select $1,'SESSION','SESSION-'||lpad(((n-1)/2)::text,4,'0'),'F'||n,'2026-10-01','да','да','действующий','актуальная',
      case when n<=20 then 'Session request '||n end,case when n<=20 then '2026-10-02'::date end,case when n<=20 then 'ожидает НК' end
      from generate_series(1,2000) n`, [project])
  await db.query(`with docs as (
    insert into generated_documents(type,title,file_name,mime_type,row_count,source_metadata)
    select 'weldingJournal','Session document '||n,'session.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,
      jsonb_build_object('projects',jsonb_build_array($1::text),'subtitleCodes',jsonb_build_array('SESSION'),'lines',jsonb_build_array('SESSION-'||lpad(((n-1)/2)::text,4,'0')))
      from generate_series(1,20) n returning id,title
  ) insert into generated_document_weld_joints(document_id,weld_joint_id)
    select docs.id,w.id from docs join weld_joints w on w.project_title=$1 and w.joint='F'||split_part(docs.title,' ',3)`, [project])
 })
 await requireDb().transaction(async tx => {
   const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project)).orderBy(asc(weldJoints.id)).limit(20)
   await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
 })
})
test.afterAll(() => cleanupLineProgramProjects([project]))

const surfaces = [
  { path: '/journal', name: 'Сварочный журнал', root: '[data-weld-report-grid="weldingJournal"]', storage: 'welding-journal-ag-grid:v1' },
  { path: '/lnk', name: 'ЛНК', root: '[data-weld-report-grid="lnk"]', storage: 'lnk-ag-grid:v1' },
  { path: '/psto', name: 'ПСТО и ТВМТ', root: '[data-weld-report-grid="heatTreatment"]', storage: 'psto-ag-grid:v1' },
  { path: '/documents', name: 'Документы', root: '[data-document-history-grid="generated:weldingJournal"]', storage: 'welding-journal:documents:grid:v1:generated:weldingJournal' },
  { path: '/documents', name: 'Документы', root: '[data-document-history-grid^="system:lnkRequest:"]', storage: 'welding-journal:documents:grid:v1:system:lnkRequest:lnk', system: true },
] as const
const group = (root: Locator, key: string) => root.locator('.ag-row-group.ag-row-level-0').filter({ hasText: key }).first()
async function command(page: Page, row: Locator, name: string) {
  await row.click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name, exact: true }).click()
}
async function switchReport(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name, exact: true }).click()
}
for (const surface of surfaces) test(`group session: ${surface.storage} restores all, exceptions, individual groups and collapsed state`, async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = [], reads: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const name = rpcName(request.url()); if (/readJournalGrid|list(RemoteGenerated|System)DocumentHistoryGrid/.test(name)) reads.push(name) })
  await page.addInitScript(({ storage }) => localStorage.setItem(storage, JSON.stringify({ columns: [{ colId: 'line', rowGroup: true, rowGroupIndex: 0 }], views: [] })), { storage: surface.storage })
  await page.goto(surface.path)
  if ('system' in surface) await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  const root = page.locator(surface.root)
  // Other ordinary-suite fixtures legitimately remain in the same database.
  // Keep all 1000 test groups, but do not assume their first group is still
  // visible after preceding unrelated groups have been expanded on return.
  if (surface.path === '/documents') {
    await page.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill('system' in surface ? 'Session request' : 'Session document')
    await expect(root.getByText('Найдено: 20', { exact: true })).toBeVisible()
  } else {
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    await expect(root.getByText('Найдено: 2000', { exact: true })).toBeVisible()
    await expect(root.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  }
  const a = group(root, 'SESSION-0000'), b = group(root, 'SESSION-0001')
  await expect(a).toHaveAttribute('aria-expanded', 'false')
  await command(page, a, 'Развернуть все')
  await expect(a).toHaveAttribute('aria-expanded', 'true')
  await expect(b).toHaveAttribute('aria-expanded', 'true')
  await command(page, a, 'Свернуть')
  await expect(a).toHaveAttribute('aria-expanded', 'false')
  const away = surface.path === '/journal' ? 'ЛНК' : 'Сварочный журнал'
  await switchReport(page, away)
  await expect(root).toHaveCount(0)
  const start = reads.length
  await switchReport(page, surface.name)
  if ('system' in surface) await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  await expect(a).toHaveAttribute('aria-expanded', 'false')
  await expect(b).toHaveAttribute('aria-expanded', 'true')
  await page.waitForLoadState('networkidle')
  const reopenedReads = reads.length - start
  // Even with 1000 groups, returning must only request visible blocks.
  expect(reopenedReads).toBeGreaterThan(0)
  expect(reopenedReads).toBeLessThan(20)
  await command(page, a, 'Свернуть все')
  await expect(b).toHaveAttribute('aria-expanded', 'false')
  await command(page, b, 'Развернуть')
  await switchReport(page, away)
  await switchReport(page, surface.name)
  if ('system' in surface) await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  await expect(a).toHaveAttribute('aria-expanded', 'false')
  await expect(b).toHaveAttribute('aria-expanded', 'true')
  await command(page, a, 'Свернуть все')
  await switchReport(page, away)
  await switchReport(page, surface.name)
  if ('system' in surface) await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  await expect(a).toHaveAttribute('aria-expanded', 'false')
  await expect(b).toHaveAttribute('aria-expanded', 'false')
  if (surface.path === '/journal') {
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByText('Найдено: 2000', { exact: true })).toBeVisible()
    await revealJournalColumn(page, 'projectTitle')
    await root.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    await expect(a).toHaveAttribute('aria-expanded', 'false')
    await command(page, b, 'Развернуть')
    const nested = root.locator('.ag-row-group.ag-row-level-1').filter({ hasText: project }).first()
    await command(page, nested, 'Развернуть')
    await switchReport(page, away)
    await switchReport(page, surface.name)
    await expect(b).toHaveAttribute('aria-expanded', 'true')
    await expect(nested).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toHaveValue(project)
  }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('restored-visible-block-requests.json'), JSON.stringify({ report: surface.storage, reopenedReads }))
})

test('group session: page reload ends bulk expansion memory', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const pending = new Set<unknown>()
  let lastActivity = Date.now()
  page.on('request', request => { if (request.url().includes('/_serverFn/')) { pending.add(request); lastActivity = Date.now() } })
  const settled = (request: unknown) => { if (pending.delete(request)) lastActivity = Date.now() }
  page.on('requestfinished', settled); page.on('requestfailed', settled)
  await page.addInitScript(() => localStorage.setItem('welding-journal-ag-grid:v1', JSON.stringify({ columns: [{ colId: 'line', rowGroup: true, rowGroupIndex: 0 }], views: [] })))
  await page.goto('/journal')
  const root = page.locator('[data-weld-report-grid="weldingJournal"]'), a = group(root, 'SESSION-0000')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(root.getByText('Найдено: 2000', { exact: true })).toBeVisible()
  await expect(a).toHaveAttribute('aria-expanded', 'false')
  await command(page, a, 'Развернуть все')
  await expect(root.locator('.ag-row[row-index="1"][row-id]:not(.ag-row-group):not(.ag-row-loading)').first()).toBeVisible()
  // The document's networkidle lifecycle can have fired before the deferred
  // group loads. Wait for actual RPC settlement before testing a clean reload.
  await expect(root.locator('.ag-row-loading')).toHaveCount(0)
  await expect.poll(() => pending.size === 0 && Date.now() - lastActivity >= 250).toBe(true)
  await page.reload()
  await expect(a).toHaveAttribute('aria-expanded', 'false')
  expect(errors).toEqual([])
})

for (const surface of surfaces.filter(item => item.path !== '/documents')) test(`group context menu: ${surface.path} raw right click at the lower visible row edge`, async ({ page }, info) => {
  const idle = observeRpcIdle(page)
  await page.addInitScript(storage => localStorage.setItem(storage, JSON.stringify({ columns: [{ colId: 'line', rowGroup: true, rowGroupIndex: 0 }], views: [] })), surface.storage)
  await page.goto(surface.path)
  const root = page.locator(surface.root)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(root.getByText('Найдено: 2000', { exact: true })).toBeVisible()
  await expect(root.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await idle()
  await checkClippedMenu(page, root, info, '.ag-row-group.ag-row-level-0[row-id]', 'line')
})

for (const surface of surfaces.filter(item => item.path === '/journal' || item.path === '/documents')) test(`row context menu: ${surface.storage} raw right click at the lower visible row edge`, async ({ page }, info) => {
  const idle = observeRpcIdle(page)
  await page.setViewportSize({ width: 1600, height: 700 })
  await page.goto(surface.path)
  if ('system' in surface) await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  const root = page.locator(surface.root)
  if (surface.path === '/documents') {
    await page.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill('system' in surface ? 'Session request' : 'Session document')
    await expect(root.getByText('Найдено: 20', { exact: true })).toBeVisible()
  } else {
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    await expect(root.getByText('Найдено: 2000', { exact: true })).toBeVisible()
    await expect(root.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  }
  await idle()
  await checkClippedMenu(page, root, info, '.ag-row:not(.ag-row-group):not(.ag-row-loading)[row-id]', surface.path === '/documents' ? 'title' : 'line')
})

function observeRpcIdle(page: Page) {
  const pending = new Set<unknown>()
  let last = Date.now()
  page.on('request', request => { if (request.url().includes('/_serverFn/')) { pending.add(request); last = Date.now() } })
  const settled = (request: unknown) => { if (pending.delete(request)) last = Date.now() }
  page.on('requestfinished', settled); page.on('requestfailed', settled)
  // Footer totals can already match while a debounced search replaces rows.
  return () => expect.poll(() => pending.size === 0 && Date.now() - last >= 500, { timeout: 15_000 }).toBe(true)
}

async function checkClippedMenu(page: Page, root: Locator, info: TestInfo, rowSelector: string, columnId: string) {
  const rows = root.locator(`.ag-grid-scrolling-rows ${rowSelector}`)
  await expect(rows.first()).toBeVisible()
  await page.evaluate(() => scrollTo(0, 250))
  await page.waitForTimeout(150)
  await expect(rows.first()).toBeVisible()
  const geometry = (rowId?: string) => root.evaluate((element, { id, rowSelector, columnId }) => {
    const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
    const frame = element.querySelector('.journal-grid-frame')!.getBoundingClientRect()
    const vr = viewport.getBoundingClientRect()
    const bottom = Math.min(innerHeight, frame.bottom, vr.top + viewport.clientTop + viewport.clientHeight,
      element.querySelector('[data-journal-footer], .document-grid-footer')?.getBoundingClientRect().top ?? Infinity)
    const rows = Array.from(element.querySelectorAll<HTMLElement>(`.ag-grid-scrolling-rows ${rowSelector}`))
    const row = id ? rows.find(item => item.getAttribute('row-id') === id)! : rows.reduce((best, item) =>
      Math.abs(item.getBoundingClientRect().top - bottom) < Math.abs(best.getBoundingClientRect().top - bottom) ? item : best)
    const rect = row.getBoundingClientRect(), cell = row.querySelector(`.ag-cell[col-id="${columnId}"]`)!.getBoundingClientRect()
    const x = Math.min(cell.right, vr.right) - 20, y = Math.max(rect.top, vr.top) + 5
    const hit = document.elementFromPoint(x, y), hitCell = hit?.closest('.ag-cell')
    return { id: row.getAttribute('row-id')!, top: rect.top, rowBottom: rect.bottom, bottom, x, y,
      hit: hitCell?.closest('.ag-row') === row, scrollY, gridScroll: viewport.scrollTop,
      hitClass: hit?.getAttribute('class'), hitRow: hitCell?.closest('.ag-row')?.getAttribute('row-id'),
      clipping: ['.ag-grid-viewport', '.ag-body-viewport', '.ag-center-cols-viewport', '.ag-body-horizontal-scroll'].map(selector => {
        const item = element.querySelector<HTMLElement>(selector), box = item?.getBoundingClientRect()
        return { selector, top: box?.top, bottom: box?.bottom, height: box?.height, clientHeight: item?.clientHeight }
      }) }
  }, { id: rowId, rowSelector, columnId })
  let point = await geometry()
  // Only move the page as a user scroll would. Locator.click/scrollIntoView
  // can scroll the inner viewport before the click and invalidate this probe.
  for (let attempt = 0; attempt < 3; attempt++) {
    // The fixture's 54/56px rows allow a real click above the 16px horizontal
    // scrollbar while their centre still lies outside the scroll viewport.
    await page.evaluate(delta => scrollBy(0, delta), point.top - (point.bottom - 24))
    await page.waitForTimeout(100)
    point = await geometry(point.id)
    if (point.top < point.bottom - 4 && point.rowBottom > point.bottom + 4) break
  }
  expect(point.top).toBeLessThan(point.bottom - 4)
  expect(point.rowBottom).toBeGreaterThan(point.bottom + 4)
  expect((point.top + point.rowBottom) / 2).toBeGreaterThan(point.bottom + 1)
  await page.mouse.move(point.x, point.y)
  point = await geometry(point.id)
  await info.attach('raw-right-click-target', { body: JSON.stringify(point), contentType: 'application/json' })
  // Prove that hover did not put an overlay scrollbar over the click point.
  expect(point.hit).toBe(true)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  const menu = page.getByTestId('context-action-menu')
  await page.waitForTimeout(250)
  const after = await geometry(point.id)
  await info.attach('raw-right-click-geometry', { body: JSON.stringify({ before: point, after }), contentType: 'application/json' })
  await expect(menu).toBeVisible()
  expect(after.scrollY).toBe(point.scrollY)
  expect(after.gridScroll).toBe(point.gridScroll)
  expect(Math.abs(after.top - point.top)).toBeLessThanOrEqual(1)
  const focused = () => page.evaluate(() => {
    const cell = document.activeElement?.closest('.ag-cell'), row = cell?.closest('.ag-row')
    return { id: row?.getAttribute('row-id'), column: cell?.getAttribute('col-id'), index: Number(row?.getAttribute('row-index')) }
  })
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect.poll(focused).toMatchObject({ id: point.id, column: columnId })
  const index = (await focused()).index
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => (await focused()).index).toBe(index + 1)
  await page.keyboard.press('Shift+F10')
  await expect(menu).toBeVisible()
  // An actual later scroll must still dismiss the menu. A wheel gesture may
  // move DOM focus to its scroll surface, so it is not a keyboard-return test.
  const beforeWheel = await page.evaluate(() => scrollY)
  // Leaf menus are taller than group menus. Wheel outside either panel so
  // this gesture scrolls the report, not the menu's own list of commands.
  const wheelX = (await root.boundingBox())!.x + (await root.boundingBox())!.width - 30
  const menuBox = (await menu.boundingBox())!
  expect(wheelX).toBeGreaterThan(menuBox.x + menuBox.width)
  await page.mouse.move(wheelX, 350)
  await page.mouse.wheel(0, 120)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeWheel)
  await expect(menu).toBeHidden()
}
