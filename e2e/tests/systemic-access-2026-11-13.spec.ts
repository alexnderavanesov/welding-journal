import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { auditSqlSnapshot } from '../audit-sql'

test.beforeEach(resetE2eAccountFixtureLimits)

function rpc(client: APIRequestContext, observed: string, baseURL: string) {
  return async (name: string, data: unknown, method = 'POST') => {
    const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`))
    const encoded = await serializeRpcData(data)
    if (method === 'GET') url.searchParams.set('payload', encoded)
    const response = await client.fetch(url.href, { method, ...(method === 'POST' ? { data: encoded } : {}),
      headers: { origin: baseURL, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    expect(response.headers()['cache-control']).toContain('no-store')
    return await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
  }
}

test('denied document RPCs conceal existence and perform only identity reads', async ({ browser, baseURL }, info) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
  const email = `document-access-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Без доступа к документам', email, title: '', role: 'user', permissions: [] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
  const documentId = await withE2eDatabase(async db => (await db.query("insert into generated_documents(type,title,file_name,mime_type) values('system:pstoRequest','PRIVATE AUDIT DOCUMENT','private.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') returning id")).rows[0].id as number)
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const call = rpc(context.request, observed, baseURL!)
    const identityUrl = siblingRpcUrl(observed, 'getCurrentAccount_createServerFn_handler')
    const mutationUrl = siblingRpcUrl(observed, 'applyDocumentOperation_createServerFn_handler')
    await page.close()
    const sqlCounts = async (url: string) => {
      const snapshot = await auditSqlSnapshot()
      if (!snapshot) return undefined
      const id = new URL(url).pathname.split('/').at(-1)!
      expect(snapshot.rpcStatements).toBeDefined()
      expect(snapshot.rpcReleaseReadinessStatements).toBeDefined()
      return { total: snapshot.rpcStatements![id] ?? 0, readiness: snapshot.rpcReleaseReadinessStatements![id] ?? 0 }
    }
    const identityBefore = await sqlCounts(identityUrl)
    expect((await call('getCurrentAccount', {}, 'GET')).error).toBeUndefined()
    const identityAfter = await sqlCounts(identityUrl)
    // Exercise the real five-second release-gate expiry, with the page closed
    // so a background browser request cannot consume the next metadata probe.
    if (identityBefore) await new Promise(resolve => setTimeout(resolve, 5100))
    const before = await sqlCounts(mutationUrl)
    let denied = 0
    for (const permissions of [[], ['documents.view']]) {
      await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2', [JSON.stringify(permissions), email]))
      for (const id of [documentId, 2147483647]) {
        const result = await call('applyDocumentOperation', { documentIds: [id] })
        expect(result.result).toBeUndefined()
        expect(result.error?.message).toContain('Недостаточно прав')
        expect(result.error?.message).not.toContain('Документ не найден')
        denied++
      }
    }
    const after = await sqlCounts(mutationUrl)
    if (before !== undefined && after !== undefined && identityBefore !== undefined && identityAfter !== undefined) {
      const measured = { denied, statements: after.total - before.total, readinessStatements: after.readiness - before.readiness,
        identityStatements: identityAfter.total - identityBefore.total, identityReadinessStatements: identityAfter.readiness - identityBefore.readiness }
      await info.attach('denied-document-rpc-counts', { contentType: 'application/json', body: JSON.stringify(measured) })
      expect(measured.readinessStatements).toBeGreaterThanOrEqual(2)
      expect(measured.readinessStatements % 2).toBe(0)
      expect(measured.statements - measured.readinessStatements).toBe(
        denied * (measured.identityStatements - measured.identityReadinessStatements))
    }
    // The base permission still does not grant a stored document's specialty.
    await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2', [JSON.stringify(['documents.view', 'documents.edit']), email]))
    expect((await call('applyDocumentOperation', { documentIds: [documentId] })).error?.message).toContain('Недостаточно прав')
    expect(await withE2eDatabase(async db => (await db.query('select title from generated_documents where id=$1', [documentId])).rows[0].title)).toBe('PRIVATE AUDIT DOCUMENT')
    expect(await withE2eDatabase(async db => (await db.query('select count(*)::int count from audit_operations where actor_id=(select id from auth_users where email=$1) and action=$2', [email, 'applyDocumentOperation'])).rows[0].count)).toBe(0)
  } finally {
    await context.close()
    await withE2eDatabase(async db => {
      await db.query('delete from generated_documents where id=$1', [documentId])
      await db.query('delete from auth_users where email=$1', [email])
    })
  }
})

