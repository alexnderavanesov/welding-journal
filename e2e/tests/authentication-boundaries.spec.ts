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
  await page.goto('/account'); await expect(page.getByRole('heading', { name: 'Пользователи и права' })).toBeVisible()
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
    const selected = await call(context.request, 'listWeldJointRowsByIds', { ids: [joint.id], report: 'weldingJournal' }, 'POST')
    expect(selected.error).toBeUndefined()
    expect(selected.result).toEqual([expect.objectContaining({ id: joint.id, weldingJournalNote: 'visible' })])
    expect(JSON.stringify(selected)).not.toContain('SECRET-LNK')
    expect(selected.result[0]).not.toHaveProperty('pstoCycleSummary')
    for (const report of ['lnk', 'heatTreatment', 'documents', 'unknown']) {
      expect((await call(context.request, 'listWeldJointRowsByIds', { ids: [joint.id], report }, 'POST')).error, report).toBeDefined()
    }
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
    expect(detail.result.rows[0].changes.weldingJournalNote).toEqual({ before: 'visible', after: 'allowed change', origin: 'user' })
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
    await expect(user.getByText('Технические подробности · полная запись')).toHaveCount(0)
    await expect(user.getByRole('rowheader', { name: 'Программа линии (ID) (lineProgramId)', exact: true })).toHaveCount(0)
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

test('revoked field and edit rights apply to the already open journal, search and Excel', async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Uses built server operations')
  const { changeAccount } = await import('../../src/server/account-management')
  const email = `revoke-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Проверка отзыва', email, title: '', role: 'user',
    permissions: ['welding.view', 'welding.edit', 'welding.export', 'psto.view', 'lnk.view'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'revoke123' })
  const joint = await withE2eDatabase(async db => (await db.query("insert into weld_joints(project_title,line,joint,lnk_note,welding_journal_note) values('REVOCATION','REV-L','F15','private-LNK-15','visible-15') returning id", [])).rows[0])
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'revoke123' }, headers: { origin: baseURL! } })).status()).toBe(200)
    const page = await context.newPage()
    let observed = ''
    page.on('request', r => { if (r.url().includes('/_serverFn/')) observed = r.url() })
    await page.goto('/journal')
    await expect(page.locator('[data-welding-journal-grid] .ag-root')).toBeVisible()
    const call = async (name: string, data: unknown, method = 'POST') => {
      const url = new URL(siblingRpcUrl(observed, name + '_createServerFn_handler'))
      const body = await serializeRpcData(data)
      if (method === 'GET') url.searchParams.set('payload', body)
      const response = await context.request.fetch(url.href, { method, ...(method === 'POST' ? { data: body } : {}),
        headers: { origin: baseURL!, 'x-tsr-serverFn': 'true', 'content-type': 'application/json' } })
      return await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
    }
    const read = () => call('getWeldJointById', { id: joint.id }, 'GET')
    const exportFields = (fieldKeys: string[]) => context.request.post('/api/report-excel', { data: { report: 'weldingJournal', fieldKeys } })
    const filter = () => call('readJournalFilterPage', { report: 'weldingJournal', fieldKey: 'lnkNote', match: 'private-LNK-15' })
    const initial = await read()
    const beforeFilter = await filter()
    expect(beforeFilter.error).toBeUndefined()
    expect(JSON.stringify(beforeFilter.result)).toContain('private-LNK-15')
    expect(initial.result.lnkNote).toBe('private-LNK-15')
    const { read: workbook, utils } = await import('xlsx')
    const sheetRows = async (fields: string[]) => {
      const response = await exportFields(fields)
      expect(response.status()).toBe(200)
      const file = workbook(await response.body(), { type: 'buffer' })
      return utils.sheet_to_json(file.Sheets[file.SheetNames[0]], { header: 1 }).flat()
    }
    expect(await sheetRows(['joint', 'lnkNote'])).toContain('private-LNK-15')
    const account = await withE2eDatabase(async db => (await db.query('select id, revision from auth_users where email=$1', [email])).rows[0])
    await asE2eOwner(changeAccount, 'welding.view')({ ...account, role: 'user', permissions: ['welding.view', 'welding.export'] })
    // No navigation, sign-out, focus event or session renewal before the save.
    expect((await call('updateWeldJoint', { id: joint.id, expectedVersion: initial.result.rowVersion, mutationScope: 'welding', weldingJournalNote: 'stale edit' })).error).toBeDefined()
    expect((await read()).result).not.toHaveProperty('lnkNote')
    expect((await filter()).error?.message).toContain('недоступное поле')
    expect((await call('listWeldFormSuggestions', { fieldKey: 'lnkNote', draft: {} })).error).toBeDefined()
    expect((await exportFields(['joint', 'lnkNote'])).status()).toBe(403)
    const visible = await sheetRows(['joint', 'weldingJournalNote'])
    expect(visible).toContain('visible-15')
    expect(visible).not.toContain('private-LNK-15')
    const saved = await withE2eDatabase(async db => (await db.query('select welding_journal_note from weld_joints where id=$1', [joint.id])).rows[0])
    expect(saved.welding_journal_note).toBe('visible-15')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('[data-welding-journal-grid] .ag-root')).toBeVisible()
  } finally {
    await context.close()
    await withE2eDatabase(async db => { await db.query('delete from weld_joints where id=$1', [joint.id]); await db.query('delete from auth_users where email=$1', [email]) })
  }
})
