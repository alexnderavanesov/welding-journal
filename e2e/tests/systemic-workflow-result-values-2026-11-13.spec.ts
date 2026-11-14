import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'

test.beforeEach(resetE2eAccountFixtureLimits)

function rpc(client: APIRequestContext, observed: string, baseURL: string) {
  return async (name: string, data: unknown, method = 'POST') => {
    const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`))
    const encoded = await serializeRpcData(data)
    if (method === 'GET') url.searchParams.set('payload', encoded)
    const response = await client.fetch(url.href, { method, ...(method === 'POST' ? { data: encoded } : {}),
      headers: { origin: baseURL, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    return await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
  }
}

const cases = [
  { key: 'vikResult', db: 'vik_result', method: 'vik', scope: 'lnk' },
  { key: 'rkResult', db: 'rk_result', method: 'rk', scope: 'lnk' },
  { key: 'uzkResult', db: 'uzk_result', method: 'uzk', scope: 'lnk' },
  { key: 'pvkResult', db: 'pvk_result', method: 'pvk', scope: 'lnk' },
  { key: 'pstoResult', db: 'psto_result', method: 'psto', scope: 'psto' },
  { key: 'tvmtResult', db: 'tvmt_result', method: 'tvmt', scope: 'psto' },
] as const

for (const scenario of cases) test(`${scenario.key}: generic RPC rejects unknown new results and preserves untouched legacy history`, async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
  const email = `workflow-enum-${randomUUID()}@e2e.test`, project = `WORKFLOW-ENUM-${randomUUID()}`, line = `ENUM-${randomUUID()}`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Редактор результатов', email, title: '', role: 'user',
    permissions: ['welding.view', `${scenario.scope}.view`, `${scenario.scope}.edit`] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
  const id = await withE2eDatabase(async db => {
    const program = (await db.query(`insert into line_programs(project_title,line,psto_assignment) values($1,$2,$3) returning id`,
      [project, line, scenario.scope === 'psto' ? 'assigned' : 'unassigned'])).rows[0].id
    const record: Record<string, unknown> = { project_title: project, line_program_id: program, line, joint: 'F1',
      connection_type: 'С17', officiality: 'действующий', revision_actuality: 'актуальная', weld_date: '2026-01-01',
      stamp_1_k: 'AAAA', d1: 159, d2: 159, t1: 8, t2: 8 }
    if (scenario.scope === 'lnk') Object.assign(record, { [`has_${scenario.method}`]: 'да',
      [`${scenario.method}_request`]: 'REQUEST', [`${scenario.method}_request_date`]: '2026-01-02', [scenario.db]: 'ожидает НК' })
    else Object.assign(record, { psto_required: 'да', psto_request: 'PSTO-REQUEST', psto_request_date: '2026-01-02', psto_result: 'ожидает' })
    if (scenario.method === 'tvmt') Object.assign(record, { psto_result: 'проведено', heat_treatment_diagram: 'DIAGRAM',
      psto_date: '2026-01-03', has_tvmt: 'да', tvmt_request: 'TVMT-REQUEST', tvmt_request_date: '2026-01-04', tvmt_result: 'ожидает НК' })
    const keys = Object.keys(record)
    return (await db.query(`insert into weld_joints(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(record))).rows[0].id as number
  })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const facts = () => withE2eDatabase(async db => (await db.query('select to_jsonb(w) row from weld_joints w where id=$1', [id])).rows[0].row)
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const call = rpc(context.request, observed, baseURL!), loaded = await call('getWeldJointById', { id }, 'GET')
    expect(loaded.error).toBeUndefined()
    const version = loaded.result.rowVersion, before = await facts()
    for (const invalid of ['INVALID-RESULT', 'ожидает INVALID', { result: 'годен' }, 42]) for (const entry of ['single', 'batch']) {
      const patch = { id, [scenario.key]: invalid, [scenario.scope === 'lnk' ? 'lnkNote' : 'pstoNote']: 'must roll back' }
      const response = entry === 'single'
        ? await call('updateWeldJoint', { ...patch, expectedVersion: version, mutationScope: scenario.scope })
        : await call('updateWeldJoints', { records: [patch], expectedVersions: [{ id, version }], mutationScope: scenario.scope })
      expect(response.error?.message).toContain('не распознано')
      expect(await facts()).toEqual(before)
    }
    expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int n from audit_operations
      where actor_id=(select id from auth_users where email=$1) and action=any($2::text[])`,
      [email, ['updateWeldJoint', 'updateWeldJoints']])).rows[0].n)).toBe(0)
    // Imported old history can contain unknown text; unrelated factual repairs
    // must not force the operator to rewrite that historical result.
    const descriptionField = scenario.scope === 'lnk' ? scenario.method === 'rk' ? 'lnk_defect_description' : `${scenario.method}_defect_description` : undefined
    await withE2eDatabase(db => db.query(`update weld_joints set ${scenario.db}='HISTORICAL-UNKNOWN'${descriptionField ? `,${descriptionField}='Recorded legacy defect details'` : ''} where id=$1`, [id]))
    const legacy = await call('getWeldJointById', { id }, 'GET')
    expect(legacy.error).toBeUndefined()
    const noteKey = scenario.scope === 'lnk' ? 'lnkNote' : 'pstoNote'
    expect((await call('updateWeldJoint', { id, [noteKey]: 'Уточнение', expectedVersion: legacy.result.rowVersion,
      mutationScope: scenario.scope })).error).toBeUndefined()
    expect(await facts()).toMatchObject({ [scenario.db]: 'HISTORICAL-UNKNOWN',
      ...(descriptionField ? { [descriptionField]: 'Recorded legacy defect details' } : {}),
      [scenario.scope === 'lnk' ? 'lnk_note' : 'psto_note']: 'Уточнение' })
    const afterSingle = await call('getWeldJointById', { id }, 'GET')
    expect(afterSingle.error).toBeUndefined()
    expect((await call('updateWeldJoints', { records: [{ id, [noteKey]: 'Групповое уточнение' }],
      expectedVersions: [{ id, version: afterSingle.result.rowVersion }], mutationScope: scenario.scope })).error).toBeUndefined()
    expect(await facts()).toMatchObject({ [scenario.db]: 'HISTORICAL-UNKNOWN',
      ...(descriptionField ? { [descriptionField]: 'Recorded legacy defect details' } : {}),
      [scenario.scope === 'lnk' ? 'lnk_note' : 'psto_note']: 'Групповое уточнение' })
  } finally {
    await context.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})

async function boundaryAccount(scope: 'lnk' | 'psto') {
  const email = `boundary-result-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Редактор границы результатов', email, title: '', role: 'user',
    permissions: ['welding.view', `${scope}.view`, `${scope}.edit`] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
  return email
}

