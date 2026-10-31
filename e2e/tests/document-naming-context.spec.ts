import { expect, test } from '@playwright/test'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS, getRequestConclusionNamingKind } from '../../src/lib/request-conclusion-settings'
import { asE2eOwner } from '../with-owner-access'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { eq } from 'drizzle-orm'
import { updateWeldJointRows } from '../../src/server/weld-mutations'
import { prepareDocumentCreationIndex } from '../../src/server/document-name-conflicts'
import { readRequestConclusionSettings, readSystemDocumentNextNumbers, reserveSystemDocumentNames, type SystemDocumentSequenceUpdate } from '../../src/server/system-document-sequences'
import { SYSTEM_DOCUMENT_SEQUENCE_IDS } from '../../src/lib/system-document-sequence-id'
import type { WeldBatchUpdateData } from '../../src/server/weld-contracts'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { getWeldLineMembershipLockKeys } from '../../src/server/weld-line-membership-lock'
import { randomUUID } from 'node:crypto'
import { resetE2eAccountFixtureLimits, latestE2eToken } from '../authentication'
import { inviteAccount, completeAccountLink, changeAccount } from '../../src/server/account-management'
import { replaceWeldJoints } from '../../src/server/weld-import'
import { syncPreHeatTreatmentDocumentsInTransaction } from '../../src/server/pre-heat-treatment-system-documents'
import { preHeatTreatmentControls } from '../../src/db/schema'

const project = 'E2E naming context'
let originalSettings: { value: string; updated_at: Date } | undefined
test.beforeEach(async () => {
  await withLineProgramFixture(async db => {
    originalSettings = (await db.query("select value,updated_at from app_settings where key='request-conclusion'")).rows[0]
    const settings = structuredClone(REQUEST_CONCLUSION_DEFAULT_SETTINGS)
    settings.lnkRequest.systemPattern = 'Заявка НК №{{Шифр}}-{{№}}'
    settings.lnkConclusion.systemPattern = 'Заключение НК №{{Проект}}-{{Шифр}}-{{Линия}}-{{№}}'
    settings.splitModes.lnkRequest = 'line'
    await db.query("insert into app_settings(key,value) values('request-conclusion',$1) on conflict(key) do update set value=excluded.value", [JSON.stringify(settings)])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,psto_required)
      select $1,'CONTEXT-'||n,'CONTEXT-L'||n,'F910'||n,'2026-10-01','С17','действующий','актуальная','да','нет' from generate_series(1,2) n`, [project])
  })
})

const save = asE2eOwner(updateWeldJointRows, 'lnk.edit')
const savePsto = asE2eOwner(updateWeldJointRows, 'psto.edit')
const date = '2026-10-30'
const kinds = ['lnkRequest', 'lnkConclusionVik', 'pstoRequest', 'pstoConclusion', 'tvmtRequest', 'tvmtConclusion'] as const

async function prepare(kind: typeof kinds[number] = 'lnkRequest') {
  await withLineProgramFixture(async db => {
    const settings = structuredClone(REQUEST_CONCLUSION_DEFAULT_SETTINGS)
    for (const key of ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion', 'tvmtRequest', 'tvmtConclusion'] as const) {
      settings[key].systemPattern = `${key}-{{Проект}}-{{Шифр}}-{{Линия}}-{{№}}`
    }
    await db.query("update app_settings set value=$1 where key='request-conclusion'", [JSON.stringify(settings)])
    if (kind !== 'lnkRequest') await db.query(`update weld_joints set vik_request='Existing NK '||line,vik_request_date='2026-10-02',vik_result='ожидает НК' where project_title=$1`, [project])
    if (kind.startsWith('psto') || kind.startsWith('tvmt')) {
      await db.query(`update weld_joints set psto_required='да',has_tvmt='да',vik_request=null,vik_request_date=null,vik_result=null,vik_conclusion=null,vik_conclusion_date=null where project_title=$1`, [project])
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
        select id,'ВИК','Existing pre NK '||line,'2026-10-02','годен','Existing pre VIK '||line,'2026-10-03' from weld_joints where project_title=$1`, [project])
    }
    if (kind === 'pstoConclusion' || kind.startsWith('tvmt')) await db.query(`update weld_joints set psto_request='Existing PSTO '||line,psto_request_date='2026-10-04' where project_title=$1`, [project])
    if (kind.startsWith('tvmt')) await db.query(`update weld_joints set psto_result='проведено',psto_date='2026-10-05',heat_treatment_diagram='Existing diagram '||line where project_title=$1`, [project])
    if (kind === 'tvmtConclusion') await db.query(`update weld_joints set tvmt_request='Existing TVMT '||line,tvmt_request_date='2026-10-06',tvmt_result='ожидает НК' where project_title=$1`, [project])
  })
  const rows = await requireDb().select().from(weldJoints).where(eq(weldJoints.projectTitle, project)).orderBy(weldJoints.id)
  // SQL fixture setup must publish its historical documents before comparing
  // them with a real save; an already initialized index skips later raw seeds.
  await requireDb().transaction(tx => syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map()))
  const field = ({ lnkRequest: 'vikRequest', lnkConclusionVik: 'vikConclusion', pstoRequest: 'pstoRequest', pstoConclusion: 'heatTreatmentDiagram', tvmtRequest: 'tvmtRequest', tvmtConclusion: 'tvmtConclusion' } as const)[kind]
  const request: SystemDocumentSequenceUpdate = { type: kind === 'lnkConclusionVik' || kind === 'tvmtConclusion' ? 'lnkConclusion' : kind === 'tvmtRequest' ? 'lnkRequest' : kind,
    date, fieldKeys: [field], provisionalName: 'preview', ...(kind.startsWith('tvmt') ? { methodCode: 'ТВМТ' } : kind === 'lnkConclusionVik' ? { methodCode: 'ВИК' } : {}) }
  request.namingPattern = (await readRequestConclusionSettings(requireDb()))[getRequestConclusionNamingKind(request)].systemPattern
  const names = await requireDb().transaction(tx => reserveSystemDocumentNames(tx, rows.map(row => ({ request, rows: [row] })), { previewOnly: true }))
  const expectedVersions = await withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where project_title=$1 order by id', [project])).rows)
  const data: WeldBatchUpdateData = {
    mutationScope: kind.startsWith('psto') || kind.startsWith('tvmt') ? 'psto' : 'lnk',
    expectedVersions,
    documentGrouping: { settingId: kind, mode: 'line' },
    systemDocumentSequences: names.map(item => ({ ...request, provisionalName: item.name })),
    records: rows.map((row, i) => ({ id: row.id, [field]: names[i].name,
      ...({ lnkRequest: { vikRequestDate: date, vikResult: 'ожидает НК' }, lnkConclusionVik: { vikConclusionDate: date, vikResult: 'годен' },
        pstoRequest: { pstoRequestDate: date }, pstoConclusion: { pstoDate: date, pstoResult: 'проведено' },
        tvmtRequest: { tvmtRequestDate: date, tvmtResult: 'ожидает НК' }, tvmtConclusion: { tvmtConclusionDate: date, tvmtResult: 'годен' } }[kind]),
    })),
  }
  await prepareDocumentCreationIndex(data.documentGrouping)
  return { data, rows, names, field }
}

