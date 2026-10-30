import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { resetE2eAccountFixtureLimits, latestE2eToken } from '../authentication'
import { serializeRpcData, deserializeRpcResponse, siblingRpcUrl, rpcName } from '../rpc'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'

test.beforeEach(resetE2eAccountFixtureLimits)

test('активность: свои сеансы, несколько устройств, простой, выход и истечение; только администратор видит список', async ({ page, browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Uses production RPC names')
  const email = `activity-${randomUUID()}@e2e.test`, pendingEmail = `pending-${randomUUID()}@e2e.test`
  const invite = asE2eOwner(inviteAccount, 'welding.view')
  await invite({ name: 'Активность E2E', email, title: '', role: 'user', permissions: [] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'activity123' })
  await invite({ name: 'Приглашение E2E', email: pendingEmail, title: '', role: 'user', permissions: [] })
  const before = await withE2eDatabase(async db => (await db.query('select id,revision,updated_at from auth_users where email=$1', [email])).rows[0])
  const pending = await withE2eDatabase(async db => (await db.query('select id from auth_users where email=$1', [pendingEmail])).rows[0])
  const countAudit = () => withE2eDatabase(async db => (await db.query('select count(*)::int n from audit_operations')).rows[0].n)
  const auditBefore = await countAudit()
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  await page.goto('/account?tab=users')
  const row = page.getByRole('row').filter({ hasText: email })
  await expect(page.getByRole('columnheader', { name: /Активность/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Статус аккаунта/ })).toBeVisible()
  await expect(row).toContainText('Активирован')
  await expect(row).toContainText('Нет данных')
  await expect(page.getByRole('row').filter({ hasText: pendingEmail })).toContainText('Ещё не входил')
  const refresh = async () => { await page.getByRole('button', { name: 'Обновить список', exact: true }).click() }
  const call = async (client: APIRequestContext, name: string, data: unknown = {}, method = 'POST', origin = baseURL!) => {
    const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`))
    const encoded = await serializeRpcData(data)
    if (method === 'GET') url.searchParams.set('payload', encoded)
    const response = await client.fetch(url.toString(), { method, ...(method === 'POST' ? { data: encoded } : {}),
      headers: { origin, 'sec-fetch-site': origin === baseURL ? 'same-origin' : 'cross-site', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    if (!response.ok()) return { error: new Error(String(response.status())), status: response.status() }
    return await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error; status?: number }
  }
  const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })))
  const [first, second, guest] = contexts
  const timestamps = () => withE2eDatabase(async db => ({
    user: (await db.query('select last_active_at,revision,updated_at from auth_users where id=$1', [before.id])).rows[0],
    sessions: (await db.query('select id,last_active_at from auth_sessions where user_id=$1 order by id', [before.id])).rows,
  }))
  try {
    expect((await call(guest.request, 'refreshAccountActivity')).result).toBeNull()
    for (const context of [first, second]) expect((await context.request.post('/api/auth/sign-in/email', {
      data: { email, password: 'activity123' }, headers: { origin: baseURL! },
    })).ok()).toBe(true)
    const user = await first.newPage(); await user.goto('/account')
    await expect(user.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    expect((await call(second.request, 'refreshAccountActivity')).result.id).toBe(before.id)
    await refresh(); await expect(row).toContainText('Онлайн')
    const active = await timestamps()
    expect(active.sessions).toHaveLength(2)
    expect(active.sessions.every(session => session.last_active_at)).toBe(true)
    await Promise.all(Array.from({ length: 5 }, () => call(second.request, 'refreshAccountActivity', { userId: pending.id, lastActiveAt: '2099-01-01' })))
    expect(await timestamps()).toEqual(active)
    expect((await call(second.request, 'listAccounts', {}, 'GET')).error).toBeDefined()
    expect((await call(second.request, 'refreshAccountActivity', {}, 'GET')).error).toBeDefined()
    expect((await call(second.request, 'refreshAccountActivity', {}, 'POST', 'https://untrusted.example')).error).toBeDefined()
    expect((await withE2eDatabase(db => db.query('select last_active_at from auth_users where id=$1', [pending.id]))).rows[0].last_active_at).toBeNull()

    // A real logout on one device must not mark another active device offline.
    await user.getByRole('button', { name: 'Выйти', exact: true }).click()
    await expect(user.getByRole('heading', { name: 'Вход в систему' })).toBeVisible()
    await refresh(); await expect(row).toContainText('Онлайн')
    await withE2eDatabase(db => db.query("update auth_sessions set last_active_at=now()-interval '4 minutes' where user_id=$1", [before.id]))
    await withE2eDatabase(db => db.query("update auth_users set last_active_at=now()-interval '3 minutes 30 seconds' where id=$1", [before.id]))
    await refresh(); await expect(row).toContainText('Был(а) на сайте'); await expect(row).not.toContainText('Онлайн')
    await expect(row.locator('time')).toHaveText('3 минуты назад')
    await expect(row.locator('time')).toHaveAttribute('title', /\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} МСК/)
    await page.screenshot({ path: '/private/tmp/welding-account-activity-relative.png', fullPage: true })
    expect((await call(second.request, 'refreshAccountActivity')).result.id).toBe(before.id)
    await refresh(); await expect(row).toContainText('Онлайн')
    await page.screenshot({ path: '/private/tmp/welding-account-activity.png', fullPage: true })

    await withE2eDatabase(db => db.query("update auth_sessions set expires_at=now()-interval '1 second' where user_id=$1", [before.id]))
    const expired = (await timestamps()).user
    await refresh(); await expect(row).not.toContainText('Онлайн')
    expect((await call(second.request, 'refreshAccountActivity')).result).toBeNull()
    expect((await timestamps()).user).toEqual(expired)
    // New login followed by last-device logout retains the last activity time.
    expect((await second.request.post('/api/auth/sign-in/email', { data: { email, password: 'activity123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    expect((await call(second.request, 'refreshAccountActivity')).result.id).toBe(before.id)
    const last = (await timestamps()).user
    expect((await second.request.post('/api/auth/sign-out', { data: {}, headers: { origin: baseURL! } })).ok()).toBe(true)
    await refresh(); await expect(row).toContainText('Был(а) на сайте'); await expect(row).not.toContainText('Онлайн')
    const result = await timestamps()
    expect(result.sessions).toEqual([])
    expect(result.user).toEqual(last)
    expect(result.user.revision).toBe(before.revision)
    expect(result.user.updated_at).toEqual(before.updated_at)
    expect(await countAudit()).toBe(auditBefore)
  } finally {
    for (const context of contexts) await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where id=any($1::text[])', [[before.id, pending.id]]))
  }
})

test('список пользователей обновляется раз в две минуты, локальное обновление подписей не делает запросов', async ({ page }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Uses production RPC names')
  await page.clock.install()
  let calls = 0
  page.on('request', request => { if (rpcName(request.url()) === 'listAccounts_createServerFn_handler') calls++ })
  await page.goto('/account?tab=users')
  await expect(page.getByRole('row').filter({ hasText: 'owner@e2e.test' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Обновить список', exact: true })).toBeEnabled()
  expect(calls).toBeGreaterThan(0)
  calls = 0
  await page.clock.fastForward(65_000)
  expect(calls).toBe(0)
  await page.clock.fastForward(60_000)
  await expect.poll(() => calls).toBe(1)
})