async function boundaryFixture(project: string, extra: Record<string, unknown>) {
  return withE2eDatabase(async db => {
    const program = (await db.query(`insert into line_programs(project_title,line,psto_assignment) values($1,'L',$2) returning id`,
      [project, extra.psto_required ? 'assigned' : 'unassigned'])).rows[0].id
    const record = { project_title: project, line_program_id: program, line: 'L', joint: 'F1', connection_type: 'С17',
      weld_date: '2026-01-01', has_vik: 'да', officiality: 'действующий', revision_actuality: 'актуальная', stamp_1_k: 'AAAA', ...extra }
    const keys = Object.keys(record)
    return (await db.query(`insert into weld_joints(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(record))).rows[0].id as number
  })
}

const completedPsto = { psto_required: 'да', psto_request: 'PSTO-REQUEST', psto_request_date: '2026-01-02',
  psto_result: 'проведено', psto_date: '2026-01-03', heat_treatment_diagram: 'DIAGRAM', has_tvmt: 'да' }
for (const scope of ['lnk', 'psto'] as const) for (const hasRequest of [false, true]) for (const entry of ['single', 'batch']) {
  test(`${scope} ${entry}: recognized alias cannot bypass ${hasRequest ? 'conclusion/date' : 'request'} requirements`, async ({ browser, baseURL }) => {
    test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
    const email = await boundaryAccount(scope), project = `ALIAS-BOUNDARY-${randomUUID()}`
    const extra = scope === 'lnk'
      ? hasRequest ? { vik_request: 'VIK-REQUEST', vik_request_date: '2026-01-02' } : {}
      : { ...completedPsto, ...(hasRequest ? { tvmt_request: 'TVMT-REQUEST', tvmt_request_date: '2026-01-04' } : {}) }
    const id = await boundaryFixture(project, extra)
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
    const facts = () => withE2eDatabase(async db => (await db.query('select to_jsonb(w) row from weld_joints w where id=$1', [id])).rows[0].row)
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
      const page = await context.newPage()
      let observed = ''
      page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
      await page.goto('/account')
      await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
      const call = rpc(context.request, observed, baseURL!), loaded = await call('getWeldJointById', { id }, 'GET')
      expect(loaded.error).toBeUndefined()
      const before = await facts(), version = loaded.result.rowVersion
      const patch = { id, ...(scope === 'lnk' ? { vikResult: 'да', lnkNote: 'must roll back' }
        : { tvmtResult: 'годен (отменен)', pstoNote: 'must roll back' }) }
      const name = entry === 'single' ? 'updateWeldJoint' : 'updateWeldJoints'
      const response = await call(name, entry === 'single' ? { ...patch, expectedVersion: version, mutationScope: scope }
        : { records: [patch], expectedVersions: [{ id, version }], mutationScope: scope })
      const after = await facts()
      expect({ blocked: Boolean(response.error), result: after[scope === 'lnk' ? 'vik_result' : 'tvmt_result'] })
        .toMatchObject({ blocked: true, result: before[scope === 'lnk' ? 'vik_result' : 'tvmt_result'] })
      expect(after).toEqual(before)
      expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int n from audit_operations
        where actor_id=(select id from auth_users where email=$1) and action=$2`, [email, name])).rows[0].n)).toBe(0)
    } finally {
      await context.close()
      await cleanupLineProgramProjects([project])
      await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
    }
  })
}