async function snapshot() {
  return withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    documents: (await db.query('select * from generated_documents order by id')).rows,
    links: (await db.query('select * from generated_document_weld_joints order by document_id,weld_joint_id')).rows,
    counters: await readSystemDocumentNextNumbers(requireDb(), SYSTEM_DOCUMENT_SEQUENCE_IDS),
    settings: (await db.query("select * from app_settings where key='request-conclusion'")).rows,
    audit: (await db.query('select id from audit_operations order by id')).rows,
  }))
}

for (const kind of kinds) test(`${kind}: partial save resolves all naming fields from stored rows and preserves document links`, async () => {
  const { data, rows, names, field } = await prepare(kind)
  const before = await snapshot()
  const saved = await (data.mutationScope === 'psto' ? savePsto : save)(data)
  expect(saved.map(row => row[field])).toEqual(names.map(item => item.name))
  expect(saved.map(row => [row.projectTitle, row.subtitleCode, row.line, row.joint])).toEqual(rows.map(row => [row.projectTitle, row.subtitleCode, row.line, row.joint]))
  const after = await snapshot()
  const oldIds = new Set(before.documents.map(doc => doc.id))
  // Index refresh may advance updated_at; document identity, content and links must survive.
  const content = ({ updated_at: _updated, ...document }: Record<string, unknown>) => document
  expect(after.documents.filter(doc => oldIds.has(doc.id)).map(content)).toEqual(before.documents.map(content))
  // Index initialization may recreate the derived assignment rows. The same
  // document/joint pairs must survive; their index timestamps are not history.
  const assignment = ({ document_id, weld_joint_id }: Record<string, unknown>) => ({ document_id, weld_joint_id })
  expect(after.links.filter(link => oldIds.has(link.document_id)).map(assignment)).toEqual(before.links.map(assignment))
  const created = after.documents.filter(doc => !oldIds.has(doc.id))
  expect(created.map(doc => doc.title).sort()).toEqual(names.map(item => item.name).sort())
  for (const [i, name] of names.entries()) {
    const doc = created.find(doc => doc.title === name.name)!
    expect(after.links.filter(link => link.document_id === doc.id).map(link => link.weld_joint_id)).toEqual([rows[i].id])
  }
})

