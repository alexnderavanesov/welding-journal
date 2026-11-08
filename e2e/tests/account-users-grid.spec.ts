import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

const fixtures = [
  { key: 'old', name: 'Андреев Антон', title: 'Руководитель', role: 'admin', status: 'active', minutes: 120 },
  { key: 'pending', name: 'Белов Борис', title: 'Монтажник', role: 'user', status: 'pending', minutes: null },
  { key: 'recent', name: 'Сидоров Сергей', title: 'Инженер по сварке', role: 'user', status: 'active', minutes: 10 },
  { key: 'unknown', name: 'Яковлев Яков', title: '', role: 'user', status: 'active', minutes: null },
]
let users: (typeof fixtures[number] & { id: string; email: string })[]
test.beforeEach(async () => {
  users = fixtures.map(user => ({ ...user, id: randomUUID(), email: `${user.key}-${randomUUID()}@e2e.test` }))
  await withE2eDatabase(async db => {
    for (const user of users) await db.query(`insert into auth_users(id,name,email,title,role,status,last_active_at,permissions)
      values($1,$2,$3,$4,$5,$6,case when $7::int is null then null else now()-$7::int*interval '1 minute' end,'["welding.view"]')`,
    [user.id, user.name, user.email, user.title, user.role, user.status, user.minutes])
  })
})
test.afterEach(async () => { await withE2eDatabase(db => db.query('delete from auth_users where id=any($1::text[])', [users.map(user => user.id)])) })

