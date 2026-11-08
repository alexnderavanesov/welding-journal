import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { seedDispatcherLargeLineFixture } from '../dispatcher-large-line-fixture'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { serializeRpcData, deserializeRpcResponse, siblingRpcUrl, rpcName } from '../rpc'
import { editJournalJoint } from '../journal-grid'

test('открытые журнал, ЛНК и ПСТО сохраняют строки; другой оператор сохраняет; ошибка расчёта допускает повтор', async ({ browser, baseURL }, info) => {
  test.skip(process.env.DISPATCHER_LARGE_LINE_PROBE !== '1', 'Explicit local staged-calculation probe')
  test.setTimeout(300000)
  const directory = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
  const manifest = readFileSync(resolve(directory, readdirSync(directory).find(name => name.includes('tanstack-start-server-fn-resolver'))!), 'utf8')
  const observed = `${baseURL}/_serverFn/${manifest.match(/"([a-f0-9]{64})":/)![1]}`
  const context = await browser.newContext({ baseURL, storageState: process.env.E2E_AUTH_STATE, viewport: { width: 1600, height: 1000 } })
  const other = await browser.newContext({ baseURL, storageState: process.env.E2E_AUTH_STATE, viewport: { width: 1600, height: 1000 } })
  const output = resolve('outputs/dispatcher-large-lines-2026-11-07', `ui-${info.project.name}`)
  await mkdir(output, { recursive: true })
  const call = async <T,>(name: string, data: unknown, request: APIRequestContext = context.request): Promise<T> => {
    const response = await request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
      data: await serializeRpcData(data), timeout: 120000,
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
    if (payload.error) throw payload.error
    expect(response.ok()).toBe(true)
    return payload.result
  }
  const probeFile = process.env.AUDIT_SQL_COUNTS_FILE!.replace(/counts\.json$/, 'dispatcher-staging.json')
  const controlFile = probeFile.replace('dispatcher-staging.json', 'dispatcher-staging-control.json')
  const control = async (value: object) => { await writeFile(controlFile + '.tmp', JSON.stringify(value)); await rename(controlFile + '.tmp', controlFile) }
  const paused = (key: string) => expect.poll(async () => JSON.parse(await readFile(probeFile, 'utf8')).attempts.some((attempt: { paused?: string }) => attempt.paused === key), { timeout: 30000 }).toBe(true)
  const version = (id: number) => withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [id])).rows[0].version)
  const refresh = () => call<{ isFresh: boolean }>('refreshDispatcherTaskSnapshot', {})
  const views: Page[] = [], errors: string[] = []
  let pending: Promise<unknown> | undefined
  try {
    const fixture = await seedDispatcherLargeLineFixture(50000)
    expect((await refresh()).isFresh).toBe(true)
    const target = fixture.targets[0], neighbour = fixture.targets[2]
    for (const path of ['/journal', '/lnk', '/psto']) {
      const page = await context.newPage(); views.push(page)
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(path)
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(target.joint)
      await expect(page.locator(`.ag-row[row-id="${target.id}"]`).first()).toBeVisible({ timeout: 60000 })
      await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 })
    }
    const writer = await other.newPage()
    await writer.goto('/journal')
    await writer.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(neighbour.joint)
    await editJournalJoint(writer, neighbour.joint)
    const editor = writer.getByRole('dialog').filter({ has: writer.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    await editor.getByLabel('Изометрия', { exact: true }).fill('SAVED-DURING-CALCULATION')
    await control({ pause: 'concurrent-save' })
    await call('updateWeldJoint', { id: target.id, expectedVersion: await version(target.id), weldingJournalNote: 'UI staged revision' })
    pending = refresh()
    await paused('concurrent-save')
    for (const page of views) {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(page.getByText('Есть обновления', { exact: true })).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: 'Обновить таблицу', exact: true }).click()
      await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'true')
      await expect(page.locator(`.ag-row[row-id="${target.id}"]`).first()).toBeVisible()
      await expect(page.locator('.journal-footer-update')).toHaveText('Обновление…')
      await expect(page.locator('.journal-load-error')).toHaveCount(0)
      await page.screenshot({ path: resolve(output, `${new URL(page.url()).pathname.slice(1)}-updating.png`) })
    }
    const response = writer.waitForResponse(reply => rpcName(reply.url()).startsWith('updateWeldJoint_'))
    const saveStarted = performance.now()
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const saved = await response
    const saveMs = performance.now() - saveStarted
    expect(saved.ok()).toBe(true)
    await expect(editor).toBeHidden()
    expect(saveMs).toBeLessThan(10000)
    expect(await withE2eDatabase(async db => (await db.query('select isometry from weld_joints where id=$1', [neighbour.id])).rows[0].isometry)).toBe('SAVED-DURING-CALCULATION')
    await control({})
    expect(await pending).toMatchObject({ isFresh: true }); pending = undefined
    for (const page of views) {
      await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 })
      await expect(page.locator(`.ag-row[row-id="${target.id}"]`).first()).toBeVisible()
      await expect(page.locator('.journal-load-error')).toHaveCount(0)
    }
    // Server-side failure, not an intercepted HTTP response. The entire old
    // publication stays visible and the normal table retry must recover.
    await control({ pause: 'publication-error', fail: 'publication-error' })
    await call('updateWeldJoint', { id: target.id, expectedVersion: await version(target.id), weldingJournalNote: 'UI rollback revision' })
    const failure = refresh().then(() => ({ failed: false }), error => ({ failed: true, message: String(error) }))
    pending = failure
    await paused('publication-error')
    const journal = views[0]
    await journal.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(journal.getByText('Есть обновления', { exact: true })).toBeVisible({ timeout: 15000 })
    await journal.getByRole('button', { name: 'Обновить таблицу', exact: true }).click()
    await expect(journal.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'true')
    await control({ fail: 'publication-error' })
    expect(await failure).toMatchObject({ failed: true }); pending = undefined
    await expect(journal.locator('.journal-load-error')).toBeVisible({ timeout: 15000 })
    await expect(journal.locator(`.ag-row[row-id="${target.id}"]`).first()).toBeVisible()
    await expect(journal.getByLabel('Диспетчер задач', { exact: true }).getByText('Не удалось обновить расчёт. Повторите загрузку.', { exact: true })).toBeVisible()
    await expect(journal.getByText(/Failed query:|dispatcher_task_pages/)).toHaveCount(0)
    await journal.screenshot({ path: resolve(output, 'publication-error.png') })
    await control({})
    await journal.locator('.journal-load-error').getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
    await expect(journal.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 })
    await expect(journal.locator('.journal-load-error')).toHaveCount(0)
    await expect(journal.locator(`.ag-row[row-id="${target.id}"]`).first()).toBeVisible()
    await journal.reload()
    await expect(journal.locator(`.ag-row[row-id="${target.id}"]`).first()).toBeVisible({ timeout: 60000 })
    expect((await refresh()).isFresh).toBe(true)
    expect(errors).toEqual([])
    for (const page of views) await page.close()
    await writer.close()
    // Reproduce a legacy database without an explicit officialDls key. Save
    // through the real settings RPC while a large calculation is staged.
    await withLineProgramFixture(async db => {
      await db.query(`update app_settings set value=(value::jsonb - 'officialDls')::text where key='save-check'`)
      await db.query(`insert into app_settings(key,value) values('other','{"requireDlsForOfficialStamps":false}')
        on conflict(key) do update set value=excluded.value`)
    })
    expect((await refresh()).isFresh).toBe(true)
    const setting = (key: string) => withE2eDatabase(async db => {
      const { rows: [row] } = await db.query('select value,updated_at from app_settings where key=$1', [key])
      return { value: row ? JSON.parse(row.value) : {}, expectedUpdatedAt: row?.updated_at.toISOString() ?? null }
    })
    const revision = () => withE2eDatabase(async db => (await db.query('select source_revision,computed_revision,full_rebuild from dispatcher_task_index_state where id=1')).rows[0])
    const sameBefore = await revision(), otherSetting = await setting('other')
    await call('saveAppSetting', { key: 'other', ...otherSetting, value: { ...otherSetting.value, unrelatedFixtureValue: 1 } })
    expect((await revision()).source_revision).toBe(sameBefore.source_revision)
    await control({ pause: 'legacy-settings' })
    await call('updateWeldJoint', { id: target.id, expectedVersion: await version(target.id), weldingJournalNote: 'UI legacy DLS revision' })
    pending = refresh()
    await paused('legacy-settings')
    const prior = await revision(), changedOther = await setting('other')
    await call('saveAppSetting', { key: 'other', ...changedOther, value: { ...changedOther.value, requireDlsForOfficialStamps: true } })
    const invalidated = await revision()
    expect(invalidated.source_revision).toBeGreaterThan(prior.source_revision)
    expect(invalidated.full_rebuild).toBe(true)
    await control({})
    expect(await pending).toMatchObject({ isFresh: true }); pending = undefined
    expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int n from dispatcher_row_tasks where weld_joint_id=$1 and code='СП-02'`, [neighbour.id])).rows[0].n)).toBe(1)
    await writeFile(resolve(output, 'result.json'), JSON.stringify({ browser: browser.version(), saveMs, retainedReports: 3, concurrentSave: true, failureRetry: true, reopened: true, legacySettingsRace: true, errors }, null, 2))
  } finally {
    await control({})
    await pending?.catch(() => {})
    await context.close(); await other.close()
  }
})
