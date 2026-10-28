import { expect, test, type Request } from '@playwright/test'

import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'
import { captureFullReportPrint } from '../report-print-capture'
import { captureReportExcel } from '../report-excel-capture'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.open = () => { throw new Error('Unexpected popup') } })
})

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query(`delete from weld_joints where project_title = 'E2E-OUTPUT'`)
    await invalidateDerivedIndexes(client)
  })
})

test('special LNK output previews in a modal and contains rows beyond the candidate limit', async ({ page }) => {
  test.setTimeout(120_000)
  const calls: string[] = []
  const pending = new Set<Request>()
  page.on('request', request => {
    if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pending.add(request) }
  })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, joint, spool,
        officiality, connection_type, d1, d2, t1, t2, wdi,
        has_vik, psto_required, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      )
      select
        '2026-08-01', 'E2E-OUTPUT', 'E2E-OUTPUT-SUB', 'E2E-OUTPUT-L1',
        'E2E-OUTPUT-' || lpad(series::text, 3, '0'), 'E2E-OUTPUT-SPOOL',
        'действующий', 'СШ', 108, 108, 4, 4, 0.42,
        'да', 'нет', 'ожидает заявку', now(), now(), now()
      from generate_series(1, 501) as series
    `)
    await invalidateDerivedIndexes(client)
  })

  await page.goto('/lnk')
  // The fixture invalidates the dispatcher; its one initial refresh can also
  // refresh the report. Settle that load before measuring preview-only traffic.
  await expect(page.getByLabel('Диспетчер задач', { exact: true })).toContainText('Изменения выполняются только после подтверждения.')
  await expect.poll(() => pending.size).toBe(0)
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()

  await page.getByRole('button', { name: 'Ожидание заявки', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
  const popup = preview.frameLocator('iframe')

  await expect(popup.getByRole('heading', { name: 'Ожидание заявки' })).toBeVisible()
  await expect(popup.locator('tbody tr')).toHaveCount(100)
  const loadedCalls = calls.length
  await expect(popup.getByText('E2E-OUTPUT-501', { exact: true })).toHaveCount(0)
  for (let index = 0; index < 5; index++) await preview.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(popup.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
  await expect.poll(() => popup.locator('tbody tr').count()).toBeLessThanOrEqual(100)
  await captureFullReportPrint(page)
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => { delete document.body.dataset.fullPrint })
    await preview.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').rows ?? 0)).toBeGreaterThan(500)
    await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
    await expect(popup.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
  }

  const downloadPromise = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Скачать Excel' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('lnk-waiting-request.xlsx')
  expect(await download.failure()).toBeNull()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  await page.waitForLoadState('networkidle')
  // Printing returns focus to the app. Only the compact dispatcher version
  // probe is allowed; unchanged data must not reload reports/tasks or recalculate.
  const printCalls = calls.slice(loadedCalls)
  expect(printCalls.every(name => name.startsWith('getDispatcherTaskVersion'))).toBe(true)
  expect(printCalls.length).toBeLessThanOrEqual(3) // two prints and one explicit return
  await preview.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E-OUTPUT-501')
  await expect(page.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()

  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const currentPopup = preview.frameLocator('iframe')
  await expect(currentPopup.getByRole('heading', { name: 'ЛНК: текущая версия' })).toBeVisible()
  await expect(currentPopup.locator('tbody tr')).toHaveCount(1)
  await expect(currentPopup.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
})

test('a very large report limits only preview and exports every row; narrowed current report still opens', async ({ page }) => {
  test.setTimeout(120_000)
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, joint, spool,
        officiality, connection_type, d1, d2, t1, t2, wdi,
        has_vik, psto_required, final_status
      )
      select
        '2026-08-01', 'E2E-OUTPUT', 'E2E-OUTPUT-SUB', 'E2E-OUTPUT-L1',
        'E2E-OUTPUT-' || lpad(series::text, 5, '0'), 'E2E-OUTPUT-SPOOL',
        'действующий', 'СШ', 108, 108, 4, 4, 0.42,
        'да', 'нет', 'ожидает заявку'
      from generate_series(1, 10001) as series
    `)
    await invalidateDerivedIndexes(client)
  })

  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Ожидание заявки', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
  await expect(modal.getByText(/Предпросмотр ограничен первыми 2000 строками/)).toBeVisible()
  const workbook = await captureReportExcel(page, modal)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  expect(Object.values(sheet).some(cell => cell?.v === 'E2E-OUTPUT-10001')).toBe(true)
  expect(Number(sheet['!ref']?.match(/(\d+)$/)?.[1])).toBeGreaterThan(10001)
  await page.getByRole('button', { name: 'Закрыть предпросмотр' }).click()

  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E-OUTPUT-10001')
  await expect(page.getByText('E2E-OUTPUT-10001', { exact: true })).toBeVisible()
  // Old rows can remain visible while a refreshed dispatcher/filter context is
  // pending. Current-report export deliberately refuses that stale context.
  await expect(page.getByLabel('Диспетчер задач', { exact: true })).toContainText('Изменения выполняются только после подтверждения.')
  await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const popup = page.getByRole('dialog', { name: 'Предпросмотр отчёта' }).frameLocator('iframe')
  await expect(popup.locator('tbody tr')).toHaveCount(1)
  await expect(popup.getByText('E2E-OUTPUT-10001', { exact: true })).toBeVisible()
})

