import { open } from 'node:fs/promises'
import { expect, test, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { captureFullReportPrint } from '../report-print-capture'
import { rpcName } from '../rpc'
import { sampleLocalAuditResources } from '../audit-resources'
import { auditSqlCount } from '../audit-sql'

// Deliberately opt-in: exercise the real supported output boundary, not an
// unreachable 200k-row call to the pure workbook builder. Use e2e/run.ts alone.
test('10000 строк: настоящий широкий предпросмотр и скачивание Excel', async ({ page, browser }, info) => {
  test.skip(process.env.AUDIT_REPORT_BOUNDARY !== '1', 'Separate isolated browser/load run')
  test.setTimeout(240_000)
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int as n from weld_joints')).rows[0].n).toBe(1)
    await db.query(`insert into weld_joints(project_title,line,joint,weld_date,officiality,revision_actuality,
      connection_type,has_vik,vik_result,vik_conclusion_date,vik_conclusion)
      select 'E2E output boundary','BOUNDARY','MAX-EXPORT-F'||lpad(n::text,5,'0'),'2026-09-01',
        'действующий','актуальная','С17','да','годен','2026-09-02','VIK-BOUNDARY'
      from generate_series(1,10000) n`)
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('crash', () => errors.push('Browser page crashed'))
  const calls: string[] = []
  const pending = new Set<Request>()
  let lastRpc = 0
  const settleRpc = () => expect.poll(() => pending.size === 0 && Date.now() - lastRpc >= 500, { timeout: 60_000 }).toBe(true)
  const transfers: Array<Promise<{ name: string; bytes: number }>> = []
  page.on('request', request => {
    if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pending.add(request); lastRpc = Date.now() }
  })
  const finished = (request: Request) => { if (pending.delete(request)) lastRpc = Date.now() }
  page.on('requestfinished', finished)
  page.on('requestfailed', finished)
  page.on('requestfinished', request => {
    if (request.url().includes('/_serverFn/')) transfers.push(request.sizes().then(size => ({ name: rpcName(request.url()), bytes: size.responseBodySize })))
  })
  const stopSampling = await sampleLocalAuditResources(browser)
  try {
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('MAX-EXPORT-')
    await expect(page.getByText('MAX-EXPORT-F00001', { exact: true })).toBeVisible()
    await settleRpc()
    const beforePreview = calls.length
    const sqlBeforePreview = await auditSqlCount()
    const started = Date.now()
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    const table = dialog.frameLocator('iframe').locator('table')
    await expect(table.locator('tbody tr')).toHaveCount(100, { timeout: 120_000 })
    await expect(table.locator('thead th')).toHaveCount(111)
    // iframe document.write does not promise Playwright's global networkidle.
    // Wait for the actual RPCs and visible table, not that synthetic load event.
    await settleRpc()
    const afterPreview = calls.length
    const previewMilliseconds = Date.now() - started
    const sqlAfterPreview = await auditSqlCount()
    if (sqlAfterPreview !== undefined && sqlBeforePreview !== undefined) expect(sqlAfterPreview - sqlBeforePreview).toBeLessThanOrEqual(80)
    expect(afterPreview - beforePreview).toBeLessThanOrEqual(5)
    console.log(JSON.stringify({ workflow: '10000 x 111 browser preview', milliseconds: previewMilliseconds }))
    await stopSampling.checkpoint('preview')
    await page.screenshot({ path: info.outputPath('paginated-report-preview.png') })
    await captureFullReportPrint(page)
    await expect(dialog.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
    await expect(dialog.getByRole('status')).toContainText('В отчёте 10000 строк')
    await page.keyboard.press('Control+p')
    await table.locator('tbody').press('Meta+p')
    expect(await page.evaluate(() => document.body.dataset.fullPrint)).toBeUndefined()
    await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
    await expect(table.locator('tbody tr')).toHaveCount(100)
    await stopSampling.checkpoint('print refused before full DOM')
    const downloading = Date.now()
    const downloaded = page.waitForEvent('download', { timeout: 90_000 })
    await dialog.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
    const download = await downloaded
    expect(await download.failure()).toBeNull()
    const path = await download.path()
    expect(path).toBeTruthy()
    const file = await open(path!, 'r')
    try {
      const { size } = await file.stat()
      const start = Buffer.alloc(4), end = Buffer.alloc(Math.min(size, 100_000))
      await file.read(start, 0, 4, 0)
      await file.read(end, 0, end.length, size - end.length)
      expect(start.toString('hex')).toBe('504b0304')
      expect(end.toString()).toContain('MAX-EXPORT-F10000')
      console.log(JSON.stringify({ workflow: '10000 x 111 browser download', milliseconds: Date.now() - downloading, bytes: size }))
    } finally { await file.close() }
    await stopSampling.checkpoint('excel')
    await dialog.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
    await expect(dialog).toBeHidden()
    await settleRpc()
    const localOutputCalls = calls.slice(afterPreview)
    expect(localOutputCalls.every(name => name.startsWith('getDispatcherTaskVersion'))).toBe(true)
    expect(localOutputCalls.length).toBeLessThanOrEqual(1)
    const beforeReopen = calls.length
    const sqlBeforeReopen = await auditSqlCount()
    // A focus probe is security + version (2 SELECTs), plus at most two
    // release-readiness metadata reads when its shared five-second TTL expires.
    if (sqlBeforeReopen !== undefined && sqlAfterPreview !== undefined) expect(sqlBeforeReopen - sqlAfterPreview).toBeLessThanOrEqual(4)
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    await expect(table.locator('tbody tr')).toHaveCount(100)
    await expect(table.locator('thead th')).toHaveCount(111)
    await settleRpc()
    expect(calls.length - beforeReopen).toBeLessThanOrEqual(5)
    const sqlAfterReopen = await auditSqlCount()
    if (sqlAfterReopen !== undefined && sqlBeforeReopen !== undefined) expect(sqlAfterReopen - sqlBeforeReopen).toBeLessThanOrEqual(80)
    await dialog.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
    await expect(dialog).toBeHidden()
    console.log(JSON.stringify({ workflow: 'wide output request bounds and reopen', previewCalls: calls.slice(beforePreview, afterPreview), localOutputCalls, reopenCalls: calls.slice(beforeReopen) }))
    const transferred = await Promise.all(transfers)
    const snapshots = transferred.filter(call => /^(get|refresh)DispatcherTaskSnapshot/.test(call.name))
    expect(snapshots.length).toBeGreaterThan(0)
    // Same fixture previously sent 11.9 MB for its 5000-task snapshot. Keep at
    // least a twofold transport reduction without lowering task/page limits.
    for (const snapshot of snapshots) expect(snapshot.bytes).toBeLessThan(6_000_000)
    console.log(JSON.stringify({ workflow: 'wide output SQL and transfer', sqlBeforePreview, sqlAfterPreview, sqlBeforeReopen, sqlAfterReopen, transfers: transferred }))
    expect(errors).toEqual([])
  } finally {
    const resources = await stopSampling()
    console.log(JSON.stringify({ workflow: 'wide output sampled resources', ...resources }))
    expect(resources.errors).toEqual([])
  }
})

test('1000 строк: разрешённая широкая печать целиком', async ({ page, browser }) => {
  test.skip(process.env.AUDIT_REPORT_PRINT_LIMIT !== '1', 'Separate isolated allowed-print run')
  test.setTimeout(180_000)
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int as n from weld_joints')).rows[0].n).toBe(1)
    await db.query(`insert into weld_joints(project_title,line,joint,weld_date,officiality,revision_actuality,
      connection_type,has_vik,vik_result,vik_conclusion_date,vik_conclusion)
      select 'E2E output allowed','BOUNDARY','ALLOWED-PRINT-F'||lpad(n::text,4,'0'),'2026-09-01',
        'действующий','актуальная','С17','да','годен','2026-09-02','VIK-BOUNDARY'
      from generate_series(1,1000) n`)
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const sampling = await sampleLocalAuditResources(browser)
  try {
    await page.goto('/journal')
    const filteredRows = page.waitForResponse(response => rpcName(response.url()).startsWith('readJournalGrid_') &&
      Boolean(response.request().postData()?.includes('ALLOWED-PRINT-')))
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('ALLOWED-PRINT-')
    await (await filteredRows).finished()
    await expect(page.getByText('ALLOWED-PRINT-F0001', { exact: true })).toBeVisible()
    // This same row is present before filtering. Its visibility alone can be
    // the inert placeholder; wait for the actual current rows, not the totals.
    await expect(page.locator('[data-welding-journal-grid] .journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
    const started = Date.now()
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
    await expect(dialog.frameLocator('iframe').locator('tbody tr')).toHaveCount(100)
    const previewMilliseconds = Date.now() - started
    await sampling.checkpoint('preview 1000 x 111')
    await captureFullReportPrint(page)
    const printing = Date.now()
    await dialog.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').rows)).toBe(1000)
    const printed = await page.evaluate(() => JSON.parse(document.body.dataset.fullPrint!))
    expect(printed.columns).toBe(111)
    expect(printed.minColumns).toBe(111)
    expect(printed.maxColumns).toBe(111)
    expect(printed.lastRow).toContain('ALLOWED-PRINT-F1000')
    console.log(JSON.stringify({ workflow: '1000 x 111 allowed print DOM', previewMilliseconds, printMilliseconds: Date.now() - printing, cellNodes: printed.cellNodes }))
    await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
    await sampling.checkpoint('printed 1000 x 111')
    await dialog.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
    expect(errors).toEqual([])
  } finally {
    const resources = await sampling()
    console.log(JSON.stringify({ workflow: 'allowed print sampled resources', ...resources }))
    expect(resources.errors).toEqual([])
  }
})