test('stale versions, changed names and forged context roll back facts, links, counters and history; retry succeeds', async () => {
  const { data } = await prepare()
  const before = await snapshot()
  await expect(save({ ...data, expectedVersions: data.expectedVersions.map(item => ({ ...item, version: '0' })) })).rejects.toThrow(/устарели|уже изменен/)
  expect(await snapshot()).toEqual(before)
  const wrong = structuredClone(data)
  wrong.records[1].vikRequest = 'Not the shown name'
  wrong.systemDocumentSequences![1].provisionalName = 'Not the shown name'
  await expect(save(wrong)).rejects.toMatchObject({ code: 'DOCUMENT_CONTEXT_CHANGED' })
  expect(await snapshot()).toEqual(before)
  const forged = structuredClone(data)
  forged.records[0].subtitleCode = 'FORGED'
  await expect(save(forged)).rejects.toThrow('недоступно для изменения')
  expect(await snapshot()).toEqual(before)
  const forgedReadiness = { ...data, records: data.records.map(record => ({ ...record, controlWorkflowAccess: { welded: true, heatTreatmentState: 'complete' } })) }
  await expect(save(forgedReadiness)).rejects.toThrow('недоступно для изменения')
  expect(await snapshot()).toEqual(before)
  await save(data)
  expect((await snapshot()).documents.length).toBe(before.documents.length + 2)
})

test('a moved row rejects the old naming context without consuming a number or changing document links', async () => {
  const { data } = await prepare()
  await withE2eDatabase(db => db.query('update weld_joints set subtitle_code=$1 where id=$2', ['MOVED', data.records[0].id]))
  const before = await snapshot()
  await expect(save(data)).rejects.toMatchObject({ code: 'DOCUMENT_CONTEXT_CHANGED' })
  expect(await snapshot()).toEqual(before)
})

for (const kind of kinds) test(`${kind}: replay after a lost successful response cannot duplicate documents, consume another number or rewrite history`, async () => {
  const { data } = await prepare(kind)
  const apply = data.mutationScope === 'psto' ? savePsto : save
  await apply(data) // The client does not receive/use this successful response.
  const committed = await snapshot()
  await expect(apply(structuredClone(data))).rejects.toThrow(/уже изменен|системное имя уже занято/)
  expect(await snapshot()).toEqual(committed)
})

for (const kind of kinds) test(`${kind}: changed naming settings reject the old preview atomically and a fresh preview can save`, async () => {
  const { data, rows } = await prepare(kind)
  const apply = data.mutationScope === 'psto' ? savePsto : save
  const settings = await readRequestConclusionSettings(requireDb())
  const namingKind = getRequestConclusionNamingKind(data.systemDocumentSequences![0])
  settings[namingKind].systemPattern = `UPDATED-${settings[namingKind].systemPattern}`
  await withE2eDatabase(db => db.query("update app_settings set value=$1 where key='request-conclusion'", [JSON.stringify(settings)]))
  const before = await snapshot()
  await expect(apply(data)).rejects.toMatchObject({ code: 'DOCUMENT_SETTINGS_CHANGED' })
  expect(await snapshot()).toEqual(before)
  const fresh = await requireDb().transaction(tx => reserveSystemDocumentNames(tx, data.systemDocumentSequences!.map((request, i) => ({ request, rows: [rows[i]] })), { previewOnly: true }))
  data.systemDocumentSequences = fresh.map(item => ({ ...item.request, provisionalName: item.name, namingPattern: settings[namingKind].systemPattern }))
  for (const [i, entry] of data.systemDocumentSequences.entries()) data.records[i] = {
    ...data.records[i], ...Object.fromEntries(entry.fieldKeys.map(field => [field, entry.provisionalName])),
  }
  await apply(data)
  expect((await snapshot()).documents.length).toBe(before.documents.length + 2)
})