async function invalidateDerivedIndexes(client: Parameters<Parameters<typeof withE2eDatabase>[0]>[0]) {
  await client.query(`
    update dispatcher_task_index_state
    set source_revision = source_revision + 1, dirty_scopes = '[]', full_rebuild = true, updated_at = now()
  `)
  await client.query(`
    update derived_calculation_state
    set source_revision = source_revision + 1, updated_at = now()
  `)
  await client.query(`delete from derived_calculation_cache`)
}

for (const [path, options] of [
  ['/journal', ['Текущая версия', 'Системная версия', 'Ожидает сварку', 'Ожидает заявки', 'Ожидает контроль', 'Ожидает ремонт', 'Отмененные годные результаты']],
  ['/lnk', ['Текущая версия', 'Ожидание заявки', 'Ожидание НК', 'Показать заключения']],
  ['/psto', ['Текущая версия', 'Ожидает заявку ПСТО', 'Результаты ПСТО']],
] as const) {
  test(`all Show options preview and print in the app: ${path}`, async ({ page }) => {
    const errors: string[] = [], calls: string[] = []
    const pending = new Set<Request>()
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pending.add(request) }
    })
    page.on('requestfinished', request => pending.delete(request))
    page.on('requestfailed', request => pending.delete(request))
    // Exercise full printing even when this file runs without earlier suites'
    // records. Other output modes also cover short and empty reports.
    await withE2eDatabase(async client => {
      await client.query(`insert into weld_joints (
        weld_date, project_title, subtitle_code, line, joint, officiality,
        has_vik, psto_required, final_status, lnk_created_at, psto_created_at
      ) select '2026-08-01', 'E2E-OUTPUT', 'E2E-OUTPUT-SUB', 'E2E-OUTPUT-L1',
        'F' || (980000 + series)::text, 'действующий', 'да', 'да', 'ожидает заявку', now(), now()
      from generate_series(1, 125) series`)
      await invalidateDerivedIndexes(client)
    })
    await page.goto(path)
    // Fixture invalidation starts a dispatcher refresh and then a report refresh.
    // Trace showed that final report request occurring before the focus event,
    // inside the print-only measurement. Wait for initial data, not a fixed delay.
    await expect(page.getByLabel('Диспетчер задач', { exact: true })).toContainText('Изменения выполняются только после подтверждения.')
    await expect.poll(() => pending.size).toBe(0)
    await captureFullReportPrint(page)
    const show = page.locator('header').getByRole('button', { name: 'Показать', exact: true })
    for (const option of options) {
      await show.click()
      await page.getByRole('button', { name: option, exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
      const frame = modal.frameLocator('iframe')
      await expect(frame.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(modal.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeEnabled()
      // Parent-owned wheel handlers need this flag in WebKit; document scripts
      // remain forbidden by CSP (execution/network are tested in preview-layout).
      expect(await modal.locator('iframe').getAttribute('sandbox')).not.toContain('allow-top-navigation')
      await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]').first()).toHaveAttribute('content', /script-src 'none'/)
      const before = calls.length
      const paginated = await modal.getByRole('button', { name: 'Далее', exact: true }).count() > 0
      if (option === 'Текущая версия') expect(paginated).toBe(true)
      const totalRows = paginated
        ? Number((await modal.getByText(/^Показаны /).textContent())?.match(/из (\d+)\./)?.[1] ?? 0)
        : await frame.locator('tbody tr').count()
      await page.evaluate(() => { delete document.body.dataset.fullPrint })
      await modal.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
      await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').rows ?? -1)).toBe(totalRows)
      await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
      await expect(frame.locator('tbody tr')).toHaveCount(paginated ? 100 : totalRows)
      if (paginated) expect(totalRows).toBeGreaterThan(100)
      // The preview itself stays local. Returning focus may only probe the
      // dispatcher version, never reload unchanged reports or task snapshots.
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
      await frame.locator('body').press('Escape')
      await expect(modal).toHaveCount(0)
      await expect(show).toBeFocused()
      await page.waitForLoadState('networkidle')
      const printCalls = calls.slice(before)
      expect(printCalls.every(name => name.startsWith('getDispatcherTaskVersion'))).toBe(true)
      expect(printCalls.length).toBeLessThanOrEqual(2) // print and explicit return
    }
    expect(errors).toEqual([])
  })
}