type RemovalCase = {
  name: string
  scope: 'lnk' | 'psto'
  stored: Record<string, string>
  cleared: Record<string, null>
  clearedStoredField: string
}
const primaryPsto = { psto_required: 'да', psto_request: 'PSTO-AUDIT-REQUEST', psto_request_date: '2026-01-02', psto_result: 'проведено', psto_date: '2026-01-03', heat_treatment_diagram: 'AUDIT-DIAGRAM' }
const removalCases: RemovalCase[] = [
  { name: 'LNK result', scope: 'lnk', stored: { has_vik: 'да', vik_request: 'VIK-AUDIT-REQUEST', vik_request_date: '2026-01-02', vik_result: 'годен', vik_conclusion: 'VIK-AUDIT-CONCLUSION', vik_conclusion_date: '2026-01-03' },
    cleared: { vikResult: null, vikConclusion: null, vikConclusionDate: null }, clearedStoredField: 'vik_conclusion' },
  { name: 'pending LNK request', scope: 'lnk', stored: { has_vik: 'да', vik_request: 'VIK-AUDIT-REQUEST', vik_request_date: '2026-01-02', vik_result: 'ожидает НК' },
    cleared: { vikRequest: null, vikRequestDate: null, vikResult: null }, clearedStoredField: 'vik_request' },
  { name: 'PSTO result', scope: 'psto', stored: primaryPsto,
    cleared: { pstoResult: null, pstoDate: null, heatTreatmentDiagram: null }, clearedStoredField: 'heat_treatment_diagram' },
  { name: 'pending PSTO request', scope: 'psto', stored: { psto_required: 'да', psto_request: 'PSTO-AUDIT-REQUEST', psto_request_date: '2026-01-02', psto_result: 'ожидает' },
    cleared: { pstoRequest: null, pstoRequestDate: null, pstoResult: null }, clearedStoredField: 'psto_request' },
  { name: 'TVMT result', scope: 'psto', stored: { ...primaryPsto, has_tvmt: 'да', tvmt_request: 'TVMT-AUDIT-REQUEST', tvmt_request_date: '2026-01-04', tvmt_result: 'годен', tvmt_conclusion: 'TVMT-AUDIT-CONCLUSION', tvmt_conclusion_date: '2026-01-05' },
    cleared: { tvmtResult: null, tvmtConclusion: null, tvmtConclusionDate: null }, clearedStoredField: 'tvmt_conclusion' },
  { name: 'pending TVMT request', scope: 'psto', stored: { ...primaryPsto, has_tvmt: 'да', tvmt_request: 'TVMT-AUDIT-REQUEST', tvmt_request_date: '2026-01-04', tvmt_result: 'ожидает НК' },
    cleared: { tvmtRequest: null, tvmtRequestDate: null, tvmtResult: null }, clearedStoredField: 'tvmt_request' },
]