test('a prepared document save rechecks revoked edit rights; restoring rights does not discard the valid draft', async ({ page, browser, baseURL }) => {
  const { data } = await prepare()
  const email = `revoked-workflow-${randomUUID()}@e2e.test`
  await resetE2eAccountFixtureLimits()
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Инженер ЛНК', email, title: '', role: 'user', permissions: ['lnk.view', 'lnk.edit'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'workflow123' })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const account = () => withE2eDatabase(async db => (await db.query('select id,revision from auth_users where email=$1', [email])).rows[0])
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'workflow123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    await page.goto('/account'); await expect(page.getByRole('heading', { name: 'Пользователи и права', exact: true })).toBeVisible()
    expect(observed).not.toBe('')
    const call = async () => {
      const response = await context.request.post(siblingRpcUrl(observed, 'updateWeldJoints_createServerFn_handler'), {
        data: await serializeRpcData(data), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
      })
      return await deserializeRpcResponse(await response.text()) as { error?: Error; result?: unknown }
    }
    const change = asE2eOwner(changeAccount, 'welding.view')
    await change({ ...await account(), role: 'user', permissions: ['lnk.view'] })
    const deniedState = await snapshot()
    expect((await call()).error).toBeDefined()
    expect(await snapshot()).toEqual(deniedState)
    await change({ ...await account(), role: 'user', permissions: ['lnk.view', 'lnk.edit'] })
    expect((await call()).error).toBeUndefined()
    expect((await snapshot()).documents.length).toBe(deniedState.documents.length + 2)
  } finally {
    await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})

test('a concurrent move after the naming snapshot rolls back the reserved numbers and all writes', async () => {
  const { data, rows } = await prepare()
  const before = await snapshot()
  let saving: Promise<unknown>
  await withE2eDatabase(async db => {
    await db.query('begin')
    try {
      const pid = (await db.query('select pg_backend_pid() as pid')).rows[0].pid
      await db.query('select pg_advisory_xact_lock(hashtext($1))', [getWeldLineMembershipLockKeys([rows[0]])[0]])
      saving = save(data).then(() => 'unexpected success', error => error.message)
      await expect.poll(() => withE2eDatabase(async observer => (await observer.query(
        'select count(*)::int as count from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid))', [pid],
      )).rows[0].count)).toBe(1)
      await db.query('update weld_joints set subtitle_code=$1 where id=$2', ['CONCURRENT-MOVE', rows[0].id])
      await db.query('commit')
    } finally { await db.query('rollback') }
  })
  expect(await saving!).toMatch(/перенесены на другую линию/)
  const after = await snapshot()
  expect(after.rows).toEqual(before.rows.map(row => row.id === rows[0].id ? { ...row, subtitle_code: 'CONCURRENT-MOVE' } : row))
  expect({ ...after, rows: [] }).toEqual({ ...before, rows: [] })
})

test('partial import after completed controls preserves history and rejects a stale retry atomically', async () => {
  const { data, rows } = await prepare('tvmtConclusion')
  await savePsto(data)
  const controls = await requireDb().select().from(preHeatTreatmentControls)
  await requireDb().transaction(tx => syncPreHeatTreatmentDocumentsInTransaction(tx, rows, controls.filter(control => rows.some(row => row.id === control.weldJointId))))
  const versions = () => withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where project_title=$1 order by id', [project])).rows)
  const history = () => withE2eDatabase(async db => ({
    pre: (await db.query('select * from pre_heat_treatment_controls order by id')).rows,
    repeats: (await db.query('select * from psto_repeat_cycles order by id')).rows,
  }))
  const before = await snapshot(), oldHistory = await history()
  const payload = { records: rows.map(row => ({ id: row.id, isometry: `CORRECTED-${row.id}` })), deleteIds: [], expectedVersions: await versions() }
  const replace = asE2eOwner(replaceWeldJoints, 'welding.import')
  await replace({ data: payload })
  const after = await snapshot()
  // Import validation merges omitted factual fields from storage. It must not
  // recreate requests, strip pre-TO results or lose specialists/positions.
  const facts = (records: typeof before.rows) => records.map(({ updated_at: _time, welding_updated_at: _editTime, isometry: _iso, ...row }) => row)
  expect(facts(after.rows)).toEqual(facts(before.rows))
  expect(after.rows.map(row => row.isometry)).toEqual(payload.records.map(row => row.isometry))
  const document = ({ updated_at: _time, source_metadata, ...rest }: Record<string, unknown>) => {
    if (!source_metadata) return { ...rest, source_metadata }
    const { rowIds, ...metadata } = JSON.parse(String(source_metadata))
    // The index may materialize this optional row-ID cache on refresh. Exact
    // source positions and real assignment rows still have to stay identical.
    if (rowIds) expect([...rowIds].sort((a, b) => a - b)).toEqual(before.links.filter(link => link.document_id === rest.id).map(link => link.weld_joint_id).sort((a, b) => a - b))
    return { ...rest, source_metadata: metadata }
  }
  const link = ({ document_id, weld_joint_id }: Record<string, unknown>) => ({ document_id, weld_joint_id })
  expect(after.documents.map(document)).toEqual(before.documents.map(document))
  expect(after.links.map(link)).toEqual(before.links.map(link))
  expect(after.counters).toEqual(before.counters)
  expect(await history()).toEqual(oldHistory)
  await expect(replace({ data: payload })).rejects.toThrow(/изменен|устарел|свежий шаблон/)
  expect(await snapshot()).toEqual(after)
  expect(await history()).toEqual(oldHistory)
})

