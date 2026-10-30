import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { resetE2eAccountFixtureLimits, latestE2eToken } from '../authentication'
import { withE2eDatabase } from '../database'
import { isAccountRefreshRpc, rpcName } from '../rpc'
import { asE2eOwner } from '../with-owner-access'

test.beforeEach(resetE2eAccountFixtureLimits)

for (const action of ['logout', 'password'] as const) test(`${action}: clear private browser state before navigation even when the next identity request stalls`, async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the actual production RPC manifest')
  const email = `cleanup-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Проверка завершения сеанса', email, title: '', role: 'user', permissions: [] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'cleanup123' })
  const id = await withE2eDatabase(async db => (await db.query('select id from auth_users where email=$1', [email])).rows[0].id as string)
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  let refreshBlocked = false
  let releaseRefresh!: () => void
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'cleanup123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Мой профиль' })).toBeVisible()
    await page.evaluate(id => {
      localStorage.setItem(`welding-user:${id}:selection`, 'private selection')
      sessionStorage.setItem(`welding-user:${id}:selection`, 'private draft')
      localStorage.setItem(`welding-user:${id}:welding-journal-ag-grid:v1`, 'personal layout')
    }, id)
    // The cleanup must precede navigation, not depend on a later network refresh.
    await page.route('**/_serverFn/**', async route => {
      if (isAccountRefreshRpc(rpcName(route.request().url()))) { refreshBlocked = true; await refreshGate }
      await route.continue().catch(() => {})
    })
    if (action === 'password') {
      await page.getByLabel('Текущий пароль', { exact: true }).fill('cleanup123')
      await page.getByLabel('Новый пароль', { exact: true }).fill('changed123')
      await page.getByLabel('Повторите новый пароль', { exact: true }).fill('changed123')
    }
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      page.getByRole('button', { name: action === 'logout' ? 'Выйти' : 'Изменить пароль', exact: true }).click(),
    ])
    await expect.poll(() => refreshBlocked).toBe(true)
    expect(await page.evaluate(id => ({
      local: localStorage.getItem(`welding-user:${id}:selection`),
      session: sessionStorage.getItem(`welding-user:${id}:selection`),
      layout: localStorage.getItem(`welding-user:${id}:welding-journal-ag-grid:v1`),
    }), id)).toEqual({ local: null, session: null, layout: 'personal layout' })
    releaseRefresh()
    await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible()
  } finally {
    releaseRefresh()
    await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where id=$1', [id]))
  }
})