for (const kind of ['vik', 'psto', 'tvmt'] as const) for (const entry of ['single', 'batch']) {
  test(`${kind} ${entry}: opaque stored result removal needs delete while preserving its request`, async ({ browser, baseURL }) => {
    test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
    const scope = kind === 'vik' ? 'lnk' : 'psto', email = await boundaryAccount(scope), project = `OPAQUE-BOUNDARY-${randomUUID()}`
    const extra = { ...(kind === 'psto' ? { psto_required: 'да' } : kind === 'tvmt' ? completedPsto : {}),
      [`${kind}_request`]: 'REQUEST', [`${kind}_request_date`]: kind === 'tvmt' ? '2026-01-04' : '2026-01-02',
      [`${kind}_result`]: 'HISTORICAL-UNKNOWN' }
    const id = await boundaryFixture(project, extra)
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
    const facts = () => withE2eDatabase(async db => (await db.query('select to_jsonb(w) row from weld_joints w where id=$1', [id])).rows[0].row)
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
      const page = await context.newPage()
      let observed = ''
      page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
      await page.goto('/account')
      await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
      const call = rpc(context.request, observed, baseURL!), loaded = await call('getWeldJointById', { id }, 'GET')
      expect(loaded.error).toBeUndefined()
      const before = await facts(), version = loaded.result.rowVersion
      const patch = { id, [`${kind}Result`]: null, [scope === 'lnk' ? 'lnkNote' : 'pstoNote']: 'must roll back' }
      const name = entry === 'single' ? 'updateWeldJoint' : 'updateWeldJoints'
      const payload = entry === 'single' ? { ...patch, expectedVersion: version, mutationScope: scope }
        : { records: [patch], expectedVersions: [{ id, version }], mutationScope: scope }
      expect((await call(name, payload)).error?.message).toContain('Недостаточно прав')
      expect(await facts()).toEqual(before)
      expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int n from audit_operations
        where actor_id=(select id from auth_users where email=$1) and action=$2`, [email, name])).rows[0].n)).toBe(0)
      await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2',
        [JSON.stringify(['welding.view', `${scope}.view`, `${scope}.edit`, `${scope}.delete`]), email]))
      expect((await call(name, payload)).error).toBeUndefined()
      const after = await facts()
      expect(after[`${kind}_result`]).not.toBe('HISTORICAL-UNKNOWN')
      expect(after[`${kind}_request`]).toBe('REQUEST')
      expect(after[`${kind}_request_date`]).toBe(before[`${kind}_request_date`])
    } finally {
      await context.close()
      await cleanupLineProgramProjects([project])
      await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
    }
  })
}
