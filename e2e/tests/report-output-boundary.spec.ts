import { stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { captureFullReportPrint } from '../report-print-capture'
import { rpcName } from '../rpc'
import { sampleLocalAuditResources } from '../audit-resources'
import { auditSqlCount, auditSqlSnapshot } from '../audit-sql'
import { ALL_JOURNAL_OUTPUT_HEADERS as expectedHeaders, showAllJournalOutputColumns } from '../report-output-contract'

const exec = promisify(execFile)

// Deliberately opt-in: exercise the real browser download, including 200k rows,
// independently of the bounded preview. Use e2e/run.ts alone.
const outputRows = Number(process.env.AUDIT_REPORT_BOUNDARY_ROWS || 10000)
const jointDigits = Math.max(5, String(outputRows).length)

test(`${outputRows} строк: настоящий широкий предпросмотр и скачивание Excel`, async ({ page, browser }, info) => {
  test.skip(process.env.AUDIT_REPORT_BOUNDARY !== '1', 'Separate isolated browser/load run')
  expect([1000, 2000, 5000, 10000, 200000]).toContain(outputRows)
  test.setTimeout(900_000)
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int as n from weld_joints')).rows[0].n).toBe(1)
    await db.query(`insert into weld_joints(project_title,line,joint,weld_date,officiality,revision_actuality,
      connection_type,has_vik,vik_result,vik_conclusion_date,vik_conclusion)
      select 'E2E output boundary','BOUNDARY','MAX-EXPORT-F'||lpad(n::text,$2::int,'0'),'2026-09-01',
        'действующий','актуальная','С17','да','годен','2026-09-02','VIK-BOUNDARY'
      from generate_series(1,$1::int) n`, [outputRows, jointDigits])
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('crash', () => errors.push('Browser page crashed'))
  const calls: string[] = []
  const rpcNames = new Map<string, string>()
  const pending = new Set<Request>()
  let lastRpc = 0
  const settleRpc = () => expect.poll(() => pending.size === 0 && Date.now() - lastRpc >= 500, { timeout: 60_000 }).toBe(true)
  const transfers: Array<Promise<{ name: string; bytes: number }>> = []
  page.on('request', request => {
    if (request.url().includes('/_serverFn/')) {
      const name = rpcName(request.url())
      calls.push(name); rpcNames.set(new URL(request.url()).pathname.split('/').at(-1)!, name)
      pending.add(request); lastRpc = Date.now()
    }
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
    await expect(page.getByText(`MAX-EXPORT-F${String(1).padStart(jointDigits, '0')}`, { exact: true })).toBeVisible({ timeout: 180_000 })
    await showAllJournalOutputColumns(page)
    await settleRpc()
    await stopSampling.checkpoint('initial journal and dispatcher')
    const beforePreview = calls.length
    const sqlBeforePreview = await auditSqlCount()
    const started = Date.now()
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    const table = dialog.frameLocator('iframe').locator('table')
    await expect(table.locator('tbody tr')).toHaveCount(100, { timeout: 120_000 })
    await expect(table.locator('thead th')).toHaveText(expectedHeaders)
    // iframe document.write does not promise Playwright's global networkidle.
    // Wait for the actual RPCs and visible table, not that synthetic load event.
    await settleRpc()
    const afterPreview = calls.length
    const localOutputStarted = Date.now()
    const previewMilliseconds = Date.now() - started
    const sqlAfterPreview = await auditSqlCount()
    if (sqlAfterPreview !== undefined && sqlBeforePreview !== undefined) expect(sqlAfterPreview - sqlBeforePreview).toBeLessThanOrEqual(80)
    expect(afterPreview - beforePreview).toBeLessThanOrEqual(5)
    console.log(JSON.stringify({ workflow: `${outputRows} x ${expectedHeaders.length} browser preview`, milliseconds: previewMilliseconds }))
    await stopSampling.checkpoint('preview')
    await page.screenshot({ path: info.outputPath('paginated-report-preview.png') })
    if (outputRows > 2000) await expect(dialog.getByText(/Предпросмотр ограничен первыми 2000 строками/)).toBeVisible()
    await captureFullReportPrint(page)
    if (outputRows > 1000) {
      await expect(dialog.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
      await expect(dialog.getByRole('status')).toContainText(`В отчёте ${outputRows} строк`)
      await page.keyboard.press('Control+p')
      await table.locator('tbody').press('Meta+p')
      expect(await page.evaluate(() => document.body.dataset.fullPrint)).toBeUndefined()
      await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
      await expect(table.locator('tbody tr')).toHaveCount(100)
      await stopSampling.checkpoint('print refused before full DOM')
    }
    const sqlBeforeDownload = await auditSqlCount()
    const downloading = Date.now()
    const downloaded = page.waitForEvent('download', { timeout: 90_000 })
    await dialog.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
    const download = await downloaded
    expect(await download.failure()).toBeNull()
    const downloadMilliseconds = Date.now() - downloading
    await stopSampling.checkpoint('excel')
    const path = await download.path()
    expect(path).toBeTruthy()
    const size = (await stat(path!)).size
    const { stdout } = await exec('python3', ['e2e/verify-report-workbook.py', path!, `MAX-EXPORT-F${String(outputRows).padStart(jointDigits, '0')}`])
    const workbook = JSON.parse(stdout)
    expect(workbook.dataRows).toBe(outputRows)
    expect(workbook).toMatchObject({ distinctJoints: outputRows, firstJoint: 1, lastJoint: outputRows })
    expect(workbook.found).toBe(true)
    expect(workbook.columns).toBe(expectedHeaders.length)
    expect(workbook.sheetHeaders).toEqual([expectedHeaders])
    const afterDownloadSql = await auditSqlSnapshot()
    const sqlAfterDownload = afterDownloadSql?.statements
    if (sqlBeforeDownload !== undefined && sqlAfterDownload !== undefined) expect(sqlAfterDownload - sqlBeforeDownload).toBeLessThanOrEqual(30 * Math.ceil(outputRows / 1000) + 20)
    console.log(JSON.stringify({ workflow: `${outputRows} x ${expectedHeaders.length} browser download`, milliseconds: downloadMilliseconds, withVerificationMilliseconds: Date.now() - downloading, bytes: size, sqlBeforeDownload, sqlAfterDownload, workbook }))
    await dialog.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
    await expect(dialog).toBeHidden()
    await settleRpc()
    const beforeReopenSql = await auditSqlSnapshot()
    const sqlBeforeReopen = beforeReopenSql?.statements
    const localOutputCalls = calls.slice(afterPreview)
    const localOutputMilliseconds = Date.now() - localOutputStarted
    const versionCalls = localOutputCalls.filter(name => /^getDispatcherTaskVersion(?:_|$)/.test(name))
    const activityCalls = localOutputCalls.filter(name => /^refreshAccountActivity(?:_|$)/.test(name))
    expect(localOutputCalls.every(name => /^(?:getDispatcherTaskVersion|refreshAccountActivity)(?:_|$)/.test(name))).toBe(true)
    expect(versionCalls.length).toBeLessThanOrEqual(1)
    // Visible-tab activity has a 60s timer; a long file must not turn that
    // bounded security check into an exemption for grid reads or repeated work.
    expect(activityCalls.length).toBeLessThanOrEqual(Math.ceil(localOutputMilliseconds / 60_000) + 1)
    const beforeReopen = calls.length
    if (afterDownloadSql && beforeReopenSql) {
      expect(afterDownloadSql.rpcStatements).toBeDefined()
      expect(beforeReopenSql.rpcStatements).toBeDefined()
      let attributed = 0
      for (const id of new Set([...Object.keys(afterDownloadSql.rpcStatements!), ...Object.keys(beforeReopenSql.rpcStatements!)])) {
        const delta = (beforeReopenSql.rpcStatements![id] ?? 0) - (afterDownloadSql.rpcStatements![id] ?? 0)
        expect(delta).toBeGreaterThanOrEqual(0)
        if (!delta) continue
        const name = rpcNames.get(id) ?? id
        // Version: session/user lookup (<=2), fresh user, index version, gate (<=2).
        // Activity: session/user (<=2), BEGIN + 2 locks + <=2 writes + COMMIT, gate (<=2).
        if (/^getDispatcherTaskVersion(?:_|$)/.test(name)) expect(delta).toBeLessThanOrEqual(6 * versionCalls.length)
        else if (/^refreshAccountActivity(?:_|$)/.test(name)) expect(delta).toBeLessThanOrEqual(10 * activityCalls.length)
        else expect(delta, `Unexpected SQL after download: ${name}`).toBe(0)
        attributed += delta
      }
      // No unexplained/background SQL; without either named probe this is zero,
      // retaining a stricter bound than the former unconditional allowance of 4.
      expect(beforeReopenSql.statements - afterDownloadSql.statements).toBe(attributed)
    }
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    await expect(table.locator('tbody tr')).toHaveCount(100)
    await expect(table.locator('thead th')).toHaveText(expectedHeaders)
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

test('1000 строк: разрешённая широкая печать целиком', async ({ page, browser }, info) => {
  test.skip(process.env.AUDIT_REPORT_PRINT_LIMIT !== '1', 'Separate isolated allowed-print run')
  const printPdf = process.env.AUDIT_REPORT_PRINT_PDF === '1'
  test.setTimeout(printPdf ? 300_000 : 180_000)
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
    await showAllJournalOutputColumns(page)
    const started = Date.now()
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
    await expect(dialog.frameLocator('iframe').locator('tbody tr')).toHaveCount(100)
    await expect(dialog.frameLocator('iframe').locator('thead th')).toHaveText(expectedHeaders)
    const previewMilliseconds = Date.now() - started
    await sampling.checkpoint(`preview 1000 x ${expectedHeaders.length}`)
    await captureFullReportPrint(page, printPdf)
    const printing = Date.now()
    await dialog.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').rows)).toBe(1000)
    const printed = await page.evaluate(() => JSON.parse(document.body.dataset.fullPrint!))
    expect(printed.columns).toBe(expectedHeaders.length)
    expect(printed.minColumns).toBe(expectedHeaders.length)
    expect(printed.maxColumns).toBe(expectedHeaders.length)
    expect(printed.lastRow).toContain('ALLOWED-PRINT-F1000')
    expect(printed.parts.length).toBeGreaterThan(1)
    expect(printed.physicalRows).toBe(1000 * printed.parts.length)
    const expectedJoints = Array.from({ length: 1000 }, (_, i) => `ALLOWED-PRINT-F${String(i + 1).padStart(4, '0')}`)
    for (const part of printed.parts) {
      expect(part.headers.slice(0, 2)).toEqual(['Линия', 'Стык'])
      expect(part.headers).toEqual(part.sources.map((source: number) => expectedHeaders[source]))
      expect(part.joints).toEqual(expectedJoints)
      expect(part.rows).toBe(1000)
      expect(part.minColumns).toBe(part.headers.length)
      expect(part.maxColumns).toBe(part.headers.length)
      expect(part.headers.length).toBeLessThanOrEqual(10)
    }
    console.log(JSON.stringify({ workflow: `1000 x ${expectedHeaders.length} allowed print DOM`, previewMilliseconds, printMilliseconds: Date.now() - printing, cellNodes: printed.cellNodes }))
    await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
    await sampling.checkpoint(`printed 1000 x ${expectedHeaders.length}`)
    if (printPdf) {
      const html = await page.evaluate(() => {
        const state = window as unknown as { auditFullPrintHtml?: string }
        const html = state.auditFullPrintHtml
        delete state.auditFullPrintHtml
        return html
      })
      expect(html).toBeTruthy()
      await writeFile(info.outputPath('full-print.html'), html!)
      const printContext = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE })
      try {
        const printPage = await printContext.newPage()
        await printPage.setContent(html!)
        await printPage.evaluate(() => document.fonts.ready)
        const started = Date.now()
        await printPage.pdf({ path: info.outputPath('full-print.pdf'), preferCSSPageSize: true, printBackground: true })
        console.log(JSON.stringify({ workflow: 'Chrome PDF from exact full-print DOM', milliseconds: Date.now() - started,
          bytes: (await stat(info.outputPath('full-print.pdf'))).size }))
        await sampling.checkpoint('Chrome PDF completed')
      } finally { await printContext.close() }
    }
    await dialog.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
    expect(errors).toEqual([])
  } finally {
    const resources = await sampling()
    console.log(JSON.stringify({ workflow: 'allowed print sampled resources', ...resources }))
    expect(resources.errors).toEqual([])
  }
})
