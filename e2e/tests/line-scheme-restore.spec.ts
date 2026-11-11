import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { filterSchemeProject } from '../line-scheme-grid'
import { withE2eDatabase } from '../database'

test('restored S3 backup: original PDFs, archives, markup and subsequent save', async ({ page, browser }, info) => {
  test.skip(process.env.E2E_DATABASE_PROFILE !== 'line-scheme-s3-restore', 'Opt-in isolated restore rehearsal only')
  test.setTimeout(120_000)
  const fixture = JSON.parse(await readFile(join(process.env.E2E_S3_REPORT_DIR!, 'fixture.json'), 'utf8')) as {
    project: string; line: string; revisions: { id: string; key: string; fileName: string; pageCount: number;
      points: { id: string }[]; annotation: { id: string; label: string; note: string }; dimension: { id: string; distanceMm: number } }[] }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-schemes'); await filterSchemeProject(page, fixture.project)
  const open = () => page.getByRole('row').filter({ hasText: fixture.project }).getByRole('button', { name: 'Backup 3', exact: true }).click()
  await open()
  const dialog = page.getByRole('dialog', { name: `Схема линии ${fixture.line}`, exact: true })
  for (const [index, revision] of fixture.revisions.entries()) {
    await dialog.getByLabel('Редакция PDF').click()
    await page.locator('[data-select-listbox]').getByRole('option', { name: new RegExp(`Backup ${index + 1}`) }).click()
    await expect(dialog.locator('canvas[data-pdf-rendered="preview"]')).toBeVisible()
    await expect(dialog.locator('[data-scheme-point]')).toHaveCount(2)
    for (const point of revision.points) await expect(dialog.locator(`[data-scheme-point="${point.id}"]`)).toBeVisible()
    const annotation = dialog.locator(`[data-scheme-annotation="${revision.annotation.id}"]`)
    await expect(annotation).toHaveAttribute('aria-label', `Обозначение ${revision.annotation.label}`)
    await annotation.hover(); await expect(dialog.getByText(`Восстановить примечание ${index + 1}`, { exact: false })).toBeVisible()
    const dimension = dialog.locator(`[data-scheme-dimension="${revision.dimension.id}"]`)
    expect((await dimension.textContent())?.replace(/\s/g, '')).toContain(String(revision.dimension.distanceMm))
    if (index < 2) await expect(dialog.getByText('Архив · только просмотр', { exact: true })).toBeVisible()
    else await expect(dialog.getByText('Редактирование доступно', { exact: true })).toBeVisible()
    const original = await readFile(join(process.env.E2E_S3_BACKUP_DIR!, 'pdf', revision.key))
    const url = `/api/line-scheme-file?revision=${revision.id}`
    const response = await page.request.get(url)
    expect(response.status()).toBe(200); expect(await response.body()).toEqual(original)
    const range = await page.request.get(url, { headers: { Range: 'bytes=10-29' } })
    expect(range.status()).toBe(206); expect(await range.body()).toEqual(original.subarray(10, 30))
  }
  const active = fixture.revisions[2]
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try { expect((await anonymous.request.get(new URL(`/api/line-scheme-file?revision=${active.id}`, page.url()).href)).status()).toBe(401) }
  finally { await anonymous.close() }
  const changeDimension = async (text: string) => {
    await dialog.locator(`[data-scheme-dimension="${active.dimension.id}"]`).click()
    const input = dialog.getByRole('textbox', { name: 'Расстояние, мм', exact: true })
    await input.fill(text); await input.press('Enter')
    const saved = page.waitForResponse(response => response.request().method() === 'POST'
      && !!response.request().postData()?.includes('revisionVersion'))
    await dialog.getByRole('button', { name: /^Сохранить/ }).click()
    const response = await saved
    expect(response.status()).toBe(200); await response.finished()
    // Disabled also means "saving"; it is not evidence that the transaction
    // committed. Wait for the actual save response before checking stored data.
    await expect(dialog.getByRole('button', { name: /^Сохранить/ })).toBeDisabled()
  }
  await changeDimension('2345,5')
  expect(await withE2eDatabase(async db => (await db.query('select distance_mm::text as value from line_scheme_dimensions where id=$1', [active.dimension.id])).rows[0].value)).toBe('2345.5')
  await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
  await page.reload(); await filterSchemeProject(page, fixture.project); await open()
  await expect(dialog.locator(`[data-scheme-dimension="${active.dimension.id}"]`)).toContainText(/2[\s\u00a0\u202f]?345,5/)
  await changeDimension(String(active.dimension.distanceMm))
  await page.screenshot({ path: info.outputPath('restored-scheme.png') })
  await dialog.getByRole('button', { name: 'Закрыть схему' }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  expect(errors).toEqual([])
})