const grid = (page: Page) => page.getByRole('grid', { name: 'Пользователи и права', exact: true })
const row = (page: Page, key: string) => grid(page).locator(`.ag-row[row-id="${users.find(user => user.key === key)!.id}"]`)
async function selectFilter(page: Page, column: string, value: string) {
  await grid(page).locator(`.ag-header-cell[col-id="${column}"] .ag-header-cell-filter-button`).click()
  const popup = page.locator('.read-only-grid-popup').filter({ has: page.getByRole('button', { name: 'Применить', exact: true }) })
  await popup.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await popup.getByRole('checkbox', { name: value, exact: true }).check()
  await popup.getByRole('button', { name: 'Применить', exact: true }).click()
}
const order = (page: Page) => grid(page).locator('.ag-row[row-id]').evaluateAll(rows => rows
  .sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index'))).map(row => row.getAttribute('row-id')))

test('users: a short filter list with a long value stays above the action buttons', async ({ page }, info) => {
  await page.goto('/account?tab=users')
  await expect(page.getByText('Показано: 5 из 5', { exact: true })).toBeVisible()
  await selectFilter(page, 'roleLabel', 'Администратор')
  await expect(page.getByText('Показано: 1 из 5', { exact: true })).toBeVisible()
  await grid(page).locator('.ag-header-cell[col-id="name"] .ag-header-cell-filter-button').click()
  const popup = page.locator('.read-only-grid-popup').filter({ has: page.getByRole('button', { name: 'Применить', exact: true }) })
  await expect(popup.getByRole('checkbox')).toHaveCount(2)
  await expect(popup.locator('[title]').filter({ hasText: users[0].email })).toHaveAttribute('title', `${users[0].name} · ${users[0].email} · ${users[0].title}`)
  await page.screenshot({ path: info.outputPath('users-filter-long-value.png') })
  const layout = await popup.evaluate(element => {
    const panel = element.querySelector('.ag-filter-apply-panel')!.getBoundingClientRect()
    const items = [...element.querySelectorAll('.ag-set-filter-item')].map(item => item.getBoundingClientRect())
    return { panelTop: panel.top, lastItemBottom: Math.max(...items.map(item => item.bottom)),
      overflow: element.scrollWidth - element.clientWidth }
  })
  expect(layout.lastItemBottom).toBeLessThanOrEqual(layout.panelTop)
  expect(layout.overflow).toBeLessThanOrEqual(1)
  await popup.getByRole('textbox').fill('такого пользователя нет')
  await expect(popup.getByText('Нет совпадений', { exact: true })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Сбросить', exact: true })).toBeInViewport()
  await popup.getByRole('textbox').fill('')
  await popup.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(row(page, 'old')).toBeVisible()
})

test('users: combined column filters, name/email/title search, reset, refresh and existing actions', async ({ page }, info) => {
  let calls = 0
  page.on('request', request => { if (rpcName(request.url()) === 'listAccounts_createServerFn_handler') calls++ })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('AG Grid')) errors.push(message.text()) })
  await page.goto('/account?tab=users')
  await expect(page.getByText('Показано: 5 из 5', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Обновить список', exact: true })).toBeEnabled()
  const initialCalls = calls
  const search = page.getByLabel('Найти пользователя')
  for (const term of ['сИДОР', users.find(user => user.key === 'recent')!.email, 'ИНЖЕНЕР ПО СВАРКЕ']) {
    await search.fill(term)
    await expect(page.getByText('Показано: 1 из 5', { exact: true })).toBeVisible()
    await expect(row(page, 'recent')).toBeVisible()
  }
  await search.fill('')
  await selectFilter(page, 'roleLabel', 'Пользователь')
  await expect(page.getByText('Показано: 3 из 5', { exact: true })).toBeVisible()
  await selectFilter(page, 'statusLabel', 'Активирован')
  await expect(page.getByText('Показано: 2 из 5', { exact: true })).toBeVisible()
  await selectFilter(page, 'activityLabel', 'Был(а) на сайте')
  await expect(page.getByText('Показано: 1 из 5', { exact: true })).toBeVisible()
  await search.fill('Монтажник')
  await expect(page.getByText('Показано: 0 из 5', { exact: true })).toBeVisible()
  await expect(page.getByText('По текущему поиску и фильтрам ничего не найдено.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Сбросить фильтры столбцов', exact: true }).click()
  await expect(search).toHaveValue('Монтажник')
  await expect(row(page, 'pending')).toBeVisible()
  await search.fill('')
  await selectFilter(page, 'name', `${users[2].name} · ${users[2].email} · ${users[2].title}`)
  await expect(row(page, 'recent')).toBeVisible()
  await row(page, 'recent').getByRole('button', { name: 'Настроить права', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Настройка прав: Сидоров Сергей', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(calls).toBe(initialCalls)
  await page.getByRole('button', { name: 'Обновить список', exact: true }).click()
  await expect.poll(() => calls).toBe(initialCalls + 1)
  await expect(page.getByText('Показано: 1 из 5', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Сбросить фильтры столбцов', exact: true }).click()
  await selectFilter(page, 'roleLabel', 'Администратор')
  await expect(row(page, 'old')).toBeVisible()
  await page.getByRole('button', { name: 'Сбросить фильтры столбцов', exact: true }).click()
  await page.screenshot({ path: info.outputPath('account-users-grid.png'), fullPage: true })
  await search.fill(users[1].email)
  await row(page, 'pending').getByRole('button', { name: 'Действия пользователя: Белов Борис', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Удалить пользователя?', exact: true })
  await expect(confirmation).toContainText(users[1].email)
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await withE2eDatabase(db => db.query('select count(*)::int n from auth_users where id=any($1::text[])', [users.map(user => user.id)]))).rows[0].n).toBe(4)
  expect(errors).toEqual([])
})

test('users: alphabetical and chronological sorting, unknown dates last, header help and responsive actions', async ({ page }) => {
  await page.goto('/account?tab=users')
  await expect(page.getByText('Показано: 5 из 5', { exact: true })).toBeVisible()
  const owner = (await withE2eDatabase(db => db.query("select id from auth_users where email='owner@e2e.test'"))).rows[0].id
  const [old, pending, recent, unknown] = users.map(user => user.id)
  await expect.poll(() => order(page)).toEqual([old, pending, owner, recent, unknown])
  await grid(page).locator('.ag-header-cell[col-id="name"] .ag-header-cell-text').click()
  await expect.poll(() => order(page)).toEqual([unknown, recent, owner, pending, old])
  const activity = grid(page).locator('.ag-header-cell[col-id="activityLabel"]')
  await activity.getByRole('button', { name: 'Как определяется активность', exact: true }).click()
  await expect(page.getByRole('tooltip')).toContainText('последние 3 минуты')
  await expect(activity).not.toHaveAttribute('aria-sort', /ascending|descending/)
  await page.keyboard.press('Escape')
  await activity.locator('.ag-header-cell-text').click()
  await expect.poll(() => order(page)).toEqual([old, recent, owner, pending, unknown])
  await activity.locator('.ag-header-cell-text').click()
  await expect.poll(() => order(page)).toEqual([owner, recent, old, pending, unknown])
  await page.getByRole('button', { name: 'Обновить список', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Обновить список', exact: true })).toBeEnabled()
  await expect(activity).toHaveAttribute('aria-sort', 'descending')
  await expect.poll(() => order(page)).toEqual([owner, recent, old, pending, unknown])
  await selectFilter(page, 'activityLabel', 'Онлайн')
  const ownerRow = grid(page).getByRole('row').filter({ hasText: 'owner@e2e.test' })
  await expect(ownerRow).toBeVisible()
  await expect(ownerRow.getByRole('button', { name: /Действия пользователя:/ })).toHaveCount(0)
  await ownerRow.getByRole('button', { name: 'Посмотреть права', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.getByRole('button', { name: 'Сбросить фильтры столбцов', exact: true }).click()
  await selectFilter(page, 'activityLabel', 'Ещё не входил')
  await expect(row(page, 'pending')).toBeVisible()
  await page.setViewportSize({ width: 900, height: 740 })
  await row(page, 'pending').getByRole('button', { name: 'Настроить права', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Настройка прав: Белов Борис', exact: true })).toBeVisible()
})
