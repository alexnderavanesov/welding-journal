import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { resetE2eAccountFixtureLimits, latestE2eToken } from '../authentication'
import { serializeRpcData, deserializeRpcResponse, siblingRpcUrl } from '../rpc'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'

test.beforeEach(resetE2eAccountFixtureLimits)

test('restricted accounts cannot probe hidden fields, compressed tasks, settings or another specialty; expiry closes the existing tab', async ({ page, browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the actual production RPC manifest')
  const email = `boundary-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Ограниченный инженер', email, title: 'Директор', role: 'user', permissions: ['welding.view', 'welding.edit', 'welding.import', 'templates.view', 'templates.edit', 'history.joint'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'boundary123' })
  const joint = await withE2eDatabase(async db => (await db.query("insert into weld_joints(project_title,line,joint,welding_journal_note,lnk_note,psto_result) values('AUTH-BOUNDARY','A','F987','visible','SECRET-LNK','не годен') returning *")).rows[0])
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  await page.goto('/account'); await expect(page.getByRole('heading', { name: 'Мой профиль' })).toBeVisible()
  expect(observed).not.toBe('')
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const call = async (client: APIRequestContext, name: string, data: unknown, method = 'GET') => {
    const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`))
    const encoded = await serializeRpcData(data)
    if (method === 'GET') url.searchParams.set('payload', encoded)
    const response = await client.fetch(url.toString(), { method, ...(method === 'POST' ? { data: encoded } : {}), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    return await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
  }
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'boundary123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const allowed = await call(context.request, 'getWeldJointById', { id: joint.id })
    expect(allowed.error).toBeUndefined(); expect(allowed.result.weldingJournalNote).toBe('visible')
    expect(JSON.stringify(allowed)).not.toContain('SECRET-LNK'); expect(allowed.result).not.toHaveProperty('pstoResult')
    for (const [name, data, method] of [
      ['getDispatcherTaskSnapshot', { transport: 'gzip-v1' }, 'GET'],
      ['listWeldFormSuggestions', { fieldKey: 'lnkNote', draft: {} }, 'POST'],
      ['saveAppSetting', { key: 'dispatcher', value: {}, expectedUpdatedAt: null }, 'POST'],
      ['updateWeldJoint', { id: joint.id, mutationScope: 'psto', pstoResult: 'годен' }, 'POST'],
      ['importWeldJoints', { records: [{ projectTitle: 'AUTH-BOUNDARY', line: 'A', joint: 'F988', weldingJournalNote: 'must rollback', lnkNote: 'forged' }] }, 'POST'],
      ['updateWeldJoint', { id: joint.id, mutationScope: 'welding', weldingJournalNote: 'must rollback', lnkNote: 'forged', updatedAt: new Date(joint.updated_at).toISOString() }, 'POST'],
      ['listActivityHistory', {}, 'POST'],
      ['listAccounts', {}, 'GET'],
    ] as const) expect((await call(context.request, name, data, method)).error, name).toBeDefined()
    const unchanged = await withE2eDatabase(async db => (await db.query('select welding_journal_note,lnk_note from weld_joints where id=$1', [joint.id])).rows[0])
    expect(unchanged).toEqual({ welding_journal_note: 'visible', lnk_note: 'SECRET-LNK' })
    expect(await withE2eDatabase(async db => (await db.query("select count(*)::int as count from weld_joints where project_title='AUTH-BOUNDARY'")).rows[0].count)).toBe(1)
    const saved = await call(context.request, 'updateWeldJoint', { id: joint.id, expectedVersion: allowed.result.rowVersion, mutationScope: 'welding', weldingJournalNote: 'allowed change' }, 'POST')
    expect(saved.error).toBeUndefined()
    const history = await call(context.request, 'listActivityHistory', { jointId: joint.id }, 'POST')
    expect(history.error).toBeUndefined(); expect(history.result.rows).toHaveLength(1)
    const detail = await call(context.request, 'getActivityDetails', { operationId: history.result.rows[0].id, jointId: joint.id }, 'POST')
    expect(detail.result.rows[0].changes.weldingJournalNote).toEqual({ before: 'visible', after: 'allowed change' })
    expect(JSON.stringify(detail)).not.toContain('SECRET-LNK')
    const user = await context.newPage(); await user.goto('/account'); await expect(user.getByRole('heading', { name: 'Мой профиль' })).toBeVisible()
    await expect(user.getByLabel('Должность', { exact: true })).toHaveAttribute('readonly', '')
    const profile = await call(context.request, 'getCurrentAccount', {})
    const forgedTitle = await call(context.request, 'updateOwnProfile', { name: profile.result.name, title: 'Самоназначенная должность', revision: profile.result.revision }, 'POST')
    expect(forgedTitle.error).toBeDefined()
    expect(await withE2eDatabase(async db => (await db.query('select title from auth_users where email=$1', [email])).rows[0].title)).toBe('Директор')
    await user.goto(`/activity?jointId=${joint.id}`)
    await expect(user.getByRole('heading', { name: `История стыка · ID ${joint.id}` })).toBeVisible()
    await user.getByRole('button').filter({ hasText: 'Подробности' }).click()
    await expect(user.getByRole('cell', { name: 'allowed change', exact: true })).toBeVisible()
    await expect(user.getByRole('cell', { name: 'Программа линии (ID)', exact: true })).toBeVisible()
    await expect(user.getByRole('cell', { name: 'lineProgramId', exact: true })).toHaveCount(0)
    await expect(user.getByText('SECRET-LNK', { exact: true })).toHaveCount(0)
    await user.screenshot({ path: '/private/tmp/welding-auth-history.png', fullPage: true })
    await withE2eDatabase(db => db.query('update auth_sessions set expires_at=now()-interval \'1 second\' where user_id=(select id from auth_users where email=$1)', [email]))
    await user.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(user.getByRole('heading', { name: 'Вход в систему' })).toBeVisible()
    expect((await call(context.request, 'getWeldJointById', { id: joint.id })).error).toBeDefined()
  } finally {
    await context.close()
    await withE2eDatabase(async db => { await db.query('delete from weld_joints where id=$1', [joint.id]); await db.query('delete from auth_users where email=$1', [email]) })
  }
})
