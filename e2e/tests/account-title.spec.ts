import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { inviteAccount, completeAccountLink, changeAccount } from '../../src/server/account-management'
import { resetE2eAccountFixtureLimits, latestE2eToken } from '../authentication'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'

test.beforeEach(resetE2eAccountFixtureLimits)

test('administrator adds, changes and clears a title from the menu without changing rights; stale saves are rejected', async ({ browser, baseURL }, info) => {
  const adminEmail = `title-admin-${randomUUID()}@e2e.test`, userEmail = `title-user-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Администратор должностей', email: adminEmail, title: '', role: 'admin', permissions: [] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'title123' })
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Иванов Иван', email: userEmail, title: '', role: 'user', permissions: ['welding.view'] })
  const read = () => withE2eDatabase(async db => (await db.query('select id,title,role,permissions,revision from auth_users where email=$1', [userEmail])).rows[0])
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email: adminEmail, password: 'title123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Пользователи и права', exact: true })).toBeVisible()
    const owner = page.getByRole('row').filter({ hasText: 'Владелец системы' })
    await expect(owner.getByRole('button', { name: /Действия пользователя:/ })).toHaveCount(0)
    await page.getByLabel('Найти пользователя').fill(userEmail)
    const row = page.getByRole('row').filter({ hasText: userEmail })
    const dialog = page.getByRole('dialog', { name: 'Должность пользователя', exact: true })
    const open = async () => {
      await row.getByRole('button', { name: 'Действия пользователя: Иванов Иван', exact: true }).click()
      await page.getByRole('button', { name: 'Изменить должность', exact: true }).click()
      await expect(dialog.getByLabel('Должность', { exact: true })).toBeFocused()
      await expect(dialog.getByRole('checkbox')).toHaveCount(0)
    }
    await open()
    await expect(dialog.getByLabel('Должность', { exact: true })).toHaveValue('')
    for (const title of ['Инженер по сварке', 'Ведущий инженер', '']) {
      await dialog.getByLabel('Должность', { exact: true }).fill(title)
      await dialog.getByRole('button', { name: 'Сохранить должность', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      expect(await read()).toMatchObject({ title, role: 'user', permissions: ['welding.view'] })
      if (title) await expect(row).toContainText(title)
      await open()
      await expect(dialog.getByLabel('Должность', { exact: true })).toHaveValue(title)
    }
    await dialog.getByLabel('Должность', { exact: true }).fill('Не сохранять')
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect((await read()).title).toBe('')
    await open()
    await dialog.getByLabel('Должность', { exact: true }).fill('Устаревший черновик')
    const current = await read()
    await asE2eOwner(changeAccount, 'welding.view')({ id: current.id, revision: current.revision, role: 'user', permissions: ['welding.view', 'lnk.view'], title: 'Должность от владельца' })
    await dialog.getByRole('button', { name: 'Сохранить должность', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Загрузить актуальные данные', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Сохранить должность', exact: true })).toBeDisabled()
    expect(await read()).toMatchObject({ title: 'Должность от владельца', permissions: ['lnk.view', 'welding.view'] })
    await dialog.getByRole('button', { name: 'Загрузить актуальные данные', exact: true }).click()
    await expect(dialog.getByLabel('Должность', { exact: true })).toHaveValue('Должность от владельца')
    await page.setViewportSize({ width: 900, height: 740 })
    await expect(dialog.getByRole('button', { name: 'Сохранить должность', exact: true })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('account-title.png') })
    await dialog.getByLabel('Должность', { exact: true }).fill('Инженер')
    await dialog.getByRole('button', { name: 'Сохранить должность', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await read()).toMatchObject({ title: 'Инженер', permissions: ['lnk.view', 'welding.view'] })
    const history = await withE2eDatabase(async db => (await db.query(`select c.changes from audit_changes c join audit_operations o on o.id=c.operation_id
      where c.entity_id=$1 and o.actor_name='Администратор должностей' and c.changes ? 'title' order by o.created_at`, [current.id])).rows)
    expect(history.map(row => row.changes.title)).toEqual([
      { before: '', after: 'Инженер по сварке' }, { before: 'Инженер по сварке', after: 'Ведущий инженер' },
      { before: 'Ведущий инженер', after: '' }, { before: 'Должность от владельца', after: 'Инженер' },
    ])
  } finally {
    await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where email=any($1::text[])', [[adminEmail, userEmail]]))
  }
})
