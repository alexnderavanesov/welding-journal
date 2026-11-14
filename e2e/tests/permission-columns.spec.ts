import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { inviteAccount } from '../../src/server/account-management'
import { PERMISSIONS } from '../../src/lib/access-permissions'

test.beforeEach(resetE2eAccountFixtureLimits)

test('permission columns select applicable actions, preserve cancellation and save the complete choice', async ({ page }, info) => {
  const email = `columns-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Выбор столбцов прав', email, title: '', role: 'user', permissions: ['welding.view'] })
  const read = () => withE2eDatabase(async db => (await db.query('select permissions,revision from auth_users where email=$1', [email])).rows[0])
  try {
    await page.goto('/account')
    await page.getByLabel('Найти пользователя').fill(email)
    const row = page.getByRole('row').filter({ hasText: email })
    await row.getByRole('button', { name: 'Настроить права' }).click()
    const dialog = page.getByRole('dialog')
    const allView = dialog.getByRole('checkbox', { name: 'Все: Просмотр', exact: true })
    await expect(allView).toBeChecked({ indeterminate: true })
    const before = await read()
    await allView.focus(); await page.keyboard.press('Space')
    await expect(dialog.getByRole('checkbox', { name: 'Журнал действий: Просмотр', exact: true })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'История отдельного стыка: Просмотр', exact: true })).toBeChecked()
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await read()).toEqual(before)
    await row.getByRole('button', { name: 'Настроить права' }).click()
    const headers = dialog.locator('thead').getByRole('checkbox')
    await expect(headers).toHaveCount(6)
    for (const checkbox of await headers.all()) await checkbox.check()
    await expect(dialog.getByRole('checkbox', { name: 'Схемы линий: Удаление и отмена', exact: true })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'Статистика: Изменение', exact: true })).toHaveCount(0)
    await allView.uncheck()
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(0)
    for (const checkbox of await headers.all()) await checkbox.check()
    await page.screenshot({ path: info.outputPath('permission-columns.png') })
    await dialog.getByRole('button', { name: 'Сохранить права', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect((await read()).permissions).toEqual([...PERMISSIONS].sort())
    await row.getByRole('button', { name: 'Настроить права' }).click()
    for (const checkbox of await headers.all()) await expect(checkbox).toBeChecked()
    await dialog.getByRole('checkbox', { name: 'Все: Изменение', exact: true }).uncheck()
    await expect(allView).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'Все: Удаление и отмена', exact: true })).toBeChecked()
    await page.setViewportSize({ width: 900, height: 740 })
    await expect(dialog.getByRole('button', { name: 'Сохранить права', exact: true })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('permission-columns-narrow.png') })
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect((await read()).permissions).toEqual([...PERMISSIONS].sort())
  } finally {
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})
