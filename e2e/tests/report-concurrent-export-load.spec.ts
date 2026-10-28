import { expect, test, type Download, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { editJournalJoint } from '../journal-grid'
import { observeMixedClient, sampleMixedResources } from '../mixed-resource-telemetry'

const exec = promisify(execFile)
const count = 200_000, project = 'E2E simultaneous complete exports'

test('three complete 200k × 111 exports alongside editing/search; cancellation releases storage and retry stays complete', async ({ browser }, info) => {
  test.skip(process.env.AUDIT_EXPORT_CONCURRENCY !== '1', 'Own isolated database, 4 CPU/4 GiB server and disk temporary storage')
  test.setTimeout(900_000)
  expect(process.env.AUDIT_CONTAINER_MEMORY_MIB).toBe('4096')
  expect(process.env.AUDIT_CONTAINER_CPUS).toBe('4')
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int n from weld_joints')).rows[0].n).toBe(1)
    // The shared seed deliberately has an official stamp absent from the
    // registry. This profile needs a saveable independent writer; qualification
    // refusals are exercised by official-stamp-entry-order instead.
    await db.query('update weld_joints set stamp_1_k=null where id=1')
    await db.query(`insert into weld_joints(project_title,line,joint,weld_date,officiality,revision_actuality,
      connection_type,has_vik,vik_result,vik_conclusion_date,vik_conclusion)
      select $1,'BOUNDARY','MAX-EXPORT-F'||lpad(n::text,6,'0'),'2026-09-01',
        'действующий','актуальная','С17','да','годен','2026-09-02','VIK-BOUNDARY'
      from generate_series(1,$2::int) n`, [project, count])
    await db.query('analyze weld_joints')
  })
  const facts = () => withE2eDatabase(async db => (await db.query(`select count(*)::int n,
    md5(string_agg(md5((to_jsonb(w)-'final_status')::text),'' order by id)) facts
    from weld_joints w where project_title=$1`, [project])).rows[0])
  const before = await facts()
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport: { width: 1600, height: 1000 } })))
  contexts.forEach(context => { context.setDefaultTimeout(90_000); context.setDefaultNavigationTimeout(180_000) })
  const clients = contexts.map((context, index) => observeMixedClient(context, ['export-1', 'export-2', 'export-3', 'writer', 'reader'][index]))
  const pages = await Promise.all(contexts.map(context => context.newPage()))
  const stopSampling = await sampleMixedResources(browser)
  const temporaryRoot = join(dirname(process.env.AUDIT_SQL_COUNTS_FILE!), 'report-tmp')
  const temporaryFiles = () => readdir(temporaryRoot)
  const measures: Array<Record<string, unknown>> = []
  let downloadRequest: unknown
  pages[0].on('request', request => {
    if (new URL(request.url()).pathname === '/api/report-excel') downloadRequest = request.postDataJSON()
  })
  const preview = (page: Page) => page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const verify = async (download: Download, started: number) => {
    expect(await download.failure()).toBeNull()
    const downloadMs = Math.round(performance.now() - started)
    const path = await download.path()
    expect(path).toBeTruthy()
    const { stdout } = await exec('python3', ['e2e/verify-report-workbook.py', path!, 'MAX-EXPORT-F200000'])
    const workbook = JSON.parse(stdout)
    expect(workbook).toEqual({ dataRows: count, columns: 111, found: true, distinctJoints: count, firstJoint: 1, lastJoint: count })
    return { downloadMs, withVerificationMs: Math.round(performance.now() - started), bytes: (await stat(path!)).size, workbook }
  }
  try {
    // The single-line distribution also challenges the initial full calculation;
    // measurements include it, rather than warming it outside the resource cap.
    for (const page of pages) {
      await page.goto('/journal')
      await expect(page.locator('[data-welding-journal-grid] .ag-row[row-id]').first()).toBeVisible({ timeout: 180_000 })
    }
    for (const page of pages.slice(0, 3)) {
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('MAX-EXPORT-')
      await expect(page.getByText('MAX-EXPORT-F000001', { exact: true })).toBeVisible()
      await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
      await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
      await expect(preview(page).frameLocator('iframe').locator('thead th')).toHaveCount(111)
      await expect(preview(page).getByRole('status')).toContainText('200000')
    }
    await pages[3].getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E-001')
    await expect(pages[3].getByRole('button', { name: 'F1', exact: true })).toBeVisible()
    await editJournalJoint(pages[3], 1)
    const initialEditor = pages[3].getByRole('dialog').filter({ has: pages[3].getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    await initialEditor.getByLabel('Изометрия', { exact: true }).fill('CONCURRENT-EXPORT-READY')
    await initialEditor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(initialEditor).toBeHidden()
    const started = performance.now()
    const downloading = pages.slice(0, 3).map(async (page, index) => {
      const started = performance.now()
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 360_000 }),
        preview(page).getByRole('button', { name: 'Скачать Excel', exact: true }).click(),
      ])
      measures.push({ role: `export-${index + 1}`, ...await verify(download, started) })
    })
    const writing = (async () => {
      for (let round = 1; round <= 3; round++) {
        const started = performance.now()
        await editJournalJoint(pages[3], 1)
        const dialog = pages[3].getByRole('dialog').filter({ has: pages[3].getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
        await dialog.getByLabel('Изометрия', { exact: true }).fill(`CONCURRENT-EXPORT-${round}`)
        await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
        await expect(dialog).toBeHidden()
        expect(await withE2eDatabase(async db => (await db.query('select isometry from weld_joints where id=1')).rows[0].isometry)).toBe(`CONCURRENT-EXPORT-${round}`)
        measures.push({ role: 'writer', round, ms: Math.round(performance.now() - started) })
      }
    })()
    const reading = (async () => {
      for (const value of ['000001', '200000', '050000', '100000']) {
        const started = performance.now()
        const joint = 'MAX-EXPORT-F' + value
        await pages[4].getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
        await expect(pages[4].getByText(joint, { exact: true })).toBeVisible()
        measures.push({ role: 'reader', joint, ms: Math.round(performance.now() - started) })
      }
    })()
    // Await every client even if one fails; closing a runner must not discard
    // the other clients' outcomes or leave rejected download promises behind.
    const results = await Promise.allSettled([...downloading, writing, reading])
    measures.push({ role: 'concurrent-total', ms: Math.round(performance.now() - started) })
    expect(results.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : [])).toEqual([])
    expect(await facts()).toEqual(before)
    await expect.poll(temporaryFiles, { timeout: 30_000 }).toEqual([])

    expect(downloadRequest).toBeTruthy()
    await pages[2].evaluate(request => {
      const state = window as unknown as { auditAbort: AbortController; auditResult: string }
      state.auditAbort = new AbortController(); state.auditResult = 'pending'
      void fetch('/api/report-excel', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request), signal: state.auditAbort.signal })
        .then(() => { state.auditResult = 'unexpected completion' }, error => { state.auditResult = error.name })
    }, downloadRequest)
    await expect.poll(async () => (await temporaryFiles()).length, { timeout: 30_000 }).toBeGreaterThan(0)
    const cancelledAt = performance.now()
    console.log('CONCURRENT_EXPORT_CANCEL', new Date().toISOString())
    await pages[2].evaluate(() => (window as unknown as { auditAbort: AbortController }).auditAbort.abort())
    await expect.poll(() => pages[2].evaluate(() => (window as unknown as { auditResult: string }).auditResult)).toBe('AbortError')
    await expect.poll(temporaryFiles, { timeout: 30_000 }).toEqual([])
    measures.push({ role: 'cancel-cleanup', ms: Math.round(performance.now() - cancelledAt) })
    const retryStarted = performance.now()
    const [retry] = await Promise.all([
      pages[2].waitForEvent('download', { timeout: 180_000 }),
      preview(pages[2]).getByRole('button', { name: 'Скачать Excel', exact: true }).click(),
    ])
    measures.push({ role: 'retry-after-cancel', ...await verify(retry, retryStarted) })
    await expect.poll(temporaryFiles, { timeout: 30_000 }).toEqual([])
    expect(await facts()).toEqual(before)
    for (const client of clients) expect(client.errors).toEqual([])
  } finally {
    await Promise.all(contexts.map(context => context.close()))
    const resources = await stopSampling()
    const result = { measures, resources, clients: await Promise.all(clients.map(client => client.summary())) }
    await writeFile(info.outputPath('concurrent-exports.json'), JSON.stringify(result, null, 2))
    console.log('CONCURRENT_EXPORTS', JSON.stringify({ measures, browserPeakMiB: resources.browserProcessSumPeakMiB,
      appPeakBytes: resources.lastCgroup['memory.peak'], memoryEvents: resources.lastCgroup['memory.events'],
      connectionsPeak: resources.connectionsPeak, activePeak: resources.activePeak, blockedPeak: resources.blockedPeak }))
    expect(resources.postmortem).toBe(false)
    expect(resources.errors).toEqual([])
    expect(resources.lastCgroup['memory.events']).toMatch(/oom_kill 0(?:\n|$)/)
  }
})