for (const lostResponse of ['abort', 'truncated', 'gateway'] as const) test(`browser recovers after commit with a ${lostResponse} response`, async ({ page }) => {
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
  await page.getByRole('button', { name: 'Новая заявка', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Заявка ЛНК', exact: true }) })
  const method = dialog.getByRole('button', { name: 'ВИК', exact: true })
  if (await method.getAttribute('aria-pressed') !== 'true') await method.click()
  await dialog.getByRole('combobox', { name: 'Разделение документов', exact: true }).selectOption('line')
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('CONTEXT-L')
  const checks = dialog.getByRole('checkbox', { name: /^Выбрать стык CONTEXT-L/ })
  await expect(checks).toHaveCount(2)
  for (const check of await checks.all()) await check.check()
  await dialog.getByLabel('Дата заявки', { exact: true }).fill(date)
  await dialog.getByRole('button', { name: 'Дополнительные действия с номерами и именами' }).click()
  await page.getByRole('button', { name: 'Обновить номера и имена', exact: true }).click()
  let lost = false
  let submitted: { url: string; body: string } | undefined
  let committed: Awaited<ReturnType<typeof snapshot>> | undefined
  await page.route('**/_serverFn/**', async route => {
    if (lost || !rpcName(route.request().url()).startsWith('updateWeldJoints_')) return route.continue()
    lost = true
    submitted = { url: route.request().url(), body: route.request().postData()! }
    const response = await route.fetch()
    expect((await deserializeRpcResponse(await response.text()) as { error?: Error }).error).toBeUndefined()
    committed = await snapshot()
    if (lostResponse === 'abort') {
      // A damaged browser entry must not erase the in-tab pending operation.
      await page.evaluate(() => {
        for (const key of Object.keys(sessionStorage)) if (key.endsWith(':document-save-recovery:v1')) sessionStorage.setItem(key, '[null]')
      })
      await route.abort('failed')
    }
    else if (lostResponse === 'gateway') await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' })
    else await route.fulfill({ status: 200, contentType: 'application/json', body: '{' })
  })
  const submit = dialog.getByRole('button', { name: 'Создать заявку', exact: true })
  await expect(submit).toBeEnabled()
  if (lostResponse === 'gateway') {
    const owner = await withE2eDatabase(async db => (await db.query("select id from auth_users where email='owner@e2e.test'")).rows[0])
    await page.evaluate(key => sessionStorage.setItem(key, '{}'), `welding-user:${owner.id}:document-save-recovery:v1`)
  }
  await submit.click()
  await expect.poll(() => Boolean(committed)).toBe(true)
  const recovery = page.getByRole('dialog', { name: 'Проверка сохранения', exact: true })
  await expect(recovery).toBeVisible()
  if (lostResponse === 'abort') {
    await recovery.getByRole('button', { name: 'Позже', exact: true }).click()
    await page.getByRole('button', { name: 'Проверить сохранение документа', exact: true }).click()
    await expect(recovery.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Проверить сохранение документа', exact: true }).click()
  }
  await recovery.getByRole('button', { name: 'Проверить сохранение', exact: true }).click()
  await expect(recovery.getByText('Сохранение подтверждено. Повторять его не нужно.')).toBeVisible()
  if (lostResponse === 'abort') await recovery.screenshot({ path: 'outputs/document-workflow-help-save-confirmed.png' })
  await recovery.getByRole('button', { name: 'Вернуться к работе', exact: true }).click()
  await expect(recovery).toBeHidden()
  await expect(dialog).toBeVisible()
  // The error path refreshes rows: already requested joints are no longer
  // eligible. The UI must block duplicate creation, and the server must also
  // reject the exact old payload if a disconnected client replays it.
  await expect(submit).toBeDisabled()
  await expect(submit).toHaveAttribute('title', /выберите один или несколько стыков/)
  const retry = await page.request.post(submitted!.url, { data: submitted!.body,
    headers: { origin: new URL(submitted!.url).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
  })
  const rejected = await deserializeRpcResponse(await retry.text()) as { error?: Error }
  expect(String(rejected.error)).toMatch(/уже изменен|имя уже занято/)
  expect(await snapshot()).toEqual(committed)
  await page.unrouteAll({ behavior: 'wait' })
  await page.reload()
  await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
  await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
  const registry = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование заявок ЛНК', exact: true }) })
  for (const row of committed!.rows) {
    await registry.getByPlaceholder('Название, дата, стык или линия').fill(row.vik_request)
    await expect(registry.getByRole('button', { name: new RegExp(row.vik_request) })).toBeVisible()
  }
})
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    if (originalSettings) await db.query("update app_settings set value=$1,updated_at=$2 where key='request-conclusion'", [originalSettings.value, originalSettings.updated_at])
    else await db.query("delete from app_settings where key='request-conclusion'")
  })
})

