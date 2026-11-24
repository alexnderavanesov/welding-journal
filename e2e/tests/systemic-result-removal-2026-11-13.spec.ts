import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../../src/db/schema'
import { preHeatTreatmentControls, weldJoints } from '../../src/db/schema'
import { WELD_TABLE_SELECT } from '../../src/server/weld-server-shared'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { syncPreHeatTreatmentDocumentsInTransaction } from '../../src/server/pre-heat-treatment-system-documents'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { confirmLnkResultChanges, lnkResultConfirmation } from '../lnk-result-confirmation'

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

async function seed(stage: 'primary' | 'beforeHeatTreatment', project: string, line: string, count = 1) {
  return withE2eDatabase(async db => {
    const program = (await db.query(`insert into line_programs(project_title,line,psto_assignment)
      values($1,$2,$3) returning id`, [project, line, stage === 'primary' ? 'unassigned' : 'assigned'])).rows[0].id
    const ids = (await db.query(`insert into weld_joints(line_program_id,project_title,line,joint,connection_type,
      officiality,revision_actuality,weld_date,stamp_1_k,has_vik,psto_required,pre_heat_treatment_required,final_status)
      select $1,$2,$3,'F'||n,'С17','действующий','актуальная','2026-01-01','AAAA','да',$4,$5,
        case when $5 then 'ожидает заявку' else 'годен' end
      from generate_series(1,$6::int) n returning id`, [program, project, line, stage === 'primary' ? null : 'да',
      stage === 'beforeHeatTreatment', count])).rows.map(row => row.id as number)
    if (stage === 'primary') await db.query(`update weld_joints set vik_request='DELETE-ONLY-REQUEST',vik_request_date='2026-01-02',
      vik_result='годен',vik_conclusion='DELETE-ONLY-CONCLUSION',vik_conclusion_date='2026-01-03',vik_defect_description='ДНО'
      where id=any($1::int[])`, [ids])
    else await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,
      conclusion_name,conclusion_date,defect_description) select id,'ВИК','DELETE-ONLY-REQUEST','2026-01-02','годен',
      'DELETE-ONLY-CONCLUSION','2026-01-03','ДНО' from weld_joints where id=any($1::int[])`, [ids])
    // Raw fixtures bypass the ordinary workflow's document synchronization.
    // Materialize the same complete documents before testing their real UI.
    await drizzle(db, { schema }).transaction(async tx => {
      const rows = await tx.select(WELD_TABLE_SELECT).from(weldJoints).where(inArray(weldJoints.id, ids))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
      if (stage === 'beforeHeatTreatment') {
        const controls = await tx.select().from(preHeatTreatmentControls).where(inArray(preHeatTreatmentControls.weldJointId, ids))
        await syncPreHeatTreatmentDocumentsInTransaction(tx, rows, controls)
      }
    })
    return ids
  })
}

async function account(permission: 'delete' | 'edit' = 'delete') {
  const email = `${permission}-only-results-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: permission === 'delete' ? 'Удаление результатов без редактирования' : 'Редактирование результатов без удаления', email, title: '', role: 'user',
    permissions: ['welding.view', 'lnk.view', `lnk.${permission}`] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
  return email
}

async function openManager(page: Page, stage: 'primary' | 'beforeHeatTreatment', line: string) {
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  if (stage === 'beforeHeatTreatment') await page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК' })
    .getByRole('button', { name: 'НК до ТО', exact: true }).click()
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', {
    name: stage === 'primary' ? 'Все результаты ЛНК' : 'Все результаты ЛНК до ТО', exact: true,
  }) })
  await manager.getByLabel('Вид контроля в реестре').selectOption(stage === 'primary' ? 'vikRequest' : 'ВИК')
  await manager.getByPlaceholder('Стык, линия, заявка или заключение').fill(line)
  await manager.getByRole('button').filter({ hasText: `${line} · F1` }).click()
  await manager.getByRole('button', { name: 'Редактировать', exact: true }).click()
  return manager
}