for (const scenario of removalCases) for (const entry of ['single', 'batch', ...(scenario.name === 'LNK result' ? ['ui'] : [])]) {
  test(`${scenario.name}: ${entry} removal requires the separate delete permission`, async ({ browser, baseURL }) => {
    test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
    const email = `result-access-${randomUUID()}@e2e.test`, project = `ACCESS-RESULT-${randomUUID()}`, line = `AUDIT-${randomUUID()}`
    const permissions = ['welding.view', `${scenario.scope}.view`, `${scenario.scope}.edit`] as const
    await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Редактор без удаления', email, title: '', role: 'user', permissions: [...permissions] })
    await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
    const jointId = await withE2eDatabase(async db => {
      const program = (await db.query('insert into line_programs(project_title,line,psto_assignment) values($1,$2,$3) returning id', [project, line, scenario.scope === 'psto' ? 'assigned' : 'unassigned'])).rows[0].id
      const record = { project_title: project, line_program_id: program, line, joint: 'F1', connection_type: 'С17', officiality: 'действующий', revision_actuality: 'актуальная', weld_date: '2026-01-01', stamp_1_k: 'AAAA', ...scenario.stored }
      const keys = Object.keys(record)
      return (await db.query(`insert into weld_joints(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(record))).rows[0].id as number
    })
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
    const storedFacts = () => withE2eDatabase(async db => (await db.query('select to_jsonb(w) as record from weld_joints w where id=$1', [jointId])).rows[0].record)
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
      const page = await context.newPage()
      let observed = ''
      page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
      await page.goto('/account')
      await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
      const call = rpc(context.request, observed, baseURL!)
      const before = await call('getWeldJointById', { id: jointId }, 'GET')
      expect(before.error).toBeUndefined()
      let original = await storedFacts()
      const operation = entry === 'batch' ? 'updateWeldJoints' : 'updateWeldJoint'
      const patch = { ...scenario.cleared, [scenario.scope === 'lnk' ? 'lnkNote' : 'pstoNote']: 'must roll back with forbidden removal' }
      const payload = entry === 'batch'
        ? { records: [{ id: jointId, ...patch }], expectedVersions: [{ id: jointId, version: before.result.rowVersion }], mutationScope: scenario.scope }
        : { id: jointId, expectedVersion: before.result.rowVersion, mutationScope: scenario.scope, ...patch }
      if (entry === 'ui') {
        // Explain the missing delete right before preparing a change; ordinary
        // editing remains available. A forged RPC must still be rejected.
        await page.goto('/lnk')
        await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
        await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
        const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК', exact: true }) })
        await manager.getByLabel('Вид контроля в реестре').selectOption('vikRequest')
        await manager.getByPlaceholder('Стык, линия, заявка или заключение').fill(line)
        await manager.getByRole('button').filter({ hasText: `${line} · F1` }).click()
        // Opening the report can populate its persisted derived status. Take
        // the full-row baseline after that normal read-side preparation.
        original = await storedFacts()
        await expect(manager.getByRole('button', { name: 'Удалить результат', exact: true })).toBeDisabled()
        await expect(manager.getByText('Нет права удаления в ЛНК. Обратитесь к администратору.', { exact: true })).toBeVisible()
        await expect(manager.getByRole('group', { name: 'Изменить на:', exact: true }).getByRole('button', { name: 'ремонт', exact: true })).toBeEnabled()
        await expect(manager.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeDisabled()
        const current = await call('getWeldJointById', { id: jointId }, 'GET')
        const denied = await call(operation, { ...payload, expectedVersion: current.result.rowVersion })
        expect(denied.error?.message).toContain('Недостаточно прав')
        expect(denied.result).toBeUndefined()
      } else {
        const result = await call(operation, payload)
        expect(result.error?.message).toContain('Недостаточно прав')
        expect(result.result).toBeUndefined()
      }
      expect(await storedFacts()).toEqual(original)
      expect(await withE2eDatabase(async db => (await db.query('select count(*)::int count from audit_operations where actor_id=(select id from auth_users where email=$1) and action=any($2::text[])', [email, ['updateWeldJoint', 'updateWeldJoints']])).rows[0].count)).toBe(0)
      if (entry !== 'ui') {
        // Positive control: the same valid operation succeeds once delete is granted.
        await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2', [JSON.stringify([...permissions, `${scenario.scope}.delete`]), email]))
        const allowed = await call(operation, payload)
        expect(allowed.error).toBeUndefined()
        expect((await storedFacts())[scenario.clearedStoredField]).toBeNull()
      }
    } finally {
      await context.close()
      await withE2eDatabase(async db => {
        await db.query('delete from weld_joints where id=$1', [jointId])
        await db.query('delete from line_programs where project_title=$1', [project])
        await db.query('delete from auth_users where email=$1', [email])
      })
    }
  })
}