test('statistics PDF uses the same preview and does not open another tab', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/statistics')
  const trigger = page.getByRole('button', { name: 'Отчет PDF' })
  await trigger.click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
  await expect(modal.frameLocator('iframe').getByRole('heading', { level: 1 })).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeEnabled()
  await page.screenshot({ path: 'outputs/statistics-report-preview.png' })
  await modal.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await expect(trigger).toBeFocused()
  expect(errors).toEqual([])
})

test('every statistics tab downloads styled Excel with the same badges and no new report requests', async ({ page }) => {
  const calls: string[] = [], errors: string[] = []
  const pending = new Set<Request>()
  page.on('request', request => { if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pending.add(request) } })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/statistics')
  for (const [index, tab] of ['Общая', 'ЛНК', 'ПСТО', 'Сварщики', 'Полинейная сводка'].entries()) {
    await page.getByRole('main').getByRole('button', { name: tab, exact: true }).click()
    await expect.poll(() => pending.size).toBe(0)
    const before = calls.length
    await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
    await expect(modal.frameLocator('iframe').locator('.metric').first()).toBeVisible()
    const book = await captureReportExcel(page, modal, `outputs/print-limit-statistics-${index}.xlsx`)
    expect(book.SheetNames.length).toBeGreaterThan(1)
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await expect.poll(() => pending.size).toBe(0)
    expect(calls.slice(before)).toEqual([])
    await modal.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  }
  expect(errors).toEqual([])
})

for (const path of ['/journal', '/lnk', '/psto']) {
  test(`1001 rows: print refused, keyboard safe, full Excel available: ${path}`, async ({ page }) => {
    test.setTimeout(120_000)
    await withE2eDatabase(async db => {
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,
        revision_actuality,connection_type,has_vik,psto_required,lnk_created_at,psto_created_at)
        select 'E2E-OUTPUT','LIMIT','LIMIT','PRINT-LIMIT-'||lpad(n::text,4,'0'),'2026-09-01','действующий',
          'актуальная','С17','да','да',now(),now() from generate_series(1,1001) n`)
      await invalidateDerivedIndexes(db)
    })
    const calls: string[] = []
    const pendingRequests = new Set<Request>()
    let lastRpc = 0
    page.on('request', request => { if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pendingRequests.add(request); lastRpc = Date.now() } })
    const finished = (request: Request) => { if (pendingRequests.delete(request)) lastRpc = Date.now() }
    page.on('requestfinished', finished)
    page.on('requestfailed', finished)
    const settle = () => expect.poll(() => pendingRequests.size === 0 && Date.now() - lastRpc >= 500).toBe(true)
    await page.goto(path)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('PRINT-LIMIT-')
    await expect(page.getByText('PRINT-LIMIT-0001', { exact: true })).toBeVisible()
    await settle()
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
    await expect(modal.frameLocator('iframe').locator('tbody tr')).toHaveCount(100)
    await expect(modal.getByRole('status')).toContainText('В отчёте 1001 строк')
    await expect(modal.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
    await settle()
    const before = calls.length
    await page.keyboard.press('Control+p')
    await modal.frameLocator('iframe').locator('body').press('Meta+p')
    await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
    await modal.getByRole('button', { name: 'Далее', exact: true }).click()
    await expect(modal.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
    const pending = page.waitForEvent('download')
    await modal.getByRole('button', { name: 'Скачать Excel' }).click()
    const downloaded = await pending
    expect(await downloaded.failure()).toBeNull()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(modal.getByRole('status')).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Скачать Excel' })).toBeVisible()
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await settle()
    expect(calls.slice(before).every(name => name.startsWith('getDispatcherTaskVersion'))).toBe(true)
    expect(calls.length - before).toBeLessThanOrEqual(1)
    await modal.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  })
}
