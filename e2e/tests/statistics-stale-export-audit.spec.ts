import { randomUUID } from 'node:crypto'
import { expect, test, type Request } from '@playwright/test'
import * as XLSX from 'xlsx'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { captureReportExcel } from '../report-excel-capture'
import { rpcName } from '../rpc'

// Author-only audit regression. The main E2E runner owns the isolated database
// and server; this spec neither creates them nor changes application settings.
test('statistics: a delayed period RPC must not export old totals under the new period', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  const project = `E2E-statistics-stale-export-${randomUUID()}`
  const before = { scope: `проект ${project}`, period: '01.09.2026 - 30.09.2026', unit: 'стыки', welded: 5 }
  const after = { ...before, period: '01.09.2026 - 01.09.2026', welded: 2 }
  const errors: string[] = []
  const held: Array<{ body: string; status: number }> = []
  let delayStatistics = false
  let fixtureStarted = false
  let releaseResponse!: () => void
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
  const isStatistics = (request: Request) => request.url().includes('/_serverFn/') &&
    rpcName(request.url()).startsWith('getStatisticsServerResult_')
  page.on('pageerror', error => errors.push(error.message))

  await page.route('**/_serverFn/**', async route => {
    if (!delayStatistics || !isStatistics(route.request())) return route.continue()
    // Compute the REAL response against the disposable DB, then withhold only
    // its delivery. Never substitute a fabricated summary or touch React state.
    const response = await route.fetch()
    held.push({ body: route.request().postData() ?? '', status: response.status() })
    await responseGate
    await route.fulfill({ response })
  })

  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const exportTrigger = page.getByRole('button', { name: 'Отчет PDF', exact: true })
  const excel = preview.getByRole('button', { name: 'Скачать Excel', exact: true })
  // Locate the value beside its visible label, not a coincidental "5" in a table.
  const weldedValue = page.getByText('Сварено за период', { exact: true }).locator('..').locator(':scope > div').last()
  const settleRender = () => page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const capture = async (name: string) => {
    await expect(preview.frameLocator('iframe').locator('.metric').first()).toBeVisible()
    const path = testInfo.outputPath(`${name}.xlsx`)
    const workbook = await captureReportExcel(page, preview, path)
    await testInfo.attach(name, { path, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    return readStatisticsSnapshot(workbook)
  }

  try {
    fixtureStarted = true
    await withE2eDatabase(async db => {
      // Independent oracle: two ordinary welded joints on day 1, three on day 2.
      // No result, repair/coil, duplicate-control or WDI-rule assumptions needed.
      await db.query(`insert into weld_joints
        (project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality)
        select $1,'STALE-EXPORT','STALE-EXPORT','S'||n,
          case when n<=2 then date '2026-09-01' else date '2026-09-02' end,
          'С17','действующий','актуальная'
        from generate_series(1,5) n`, [project])
    })
    await invalidateFixtureCalculations()

    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    const projectSelect = page.getByRole('combobox', { name: 'Проект', exact: true })
    await expect(projectSelect.locator('option', { hasText: project })).toHaveCount(1)
    await projectSelect.selectOption(project.toLowerCase())
    await page.getByRole('button', { name: 'Стыки', exact: true }).click()
    await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('custom')
    await page.getByLabel('Период с', { exact: true }).fill('2026-09-01')
    // Ensure the next fill changes the key even if the machine's current month
    // happens to be September 2026. Date inputs use getByLabel across browsers.
    await page.getByLabel('Период по', { exact: true }).fill('2026-09-29')
    const initialResponse = page.waitForResponse(response => isStatistics(response.request()) &&
      (response.request().postData() ?? '').includes('2026-09-30'))
    await page.getByLabel('Период по', { exact: true }).fill('2026-09-30')
    const loaded = await initialResponse
    expect(loaded.ok()).toBe(true)
    await loaded.finished()
    await expect(weldedValue).toHaveText('5')
    await settleRender()
    await exportTrigger.click()
    expect(await capture('statistics-before-period-change')).toEqual(before)
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()

    delayStatistics = true
    await page.getByLabel('Период по', { exact: true }).fill('2026-09-01')
    await expect.poll(() => held.length, { message: 'The changed-period real RPC must reach the response gate' }).toBeGreaterThan(0)
    for (const request of held) {
      expect(request.status).toBe(200)
      expect(request.body).toContain(project.toLowerCase())
      expect(request.body).toContain('2026-09-01')
      expect(request.body).not.toContain('2026-09-30')
    }
    await expect(page.getByLabel('Период по', { exact: true })).toHaveValue('2026-09-01')
    await settleRender()

    // The approved fix now requires waiting before forming a NEW report.
    // Keep the independent XLSX oracle as a diagnostic if that guard regresses;
    // comparing Excel only with the preview would accept the same bug twice.
    let during: ReturnType<typeof readStatisticsSnapshot> | 'blocked' = 'blocked'
    if (await exportTrigger.isVisible() && await exportTrigger.isEnabled()) {
      await exportTrigger.click()
      await expect(preview).toBeVisible()
      await settleRender()
      if (await excel.isVisible() && await excel.isEnabled()) {
        during = await capture('statistics-during-delayed-period-rpc')
        expect.soft(during, 'Excel must pair the period and totals from one snapshot, never day 1 with the old five joints')
          .toEqual(during.period === before.period ? before : after)
      }
      await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    }
    await expect.soft(exportTrigger, 'New report formation must wait for the selected period').toBeDisabled()
    await expect.soft(page.getByRole('status')).toContainText('Обновляем статистику для выбранных параметров')
    await expect.soft(weldedValue, 'Previous-period totals must not appear as current').not.toBeVisible()
    await testInfo.attach('statistics-delayed-export-observation', {
      body: JSON.stringify({ before, requested: after, whileResponseHeld: during }, null, 2),
      contentType: 'application/json',
    })

    const delivered = page.waitForResponse(response => isStatistics(response.request()) &&
      !(response.request().postData() ?? '').includes('2026-09-30'))
    delayStatistics = false
    releaseResponse()
    const current = await delivered
    expect(current.ok()).toBe(true)
    await current.finished()
    await expect(weldedValue).toHaveText('2')
    await expect(weldedValue).toBeVisible()
    await expect(exportTrigger).toBeEnabled()
    await exportTrigger.click()
    expect(await capture('statistics-after-period-response')).toEqual(after)
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    expect(errors).toEqual([])
  } finally {
    delayStatistics = false
    releaseResponse()
    // Drain intercepted requests before closing the page and deleting fixtures,
    // including when the independent stale-export assertion failed.
    await page.unrouteAll({ behavior: 'wait' })
    await page.close()
    if (fixtureStarted) {
      await cleanupLineProgramProjects([project])
      await invalidateFixtureCalculations()
    }
  }
})

function readStatisticsSnapshot(workbook: XLSX.WorkBook) {
  const summary = workbook.Sheets['Сводка']
  expect(summary, 'The real downloaded statistics workbook has a summary').toBeTruthy()
  const cells = Object.entries(summary).filter(([address]) => !address.startsWith('!'))
  const meta = (label: string) => {
    const matches = cells.filter(([, cell]) => typeof cell.v === 'string' && cell.v.startsWith(`${label}: `))
    expect(matches, `Exactly one ${label} metadata cell`).toHaveLength(1)
    return String(matches[0][1].v).slice(label.length + 2)
  }
  const labels = cells.filter(([, cell]) => cell.v === 'Сварено за период')
  expect(labels).toHaveLength(1)
  const address = XLSX.utils.decode_cell(labels[0][0])
  const welded = summary[XLSX.utils.encode_cell({ r: address.r + 1, c: address.c })]
  expect(welded).toMatchObject({ t: 'n' })
  return { scope: meta('Срез'), period: meta('Период'), unit: meta('Единица'), welded: Number(welded.v) }
}

async function invalidateFixtureCalculations() {
  // Same disposable-DB invalidation used by statistics-physical-chains.spec.ts:
  // raw fixture writes must not reuse another scenario's derived snapshots.
  await withE2eDatabase(async db => {
    await db.query('delete from derived_calculation_cache')
    await db.query('update derived_calculation_state set source_revision=source_revision+1,updated_at=now() where id=1')
    await db.query('update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,updated_at=now() where id=1')
  })
}
