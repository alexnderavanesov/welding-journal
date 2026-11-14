import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { completeAccountLink, inviteAccount } from '../../src/server/account-management'
import { normalizeAssignmentWarningSettings } from '../../src/lib/assignment-warnings'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { asE2eOwner } from '../with-owner-access'

test.beforeEach(resetE2eAccountFixtureLimits)

test('warning-setting history is visible to its reader and administrator, but hidden without the area permission', async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
  const id = randomUUID(), email = `history-warning-${id}@e2e.test`, name = `История предупреждений ${id}`
  const previous = await withE2eDatabase(async db => (await db.query("select value,updated_at from app_settings where key='assignment-warnings'")).rows[0])
  await asE2eOwner(inviteAccount, 'welding.view')({ name, email, title: '', role: 'user', permissions: ['history.view', 'assignmentWarnings.view', 'assignmentWarnings.edit'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const call = async (operation: string, data: unknown, method = 'POST') => {
      const url = new URL(siblingRpcUrl(observed, `${operation}_createServerFn_handler`)), encoded = await serializeRpcData(data)
      if (method === 'GET') url.searchParams.set('payload', encoded)
      const response = await context.request.fetch(url.href, { method, ...(method === 'POST' ? { data: encoded } : {}),
        headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
      expect(response.headers()['cache-control']).toContain('no-store')
      const decoded = await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
      expect(decoded.error).toBeUndefined()
      return decoded.result
    }
    const settings = await call('listAppSettingsSnapshot', {}, 'GET')
    const value = normalizeAssignmentWarningSettings(settings.values['assignment-warnings'])
    value.rk.text = `Проверка истории ${id}`
    await call('saveAppSetting', { key: 'assignment-warnings', value, expectedUpdatedAt: settings.updatedAt['assignment-warnings'] ?? null })
    const actorId = await withE2eDatabase(async db => (await db.query('select id from auth_users where email=$1', [email])).rows[0].id)
    const recorded = await withE2eDatabase(async db => (await db.query("select o.id from audit_operations o join audit_changes c on c.operation_id=o.id where o.actor_id=$1 and o.action='saveAppSetting' and c.area='assignmentWarnings' and c.entity_id='assignment-warnings' order by o.created_at desc limit 1", [actorId])).rows[0])
    expect(recorded?.id).toBeTruthy()
    const checkVisible = async () => {
      const history = await call('listActivityHistory', { actorId })
      expect(history.rows.map((row: { id: string }) => row.id)).toContain(recorded.id)
      const details = await call('getActivityDetails', { operationId: recorded.id })
      expect(details.rows).toEqual([expect.objectContaining({ area: 'assignmentWarnings', entity: 'app_settings', entityId: 'assignment-warnings' })])
      expect(JSON.stringify(details.rows[0].changes)).toContain(value.rk.text)
      expect((await call('getActivityFilters', { search: name })).authors).toContainEqual({ id: actorId, name })
    }
    await checkVisible()
    await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where id=$2', [JSON.stringify(['history.view']), actorId]))
    expect((await call('listActivityHistory', { actorId })).rows).toEqual([])
    expect((await call('getActivityDetails', { operationId: recorded.id })).rows).toEqual([])
    expect((await call('getActivityFilters', { search: name })).authors).toEqual([])
    await withE2eDatabase(db => db.query("update auth_users set role='admin',revision=revision+1 where id=$1", [actorId]))
    await checkVisible()
  } finally {
    await context.close()
    await withE2eDatabase(async db => {
      await db.query("delete from app_settings where key='assignment-warnings'")
      if (previous) await db.query("insert into app_settings(key,value,updated_at) values('assignment-warnings',$1,$2)", [previous.value, previous.updated_at])
      await db.query('delete from auth_users where email=$1', [email])
    })
  }
})