for (const stage of ['primary', 'beforeHeatTreatment'] as const) {
  for (const permission of ['delete', 'edit'] as const) {
  test(`${stage}: ${permission}-only user has the corresponding result actions in the real UI`, async ({ browser, baseURL }, info) => {
    test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
    const email = await account(permission), project = `RESULT-DELETE-${randomUUID()}`, line = `DELETE-${randomUUID()}`
    const [id] = await seed(stage, project, line)
    const settings = await withE2eDatabase(async db => {
      const previous = (await db.query("select value,updated_at from app_settings where key='control-processes'")).rows[0]
      const current = previous ? JSON.parse(previous.value) : {}
      await db.query(`insert into app_settings(key,value) values('control-processes',$1)
        on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({ ...current, preHeatTreatmentMode: 'allPsto' })])
      return previous
    })
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
    const facts = () => withE2eDatabase(async db => (await db.query(stage === 'primary'
      ? `select vik_result result,vik_conclusion conclusion,vik_conclusion_date::text date,vik_defect_description defect,
          vik_request request,vik_request_date::text request_date from weld_joints where id=$1`
      : `select result,conclusion_name conclusion,conclusion_date::text date,defect_description defect,
          request_name request,request_date::text request_date from pre_heat_treatment_controls where weld_joint_id=$1 and method='ВИК'`, [id])).rows[0])
    const alerts: string[] = []
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
      const page = await context.newPage(), manager = await openManager(page, stage, line)
      const before = await facts()
      if (permission === 'edit') {
        await expect(manager.getByRole('button', { name: 'Удалить результат', exact: true })).toBeDisabled()
        await expect(manager.getByText('Нет права удаления в ЛНК. Обратитесь к администратору.', { exact: true })).toBeVisible()
        page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept() })
        const correctedName = 'EDIT-ONLY-CORRECTED-CONCLUSION'
        await manager.getByRole('button', { name: 'К документу', exact: true }).click()
        await manager.getByLabel('Название документа', { exact: true }).fill(correctedName)
        await manager.getByRole('button', { name: 'Сохранить изменения документа', exact: true }).click()
        await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Сохранить изменения документа', exact: true }) })
          .getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
        await expect.poll(facts).toEqual({ ...before, conclusion: correctedName })
        expect(alerts.filter(message => message.includes('Недостаточно прав'))).toEqual([])
        return
      }
      await manager.getByRole('button', { name: 'Удалить результат', exact: true }).click()
      page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept() })
      await manager.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
      expect(alerts, 'Saving a pure deletion must use delete permission').toEqual([])
      await expect(lnkResultConfirmation(page)).toBeVisible()
      expect(await facts()).toEqual(before)
      await confirmLnkResultChanges(page)
      await expect.poll(facts).toEqual({ result: 'ожидает НК', conclusion: null, date: null, defect: null,
        request: 'DELETE-ONLY-REQUEST', request_date: '2026-01-02' })
      expect(alerts).toEqual([])
      await page.reload()
      expect((await facts()).request).toBe(before.request)
    } finally {
      await info.attach('native-alerts', { contentType: 'application/json', body: JSON.stringify(alerts) })
      await context.close()
      await cleanupLineProgramProjects([project])
      await withE2eDatabase(async db => {
        await db.query('delete from auth_users where email=$1', [email])
        await db.query("delete from app_settings where key='control-processes'")
        if (settings) await db.query("insert into app_settings(key,value,updated_at) values('control-processes',$1,$2)", [settings.value, settings.updated_at])
      })
    }
  })
  }
}

test('narrow result removal rejects forged edits and stale batches, then removes only selected facts', async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
  const email = await account(), project = `RESULT-RPC-${randomUUID()}`, line = `REMOVE-RPC-${randomUUID()}`
  const ids = await seed('primary', project, line, 2)
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const facts = () => withE2eDatabase(async db => (await db.query(
    'select to_jsonb(w) row from weld_joints w where id=any($1::int[]) order by id', [ids])).rows.map(item => item.row))
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const call = rpc(context.request, observed, baseURL!)
    const targets = []
    for (const rowId of ids) {
      const row = await call('getWeldJointById', { id: rowId }, 'GET')
      expect(row.error).toBeUndefined()
      targets.push({ rowId, methodKey: 'vikRequest', expectedVersion: row.result.rowVersion })
    }
    const before = await facts()
    for (const forged of [
      { targets, lnkNote: 'forged note' },
      { targets: [{ ...targets[0], lnkNote: 'forged note' }] },
      { targets: [{ ...targets[0], result: 'ремонт' }] },
      { targets: [{ ...targets[0], methodKey: 'pstoRequest' }] },
      { targets: [targets[0], { ...targets[1], expectedVersion: '0' }] },
    ]) {
      expect((await call('removeLnkResults', forged)).error).toBeDefined()
      expect(await facts()).toEqual(before)
    }
    // A narrow delete command must not grant permission to the general editor.
    expect((await call('updateWeldJoint', { id: ids[0], mutationScope: 'lnk', expectedVersion: targets[0].expectedVersion,
      vikResult: null, vikConclusion: null, vikConclusionDate: null, lnkNote: 'forged note' })).error?.message).toContain('Недостаточно прав')
    await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2',
      [JSON.stringify(['welding.view', 'lnk.view']), email]))
    expect((await call('removeLnkResults', { targets })).error?.message).toContain('Недостаточно прав')
    expect(await facts()).toEqual(before)
    expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int n from audit_operations
      where actor_id=(select id from auth_users where email=$1) and action='removeLnkResults'`, [email])).rows[0].n)).toBe(0)
    await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2',
      [JSON.stringify(['welding.view', 'lnk.view', 'lnk.delete']), email]))
    expect((await call('removeLnkResults', { targets })).error).toBeUndefined()
    const after = await facts()
    for (const [index, row] of after.entries()) {
      expect(row).toMatchObject({ id: ids[index], vik_result: 'ожидает НК', vik_conclusion: null, vik_conclusion_date: null,
        vik_defect_description: null, vik_request: before[index].vik_request, vik_request_date: before[index].vik_request_date,
        lnk_note: before[index].lnk_note, joint: before[index].joint, weld_date: before[index].weld_date })
    }
    const audit = await withE2eDatabase(async db => (await db.query(`select o.id,c.joint_id,c.changes from audit_operations o
      join audit_changes c on c.operation_id=o.id where o.actor_id=(select id from auth_users where email=$1)
      and o.action='removeLnkResults' and c.entity='weld_joints' order by c.joint_id`, [email])).rows)
    expect(new Set(audit.map(row => row.id)).size).toBe(1)
    expect(audit.map(row => row.joint_id)).toEqual(ids)
    expect(audit.every(row => row.changes.vikResult?.origin === 'user')).toBe(true)
  } finally {
    await context.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})

