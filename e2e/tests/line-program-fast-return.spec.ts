import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = '000 E2E fast program return'
const line = 'FAST-RETURN'

test('a new program visit reads another client’s save before the previous snapshot is 30 seconds old', async ({ browser }, info) => {
  test.setTimeout(120000)
  const options = { storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } }
  const readerContext = await browser.newContext(options)
  const writerContext = await browser.newContext(options)
  const readerCalls: string[] = []
  let snapshotAt: number | undefined
  let returnedAt: number | undefined
  try {
    const id = await withLineProgramFixture(async db => {
      // No shared smoothness fixture or existing records are changed. Sorting
      // the isolated project first makes the initial, unfiltered page usable.
      const result = await db.query<{ id: number }>(`insert into line_programs
        (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent)
        values ($1, 'FAST', $2, 'II', 'A', 10, 10) returning id`, [project, line])
      return result.rows[0].id
    })
    const reader = await readerContext.newPage(), writer = await writerContext.newPage()
    reader.on('request', request => {
      if (request.url().includes('/_serverFn/')) readerCalls.push(rpcName(request.url()))
    })
    const rowSelector = `[data-program-grid="lines"] .ag-row[data-line="${line}"]`

    // Prepare the independent writer before starting the reader's cache age.
    await writer.goto('/line-program')
    await expect(writer.getByLabel('Итоги раздела', { exact: true })).toBeVisible()
    await writer.getByLabel('Поиск программы линий', { exact: true }).fill(line)
    await writer.locator(rowSelector).getByRole('button', { name: 'Настроить', exact: true }).click()
    const editor = writer.getByRole('dialog', { name: 'Настройка линии', exact: true })
    await editor.getByLabel('Базовый % контроля', { exact: true }).fill('20')

    const initialSection = reader.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('getLineProgramSection_'))
    await reader.goto('/line-program')
    const response = await initialSection
    expect(response.ok()).toBe(true)
    await response.finished()
    snapshotAt = Date.now()
    await expect(reader.getByLabel('Итоги раздела', { exact: true })).toBeVisible()
    await expect(reader.locator(rowSelector).locator('[col-id="line"]').getByText('10%', { exact: true })).toBeVisible()

    await reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Документы', exact: true }).click()
    await expect(reader.getByTestId('line-program')).toHaveCount(0)
    const callsBeforeSave = readerCalls.filter(name => /^getLineProgram(Page|Section)_/.test(name)).length
    await writer.bringToFront()
    await editor.getByRole('button', { name: 'Сохранить программу', exact: true }).click()
    await expect(editor).toBeHidden()
    expect(await withE2eDatabase(async db => Number((await db.query('select weld_control_percent from line_programs where id=$1', [id])).rows[0].weld_control_percent))).toBe(20)
    // An inactive section need not silently poll or replace its cached data.
    expect(readerCalls.filter(name => /^getLineProgram(Page|Section)_/.test(name))).toHaveLength(callsBeforeSave)

    await reader.bringToFront()
    await reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Программа линий', exact: true }).click()
    await expect(reader.getByLabel('Поиск программы линий', { exact: true })).toHaveValue('')
    await expect(reader.locator(rowSelector)).toBeVisible()
    returnedAt = Date.now()
    // A slower setup is not evidence for this counterexample: it would permit
    // the ordinary staleTime policy to refetch and conceal the missing visit read.
    expect(returnedAt - snapshotAt, 'The same unfiltered section must be revisited inside its 30-second cache window').toBeLessThan(25000)
    await expect(reader.locator(rowSelector).locator('[col-id="line"]').getByText('20%', { exact: true })).toBeVisible({ timeout: 4000 })
    await expect(reader.getByTestId('line-program').getByRole('status')).toHaveCount(0)
    await reader.waitForLoadState('networkidle')
    const returnCalls = readerCalls.filter(name => /^getLineProgram(Page|Section)_/.test(name)).slice(callsBeforeSave)
    expect(returnCalls.filter(name => name.startsWith('getLineProgramSection_'))).toHaveLength(1)
    expect(returnCalls.filter(name => name.startsWith('getLineProgramPage_'))).toHaveLength(0)

    // A failed fresh visit must expose retry, not silently treat the old
    // snapshot as current or start a repeated background refresh loop.
    await reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Документы', exact: true }).click()
    const beforeFailure = readerCalls.filter(name => name.startsWith('getLineProgramSection_')).length
    let failNext = true
    await reader.route('**/_serverFn/**', route => {
      if (failNext && rpcName(route.request().url()).startsWith('getLineProgramSection_')) {
        failNext = false
        return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary test failure' })
      }
      return route.continue()
    })
    await reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Программа линий', exact: true }).click()
    const retry = reader.getByRole('button', { name: 'Повторить загрузку', exact: true })
    await expect(retry).toBeVisible()
    await reader.waitForLoadState('networkidle')
    expect(readerCalls.filter(name => name.startsWith('getLineProgramSection_'))).toHaveLength(beforeFailure + 1)
    await retry.click()
    await expect(retry).toBeHidden()
    await expect(reader.locator(rowSelector).locator('[col-id="line"]').getByText('20%', { exact: true })).toBeVisible()
    await expect(reader.getByTestId('line-program').getByRole('status')).toHaveCount(0)
    expect(readerCalls.filter(name => name.startsWith('getLineProgramSection_'))).toHaveLength(beforeFailure + 2)
  } finally {
    await info.attach('fast-return-diagnostics', { body: JSON.stringify({ snapshotAt, returnedAt, cacheAgeAtReturnMs: snapshotAt && returnedAt ? returnedAt - snapshotAt : null, readerCalls }, null, 2), contentType: 'application/json' })
    await readerContext.close()
    await writerContext.close()
    await cleanupLineProgramProjects([project])
  }
})