for (const role of ['owner', 'lnk-only', 'psto-only'] as const) test(`${role}: request keeps the displayed contextual name after explicit refresh`, async ({ page: ownerPage, browser, baseURL }) => {
  let page = ownerPage
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined
  const email = `naming-${randomUUID()}@e2e.test`
  const psto = role === 'psto-only'
  if (psto) await prepare('pstoRequest')
  try {
    if (role !== 'owner') {
      await resetE2eAccountFixtureLimits()
      await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Инженер только ЛНК', email, title: '', role: 'user', permissions: psto ? ['psto.view', 'psto.edit'] : ['lnk.view', 'lnk.edit'] })
      await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'naming123' })
      context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
      expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'naming123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
      page = await context.newPage()
    }
    await page.goto(psto ? '/psto' : '/lnk')
    if (role !== 'owner') {
      // Header actions must refresh the selected rows with this report's
      // permission, even when the account cannot open the welding journal.
      await page.getByRole('checkbox', { name: 'Выбрать стык F9101', exact: true }).check()
      const selectedResponse = page.waitForResponse(response => rpcName(response.url()).startsWith('listWeldJointRowsByIds_'))
      await page.getByLabel('Действия с выбранными стыками', { exact: true }).getByRole('button', { name: 'Действия', exact: true }).click()
      await expect(page.getByTestId('context-action-menu')).toBeVisible()
      const selected = await deserializeRpcResponse(await (await selectedResponse).text()) as { result?: Record<string, unknown>[]; error?: Error }
      expect(selected.error).toBeUndefined()
      expect(selected.result).toEqual([expect.objectContaining({ joint: 'F9101' })])
      expect(selected.result![0]).not.toHaveProperty('weldDate')
      expect(selected.result![0]).not.toHaveProperty(psto ? 'lnkNote' : 'pstoResult')
      await page.keyboard.press('Escape')
    }
    await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
    await page.getByRole('button', { name: 'Новая заявка', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: psto ? 'Заявка ПСТО' : 'Заявка ЛНК', exact: true }) })
    const method = dialog.getByRole('button', { name: 'ВИК', exact: true })
    if (!psto && await method.getAttribute('aria-pressed') !== 'true') {
      const split = dialog.getByRole('combobox', { name: 'Разделение документов', exact: true })
      await expect(split).toBeDisabled()
      await expect(split).toHaveCSS('opacity', '0')
      await method.click()
    }
    await expect(dialog.getByRole('combobox', { name: 'Разделение документов', exact: true })).toBeEnabled()
    await dialog.getByRole('combobox', { name: 'Разделение документов', exact: true }).selectOption('line')
    await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('CONTEXT-L')
    const checks = dialog.getByRole('checkbox', { name: /^Выбрать стык CONTEXT-L/ })
    await expect(checks).toHaveCount(2)
    // The candidate query can replace its initial selected-row snapshot while
    // search settles. Wait for each intended identity instead of capturing a
    // transient count with all(), which does not wait for the complete list.
    for (const [line, joint] of [['CONTEXT-L1', 'F9101'], ['CONTEXT-L2', 'F9102']]) {
      await dialog.getByRole('checkbox', { name: `Выбрать стык ${line} ${joint}`, exact: true }).check()
    }
    await expect(checks.and(dialog.locator(':checked'))).toHaveCount(2)
    if (role !== 'owner') {
      // The client knows that welding exists, but its date is private. That
      // deferred comparison must still fail atomically on the real server.
      await dialog.getByLabel('Дата заявки', { exact: true }).fill('2026-09-30')
      await dialog.getByRole('button', { name: 'Дополнительные действия с номерами и именами' }).click()
      await page.getByRole('button', { name: 'Обновить номера и имена', exact: true }).click()
      await expect(dialog.getByRole('button', { name: 'Создать заявку', exact: true })).toBeEnabled()
      const beforeInvalidDate = await snapshot()
      const rejectedResponse = page.waitForResponse(response => rpcName(response.url()).startsWith(psto ? 'savePstoRepeatWorkflow_' : 'updateWeldJoints_'))
      await expect(dialog.getByRole('button', { name: 'Создать заявку', exact: true })).toBeEnabled()
      await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).click()
      const rejectedBody = await (await rejectedResponse).text()
      expect(rejectedBody).not.toMatch(/01\.10\.2026|2026-10-01/)
      const rejected = await deserializeRpcResponse(rejectedBody) as { error?: Error }
      expect(String(rejected.error)).toMatch(/раньше даты сварки|дата сварки позднее/i)
      expect(String(rejected.error)).not.toMatch(/01\.10\.2026|2026-10-01/)
      await expect(dialog).toBeVisible()
      expect(await snapshot()).toEqual(beforeInvalidDate)
      const notice = page.getByRole('status').filter({ hasText: /раньше даты сварки|дата сварки позднее/i })
      await expect(notice).toBeVisible()
      await notice.getByRole('button', { name: 'Закрыть уведомление' }).click()
    }
    await dialog.getByLabel('Дата заявки', { exact: true }).fill('2026-10-30')
    const counters = await readSystemDocumentNextNumbers(requireDb(), SYSTEM_DOCUMENT_SEQUENCE_IDS)
    await dialog.getByRole('button', { name: 'Дополнительные действия с номерами и именами' }).click()
    await page.getByRole('button', { name: 'Обновить номера и имена', exact: true }).click()
    await expect(dialog.getByRole('combobox', { name: 'Разделение документов', exact: true })).toBeEnabled()
    expect(await readSystemDocumentNextNumbers(requireDb(), SYSTEM_DOCUMENT_SEQUENCE_IDS)).toEqual(counters)
    await dialog.getByRole('tab', { name: /Заявки и имена/ }).click()
    const names = await dialog.getByRole('textbox', { name: /^Название/ }).evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))
    expect(names).toHaveLength(2)
    for (let i = 0; i < 2; i++) expect(names[i]).toMatch(psto
      ? new RegExp(`^pstoRequest-E2E naming context-CONTEXT-${i + 1}-CONTEXT-L${i + 1}-[0-9]+$`)
      : new RegExp(`^Заявка НК №CONTEXT-${i + 1}-[0-9]+$`))
    await expect(dialog.getByRole('button', { name: 'Создать заявку', exact: true })).toBeEnabled({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await withE2eDatabase(async db => {
      const facts = (await db.query(`select subtitle_code,line,${psto ? 'psto_request' : 'vik_request'} as request from weld_joints where project_title=$1 order by line`, [project])).rows
      expect(facts).toEqual(names.map((name, i) => ({ subtitle_code: `CONTEXT-${i + 1}`, line: `CONTEXT-L${i + 1}`, request: name })))
      const links = (await db.query(`select d.title,w.line from generated_documents d join generated_document_weld_joints r on r.document_id=d.id
        join weld_joints w on w.id=r.weld_joint_id where w.project_title=$1 and d.type=$2 order by w.line`, [project, psto ? 'system:pstoRequest' : 'system:lnkRequest'])).rows
      expect(links).toEqual(names.map((title, i) => ({ title, line: `CONTEXT-L${i + 1}` })))
    })
    // Continue with the same restricted account: an owner-only request test
    // cannot detect missing context in result forms or the next specialty stage.
    if (role !== 'owner') {
      if (role === 'lnk-only') {
        await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,psto_required)
          values($1,'CONTEXT-3','CONTEXT-L3','F9103','2026-10-01','С17','действующий','актуальная','да','нет')`, [project]))
        const beforeExtension = await readSystemDocumentNextNumbers(requireDb(), SYSTEM_DOCUMENT_SEQUENCE_IDS)
        await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
        await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
        const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование заявок ЛНК', exact: true }) })
        await manager.getByPlaceholder('Название, дата, стык или линия').fill(names[0])
        await manager.getByRole('button', { name: new RegExp(names[0]) }).click()
        await manager.getByRole('button', { name: 'Добавить позиции', exact: true }).click()
        const extension = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Заявка ЛНК', exact: true }) })
        const extensionMethod = extension.getByRole('button', { name: 'ВИК', exact: true })
        if (await extensionMethod.getAttribute('aria-pressed') !== 'true') await extensionMethod.click()
        await extension.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('F9103')
        await extension.getByRole('checkbox', { name: 'Выбрать стык CONTEXT-L3 F9103', exact: true }).check()
        await extension.getByRole('button', { name: 'Добавить в заявку', exact: true }).click()
        await expect(extension).toBeHidden()
        expect(await readSystemDocumentNextNumbers(requireDb(), SYSTEM_DOCUMENT_SEQUENCE_IDS)).toEqual(beforeExtension)
        expect(await withE2eDatabase(async db => (await db.query('select vik_request from weld_joints where project_title=$1 and joint=$2', [project, 'F9103'])).rows[0].vik_request)).toBe(names[0])
        // The manager may reopen after saving; return through a fresh page read.
        await page.goto('/lnk')
      }
      const steps = psto ? [
        { menu: 'Результат', action: 'Внести результаты', title: 'Внесение результатов ПСТО', requestLabel: 'Фильтр по заявке ПСТО', request: names[0], dateLabel: 'Дата ПСТО', type: 'pstoConclusion' },
        { menu: 'ТВМТ', action: 'Новая заявка ТВМТ', title: 'Заявка ТВМТ', requestLabel: '', request: '', dateLabel: 'Дата заявки', type: 'tvmtRequest' },
        { menu: 'ТВМТ', action: 'Внести результаты ТВМТ', title: 'Внесение результатов ТВМТ', requestLabel: 'Фильтр по заявке ТВМТ', request: '', dateLabel: 'Дата ТВМТ', type: 'tvmtConclusion' },
      ] : [
        { menu: 'Результат', action: 'Внести результаты', title: 'Внесение результатов ЛНК', requestLabel: 'Фильтр по заявке ЛНК', request: names[0], dateLabel: 'Дата контроля', type: 'lnkConclusionVik' },
      ]
      let tvmtRequest = ''
      for (const step of steps) {
        await page.locator('header').getByRole('button', { name: step.menu, exact: true }).click()
        await page.getByRole('button', { name: step.action, exact: true }).click()
        const current = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: step.title, exact: true }) })
        if (!psto) await current.getByRole('combobox', { name: 'Метод контроля', exact: true }).selectOption('vikRequest')
        if (step.requestLabel) {
          await current.getByRole('combobox', { name: step.requestLabel, exact: true }).fill(step.request || tvmtRequest)
          await current.getByRole('option').filter({ hasText: step.request || tvmtRequest }).click()
        }
        const selected = current.getByRole('checkbox', { name: /^Выбрать стык CONTEXT-L1 / })
        await expect(selected).toBeEnabled()
        await selected.check()
        if (!psto) await current.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
        if (step.type === 'tvmtConclusion') await current.getByRole('combobox', { name: 'Результат для выбранных', exact: true }).selectOption('годен')
        await current.getByLabel(step.dateLabel, { exact: true }).fill(date)
        const submit = current.getByRole('button', { name: step.type === 'tvmtRequest' ? 'Создать заявку' : 'Сохранить результат', exact: true })
        await expect(submit).toBeEnabled()
        await submit.click()
        await expect(current).toBeHidden()
        const documents = await withE2eDatabase(async db => (await db.query(`select d.title,w.line from generated_documents d join generated_document_weld_joints r on r.document_id=d.id
          join weld_joints w on w.id=r.weld_joint_id where w.project_title=$1 and d.type=$2`, [project, `system:${step.type}`])).rows)
        expect(documents).toHaveLength(1)
        expect(documents[0].line).toBe('CONTEXT-L1')
        expect(documents[0].title).toContain('E2E naming context-CONTEXT-1-CONTEXT-L1-')
        if (step.type === 'tvmtRequest') tvmtRequest = documents[0].title
      }
    }
  } finally {
    await context?.close()
    if (role !== 'owner') await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})
