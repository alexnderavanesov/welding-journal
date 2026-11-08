import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { Permission } from '../../src/lib/access-permissions'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { asE2eOwner } from '../with-owner-access'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'

test.beforeEach(resetE2eAccountFixtureLimits)

async function rpcHarness(page: Page, browser: Browser, baseURL: string) {
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Пользователи и права' })).toBeVisible()
  expect(observed).not.toBe('')
  await page.close()
  const contexts: BrowserContext[] = [], emails: string[] = []
  return {
    async account(extra: Permission[] = []) {
      const email = `preview-access-${randomUUID()}@e2e.test`, password = 'preview123!'
      emails.push(email)
      await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Проверка прав предпросмотра', email, title: '', role: 'user',
        permissions: ['welding.view', 'welding.edit', ...extra] })
      await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password })
      const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
      contexts.push(context)
      expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password }, headers: { origin: baseURL } })).ok()).toBe(true)
      return context.request
    },
    async call(client: APIRequestContext, name: string, data: unknown) {
      const response = await client.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
        data: await serializeRpcData(data), headers: { origin: baseURL, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
      })
      expect(response.headers()['cache-control']).toContain('no-store')
      return await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
    },
    async close() {
      for (const context of contexts) await context.close()
      if (emails.length) await withE2eDatabase(db => db.query('delete from auth_users where email=any($1::text[])', [emails]))
    },
  }
}

async function seed(project: string) {
  return withLineProgramFixture(async db => {
    const rows = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,
      has_vik,has_rk,psto_required,pre_heat_treatment_required,isometry,welding_journal_note,lnk_note,psto_note)
      select $1,'ACL','ACL-L','F'||n,'2026-10-01','С17','действующий','да','да','да',true,
        'ISO-'||n,'Note-'||n,'PRIVATE-LNK-'||n,'PRIVATE-PSTO-'||n from generate_series(1,2) n returning id`, [project])).rows
    const root = rows[0].id as number
    await db.query(`update weld_joints set rk_request='PRIVATE-RK-REQUEST',rk_request_date='2026-11-01',rk_result='ожидает НК',
      psto_request='PRIVATE-PSTO-REQUEST',psto_request_date='2026-11-02',psto_result='ожидает',
      tvmt_request='PRIVATE-TVMT-REQUEST',tvmt_request_date='2026-11-03',tvmt_result='ожидает НК' where id=$1`, [root])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result)
      values($1,'РК','PRIVATE-PRE-REQUEST','2026-10-31','ожидает НК')`, [root])
    for (const [title, type, date] of [
      ['PRIVATE-RK-REQUEST', 'system:lnkRequest', '2026-11-01'],
      ['PRIVATE-PSTO-REQUEST', 'system:pstoRequest', '2026-11-02'],
      ['PRIVATE-TVMT-REQUEST', 'system:tvmtRequest', '2026-11-03'],
    ]) {
      const document = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,row_count)
        values($1,$2,$2||'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3,1) returning id`, [type, title, date])).rows[0].id
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [document, root])
    }
    return { root, other: rows[1].id as number }
  })
}
const snapshot = (project: string) => withE2eDatabase(async db => (await db.query('select *,xmin::text version from weld_joints where project_title=$1 order by id', [project])).rows)