test('legacy VIK cannot be removed ahead of its recorded RK through either generic or narrow RPC', async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
  const email = await account(), project = `LEGACY-REMOVE-${randomUUID()}`, line = `LEGACY-${randomUUID()}`
  const [id] = await seed('primary', project, line)
  await withE2eDatabase(async db => {
    await db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2',
      [JSON.stringify(['welding.view', 'lnk.view', 'lnk.edit', 'lnk.delete']), email])
    await db.query(`update weld_joints set has_rk='да',rk_request='RK-REQUEST',rk_request_date='2026-01-03',
      rk_result='годен',rk_conclusion='RK-CONCLUSION',rk_conclusion_date='2026-01-04' where id=$1`, [id])
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
    const call = rpc(context.request, observed, baseURL!)
    for (const result of ['да', 'не годен', 'негоден']) {
      await withE2eDatabase(db => db.query('update weld_joints set vik_result=$1 where id=$2', [result, id]))
      const loaded = await call('getWeldJointById', { id }, 'GET')
      expect(loaded.error).toBeUndefined()
      const version = loaded.result.rowVersion, before = await facts()
      const patch = { id, vikResult: null, vikConclusion: null, vikConclusionDate: null, vikDefectDescription: null,
        lnkNote: 'must not survive rejected removal' }
      for (const [name, data] of [
        ['updateWeldJoint', { ...patch, expectedVersion: version, mutationScope: 'lnk' }],
        ['updateWeldJoints', { records: [patch], expectedVersions: [{ id, version }], mutationScope: 'lnk' }],
        ['removeLnkResults', { targets: [{ rowId: id, methodKey: 'vikRequest', expectedVersion: version }] }],
      ] as const) {
        expect((await call(name, data)).error?.message).toContain('Результат ВИК нельзя удалить, пока сохранены результаты следующих видов НК: РК')
        expect(await facts()).toEqual(before)
      }
    }
    expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int n from audit_operations
      where actor_id=(select id from auth_users where email=$1) and action=any($2::text[])`,
      [email, ['updateWeldJoint', 'updateWeldJoints', 'removeLnkResults']])).rows[0].n)).toBe(0)
  } finally {
    await context.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})
