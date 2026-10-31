import { expect, test } from '@playwright/test'
import { withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

const stamp = 'SD01'

for (const committed of [false, true]) test(`suspension: delayed failure ${committed ? 'after' : 'before'} commit keeps the draft or confirms the saved record without duplication`, async ({ page }) => {
  await withLineProgramFixture(db => db.query(`insert into welder_stamps(naks_stamp,internal_stamp,welder_name,naks_permits,dls_permits)
    values($1,'SD-INTERNAL','Черновик отстранения','[]','[]')`, [stamp]))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let writes = 0
  try {
    await page.goto('/welder-stamps')
    await page.getByRole('button', { name: /История отстранений/ }).click()
    await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Добавление отстранения', exact: true }) })
    await dialog.getByRole('combobox', { name: 'Клеймо НАКС', exact: true }).selectOption(stamp)
    await dialog.getByLabel('Отстранен от', { exact: true }).fill('2026-10-01')
    await dialog.getByLabel('Отстранен до', { exact: true }).fill('2026-10-15')
    await page.route('**/_serverFn/**', async route => {
      if (!rpcName(route.request().url()).startsWith('saveWelderStampSuspensionRecords_')) return route.continue()
      if (++writes > 1) return route.continue()
      await gate
      if (committed) await route.fetch()
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' })
    })
    const submit = dialog.getByRole('button', { name: 'Добавить', exact: true })
    await submit.click()
    await expect.poll(() => writes).toBe(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    for (const name of ['Добавить', 'Отмена', 'Закрыть']) await expect(dialog.getByRole('button', { name, exact: true })).toBeDisabled()
    release()
    const stored = () => withE2eDatabase(async db => (await db.query('select suspended_from::text,suspended_to::text from welder_stamp_suspensions where naks_stamp=$1', [stamp])).rows)
    if (committed) {
      await expect(dialog).toBeHidden()
      expect(writes).toBe(1)
      expect(await stored()).toEqual([{ suspended_from: '2026-10-01', suspended_to: '2026-10-15' }])
      return
    }
    await expect(submit).toBeEnabled()
    await expect(dialog.getByRole('combobox', { name: 'Клеймо НАКС', exact: true })).toHaveValue(stamp)
    await expect(dialog.getByLabel('Отстранен от', { exact: true })).toHaveValue('2026-10-01')
    await expect(dialog.getByLabel('Отстранен до', { exact: true })).toHaveValue('2026-10-15')
    expect(await stored()).toEqual([])
    await submit.click()
    await expect(dialog).toBeHidden()
    expect(writes).toBe(2)
    expect(await stored()).toEqual([{ suspended_from: '2026-10-01', suspended_to: '2026-10-15' }])
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' }).catch(() => {})
    await page.close().catch(() => {})
    await withLineProgramFixture(async db => {
      await db.query('delete from welder_stamp_suspensions where naks_stamp=$1', [stamp])
      await db.query('delete from welder_stamps where naks_stamp=$1', [stamp])
    })
  }
})