test('real preview RPCs redact request metadata by specialty while retaining confirmation tokens', async ({ page, browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Uses the installed production RPC manifest')
  test.setTimeout(120_000)
  const project = `PREVIEW-ACL-${randomUUID()}`
  const harness = await rpcHarness(page, browser, baseURL!)
  try {
    const { root } = await seed(project), before = await snapshot(project)
    let token: string | undefined
    for (const profile of [
      { grants: [] as Permission[], names: [] as string[], pre: false },
      { grants: ['lnk.view'] as Permission[], names: ['PRIVATE-RK-REQUEST'], pre: true },
      { grants: ['psto.view'] as Permission[], names: ['PRIVATE-PSTO-REQUEST', 'PRIVATE-TVMT-REQUEST'], pre: false },
      { grants: ['lnk.view', 'psto.view'] as Permission[], names: ['PRIVATE-RK-REQUEST', 'PRIVATE-PSTO-REQUEST', 'PRIVATE-TVMT-REQUEST'], pre: true },
      { grants: ['documents.view'] as Permission[], names: ['PRIVATE-RK-REQUEST', 'PRIVATE-PSTO-REQUEST', 'PRIVATE-TVMT-REQUEST'], pre: false },
    ]) {
      const client = await harness.account(profile.grants)
      const response = await harness.call(client, 'previewChainActuality', { rowId: root, active: false })
      expect(response.error).toBeUndefined()
      const value = response.result
      expect(value.requestRemovals.map((item: { title: string }) => item.title).sort()).toEqual([...profile.names].sort())
      expect(value.hiddenRemovalCount).toBe(3 - profile.names.length)
      expect(value.pendingRequestCount).toBe(4)
      expect(JSON.stringify(value)).not.toContain('accessAreas')
      if (token === undefined) token = value.token
      expect(value.token).toBe(token)
      for (const name of ['PRIVATE-RK-REQUEST', 'PRIVATE-PSTO-REQUEST', 'PRIVATE-TVMT-REQUEST'].filter(name => !profile.names.includes(name))) {
        expect(JSON.stringify(response)).not.toContain(name)
      }
      const pre = await harness.call(client, 'previewPreHeatTreatmentChain', { rowId: root, required: false })
      if (profile.pre) { expect(pre.error).toBeUndefined(); expect(pre.result.controls[0].request).toBe('PRIVATE-PRE-REQUEST') }
      else { expect(pre.error).toBeDefined(); expect(JSON.stringify(pre)).not.toContain('PRIVATE-PRE-REQUEST') }
      // This older helper still requires all three work-area views. Do not
      // broaden its policy while closing the new chain-preview disclosure.
      const common = await harness.call(client, 'previewControlRequestRemoval', { records: [{ id: root, hasRk: null, pstoRequired: null }],
        expectedVersions: [{ id: root, version: before[0].version }] })
      if (profile.grants.includes('lnk.view') && profile.grants.includes('psto.view')) {
        expect(common.error).toBeUndefined(); expect(common.result.removals).toHaveLength(3)
        expect(JSON.stringify(common)).not.toContain('accessAreas')
      } else { expect(common.error).toBeDefined(); expect(JSON.stringify(common)).not.toContain('PRIVATE-') }
    }
    expect(await snapshot(project)).toEqual(before)
  } finally { await harness.close(); await cleanupLineProgramProjects([project]) }
})

test('a restricted journal editor cannot use hidden filters or sorting to select a paste range', async ({ page, browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Uses the installed production RPC manifest')
  const project = `INLINE-ACL-${randomUUID()}`
  const harness = await rpcHarness(page, browser, baseURL!)
  try {
    const fixture = await seed(project), client = await harness.account()
    const query = { report: 'weldingJournal', columnFilters: { projectTitle: project }, groupBy: [], sort: { fieldKey: 'id', direction: 'asc' } }
    const read = await harness.call(client, 'readJournalGrid', { ...query, route: [], start: 0, end: 100 })
    expect(read.error).toBeUndefined(); expect(read.result.rowCount).toBe(2)
    expect(JSON.stringify(read)).not.toContain('PRIVATE-')
    const before = await snapshot(project)
    const range = { ...query, revision: read.result.revision, anchor: '', parts: [{ route: [], start: 0, end: 1, columns: ['weldingJournalNote'] }] }
    for (const forged of [
      { columnFilters: { projectTitle: project, lnkNote: '=PRIVATE-LNK-1' } },
      { columnFilters: { projectTitle: project, pstoNote: '=PRIVATE-PSTO-1' } },
      { sort: { fieldKey: 'lnkNote', direction: 'asc' } },
      { groupBy: ['lnkNote'], parts: [{ route: ['PRIVATE-LNK-1'], start: 0, end: 1, columns: ['weldingJournalNote'] }] },
      { columnFilters: { projectTitle: project, search: 'PRIVATE-' } },
    ]) {
      const denied = await harness.call(client, 'pasteJournalCells', { range: { ...range, ...forged }, values: [['must not write']] })
      expect(denied.error?.message).toMatch(/недоступ|требует просмотра/)
      expect(denied.result).toBeUndefined()
      expect(await snapshot(project)).toEqual(before)
    }
    const clear = await harness.call(client, 'pasteJournalCells', { range: { ...range,
      columnFilters: { projectTitle: project, isometry: '=ISO-1' } }, values: [['']] })
    expect(clear.error).toBeUndefined(); expect(clear.result).toEqual({ count: 1 })
    const after = await snapshot(project)
    expect(after.find(row => row.id === fixture.root).welding_journal_note).toBeNull()
    expect(after.find(row => row.id === fixture.other)).toEqual(before.find(row => row.id === fixture.other))
    expect(after.map(row => [row.lnk_note, row.psto_note])).toEqual(before.map(row => [row.lnk_note, row.psto_note]))
  } finally { await harness.close(); await cleanupLineProgramProjects([project]) }
})
