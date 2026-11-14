import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { completeAccountLink, inviteAccount } from '../../src/server/account-management'
import type { Permission } from '../../src/lib/access-permissions'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { asE2eOwner } from '../with-owner-access'

test.beforeEach(resetE2eAccountFixtureLimits)
const scenarios = [
  { operation: 'manageLnkRequestDocument', area: 'lnk', kind: 'lnk', edit: 'rename', ui: false },
  { operation: 'managePstoRequestDocument', area: 'psto', kind: 'psto', edit: 'rename', ui: false },
  { operation: 'correctPstoCycleStage', area: 'psto', kind: 'psto', edit: 'update', ui: false },
  { operation: 'correctPreHeatTreatmentLnkResult', area: 'lnk', kind: 'pre', edit: 'update', ui: false },
  { operation: 'manageLnkRequestDocument', area: 'lnk', kind: 'lnk', edit: 'rename', ui: true },
] as const

for (const scenario of scenarios) test(`${scenario.operation}: delete-only ${scenario.ui ? 'UI' : 'RPC'} works and cannot edit`, async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
  const id = randomUUID(), project = `DELETE-ONLY-${id}`, line = `L-${id}`, requestName = `REQUEST-${id}`, email = `delete-${id}@e2e.test`
  const rights = (action: 'edit' | 'delete') => ['welding.view', `${scenario.area}.view`, `${scenario.area}.${action}`] as Permission[]
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Удаление без редактирования', email, title: '', role: 'user', permissions: rights('edit') })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
  const fixture = await withE2eDatabase(async db => {
    const lineId = (await db.query('insert into line_programs(project_title,line,psto_assignment) values($1,$2,$3) returning id', [project, line, scenario.kind === 'lnk' ? 'unassigned' : 'assigned'])).rows[0].id
    const record: Record<string, unknown> = { project_title: project, line, line_program_id: lineId, joint: 'F1', connection_type: 'С17', officiality: 'действующий', revision_actuality: 'актуальная', weld_date: '2026-01-01', stamp_1_k: 'AAAA' }
    if (scenario.kind === 'lnk') Object.assign(record, { has_vik: 'да', vik_request: requestName, vik_request_date: '2026-01-02', vik_result: 'ожидает НК' })
    else Object.assign(record, { psto_required: 'да', ...(scenario.kind === 'psto' ? { psto_request: requestName, psto_request_date: '2026-01-02', psto_result: 'ожидает' } : { pre_heat_treatment_required: true, has_vik: 'да' }) })
    const keys = Object.keys(record)
    const rowId = (await db.query(`insert into weld_joints(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(record))).rows[0].id
    const relationId = scenario.kind === 'pre' ? (await db.query("insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result) values($1,'ВИК',$2,'2026-01-02','ожидает НК') returning id", [rowId, requestName])).rows[0].id : undefined
    return { rowId, relationId }
  })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const readFacts = () => withE2eDatabase(async db => ({
    row: (await db.query('select to_jsonb(w) as row from weld_joints w where id=$1', [fixture.rowId])).rows[0].row,
    controls: (await db.query('select to_jsonb(c) as row from pre_heat_treatment_controls c where weld_joint_id=$1', [fixture.rowId])).rows.map(row => row.row),
  }))
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
      return await deserializeRpcResponse(await (await context.request.fetch(url.href, { method, ...(method === 'POST' ? { data: encoded } : {}),
        headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })).text()) as { result?: any; error?: Error }
    }
    const before = await call('getWeldJointById', { id: fixture.rowId }, 'GET')
    expect(before.error).toBeUndefined()
    const original = await readFacts()
    const payload = { action: 'delete', requestName, requestDate: '2026-01-02', expectedVersions: [{ id: fixture.rowId, version: before.result.rowVersion }],
      rowId: fixture.rowId, expectedVersion: before.result.rowVersion, sequence: 1, stage: scenario.kind === 'pre' ? 'request' : 'pstoRequest', relationId: fixture.relationId }
    expect((await call(scenario.operation, payload)).error?.message).toContain('Недостаточно прав')
    expect(await readFacts()).toEqual(original)
    await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2', [JSON.stringify(rights('delete')), email]))
    expect((await call(scenario.operation, { ...payload, action: scenario.edit, nextRequestName: 'FORGED', name: 'FORGED', result: 'годен' })).error?.message).toContain('Недостаточно прав')
    for (const action of ['delete-and-update', null]) expect((await call(scenario.operation, { ...payload, action })).error).toBeDefined()
    expect(await readFacts()).toEqual(original)
    if (scenario.ui) {
      await page.goto('/lnk')
      await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
      await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
      const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование заявок ЛНК', exact: true }) })
      await manager.getByPlaceholder('Название, дата, стык или линия').fill(requestName)
      await manager.getByRole('button').filter({ hasText: requestName }).click()
      await manager.getByRole('button', { name: 'Дополнительные действия с заявкой', exact: true }).click()
      await manager.getByRole('button', { name: 'Удалить выбранную заявку', exact: true }).click()
      const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Удалить заявку ЛНК', exact: true }) })
      await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
      await expect.poll(async () => (await readFacts()).row.vik_request).toBeNull()
    } else {
      // Extraneous edit fields cannot turn an explicit delete into an edit.
      const saved = await call(scenario.operation, { ...payload, nextRequestName: 'FORGED', name: 'FORGED', result: 'годен' })
      expect(saved.error).toBeUndefined()
    }
    const actual = await readFacts()
    if (scenario.kind === 'pre') expect(actual.controls).toEqual([])
    else expect(actual.row[scenario.kind === 'lnk' ? 'vik_request' : 'psto_request']).toBeNull()
    expect(JSON.stringify(actual)).not.toContain('FORGED')
    expect(actual.row.joint).toBe('F1')
  } finally {
    await context.close()
    await withE2eDatabase(async db => {
      await db.query('delete from weld_joints where id=$1', [fixture.rowId])
      await db.query('delete from line_programs where project_title=$1', [project])
      await db.query('delete from auth_users where email=$1', [email])
    })
  }
})
