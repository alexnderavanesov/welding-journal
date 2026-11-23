import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import type { Permission } from '../../src/lib/access-permissions'
import type { SystemDocumentReference } from '../../src/lib/system-document-types'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { getLnkChronologyIssues } from '../../src/lib/lnk-chronology-checks'
import { getPstoChronologyIssues } from '../../src/lib/psto-chronology-checks'
import { loadSystemDocumentDateContext } from '../../src/server/system-document-index'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { asE2eOwner } from '../with-owner-access'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'

test.beforeEach(async () => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Cross-module RPC probes use the production manifest')
  await resetE2eAccountFixtureLimits()
})

type Area = 'lnk' | 'psto'
type Document = { key: string; area: Area; reference: SystemDocumentReference; ids: number[] }
const definitions = [
  { key: 'lnk', area: 'lnk', type: 'lnkConclusion', methodCode: 'ВИК', storage: 'lnkConclusionVik', date: '2026-01-19', field: 'vik_conclusion' },
  { key: 'pre', area: 'lnk', type: 'lnkConclusion', methodCode: 'РК', storage: 'lnkConclusionRk', date: '2026-01-10', sourceKind: 'beforeHeatTreatment' },
  { key: 'pvk', area: 'lnk', type: 'lnkConclusion', methodCode: 'ПВК', storage: 'lnkConclusionPvk', date: '2026-01-20', field: 'pvk_conclusion' },
  { key: 'psto', area: 'psto', type: 'pstoConclusion', storage: 'pstoConclusion', date: '2026-01-12', field: 'heat_treatment_diagram' },
  { key: 'tvmt', area: 'psto', type: 'lnkConclusion', methodCode: 'ТВМТ', storage: 'tvmtConclusion', date: '2026-01-13', field: 'tvmt_conclusion' },
  { key: 'repeat', area: 'psto', type: 'pstoConclusion', storage: 'pstoConclusion', date: '2026-01-15', field: 'heat_treatment_diagram', sourceKind: 'pstoCycle' },
  { key: 'repeat-tvmt', area: 'psto', type: 'lnkConclusion', methodCode: 'ТВМТ', storage: 'tvmtConclusion', date: '2026-01-16', field: 'tvmt_conclusion', sourceKind: 'pstoCycle' },
] as const

async function seed(project: string): Promise<Document[]> {
  const documents = await withE2eDatabase(async db => {
    const documents: Document[] = []
    for (const definition of definitions) {
      const title = `${project}-${definition.key}`
      const rows = (await db.query(`insert into weld_joints(project_title,line,joint,weld_date,officiality,revision_actuality,
        has_vik,has_pvk,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
        pvk_request,pvk_request_date,pvk_result,pvk_conclusion,pvk_conclusion_date,psto_required,pre_heat_treatment_required,
        psto_request,psto_request_date,psto_date,psto_result,heat_treatment_diagram,
        tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date)
        select $1,$2,'F'||n,'2026-01-01','действующий','актуальная','да','да','Precondition VIK',
        case when n=3 then '2026-01-19'::date else '2026-01-18'::date end,'годен','Precondition VIK result','2026-01-19',
        'Precondition PVK','2026-01-19','годен','Precondition PVK result','2026-01-20','да',$3,
        'Precondition PSTO','2026-01-11','2026-01-12','проведено','Precondition diagram',
        'Precondition TVMT','2026-01-12',$4,'Precondition TVMT result','2026-01-13'
        from generate_series(1,3) n returning id`,
      [project, `${project}-${definition.key}`, definition.key === 'pre', definition.key.startsWith('repeat') ? 'не годен' : 'годен'])).rows
      const ids = rows.map(row => row.id as number)
      let sourcePositions: unknown[] = []
      if (definition.key === 'pre') {
        await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
          select id,'ВИК','Before TO VIK request','2026-01-02','годен','Before TO VIK conclusion','2026-01-08' from weld_joints where id=any($1::int[])`, [ids])
        await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
          select id,'ПВК','Before TO PVK request','2026-01-08','годен','Before TO PVK conclusion','2026-01-09' from weld_joints where id=any($1::int[])`, [ids])
        const controls = (await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
          select id,'РК','Precondition before TO','2026-01-09','годен',$1,'2026-01-10' from weld_joints where id=any($2::int[]) returning id,weld_joint_id`, [title, ids])).rows
        sourcePositions = controls.map(row => ({ kind: 'beforeHeatTreatment', weldJointId: row.weld_joint_id, relationId: row.id, methodCode: 'РК' }))
      } else if (definition.key.startsWith('repeat')) {
        const cycles = (await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,psto_result,
          heat_treatment_diagram,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date)
          select id,2,'Repeat request','2026-01-14','2026-01-15','проведено',$1,'Repeat TVMT','2026-01-15','годен',$2,'2026-01-16'
          from weld_joints where id=any($3::int[]) returning id,weld_joint_id`,
        [definition.key === 'repeat' ? title : 'Repeat diagram', definition.key === 'repeat-tvmt' ? title : 'Repeat conclusion', ids])).rows
        sourcePositions = cycles.map(row => ({ kind: 'pstoCycle', weldJointId: row.weld_joint_id, relationId: row.id, sequence: 2,
          ...(definition.type === 'lnkConclusion' ? { methodCode: 'ТВМТ' } : {}) }))
      } else {
        // Identifiers come only from the fixed definitions above.
        await db.query(`update weld_joints set ${definition.field}=$1 where id=any($2::int[])`, [title, ids])
      }
      const methodCode = 'methodCode' in definition ? definition.methodCode : undefined
      const sourceKind = 'sourceKind' in definition ? definition.sourceKind : undefined
      const cycleSequences = sourceKind === 'pstoCycle' ? [2] : undefined
      const metadata = { methodCode, methodCodes: methodCode ? [methodCode] : [], sourceKind, cycleSequences, sourcePositions,
        positionCount: 3, projects: [project], lines: [`${project}-${definition.key}`] }
      const documentId = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
        values($1,$2,'permissions.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3,$3,3,$4) returning id`,
      [`system:${definition.storage}`, title, definition.date, JSON.stringify(metadata)])).rows[0].id as number
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [documentId, ids])
      documents.push({ key: definition.key, area: definition.area, ids, reference: {
        documentId, type: definition.type, title, date: definition.date, ...(methodCode ? { methodCode } : {}),
        ...(sourceKind ? { sourceKind } : {}), ...(cycleSequences ? { cycleSequences } : {}),
      } })
    }
    return documents
  })
  // Successful access scenarios start from a valid complete chronology; they
  // must not pass only because an existing bad history is grandfathered.
  for (const document of documents) {
    const context = await asE2eOwner(loadSystemDocumentDateContext, 'lnk.view')(document.reference)
    expect(getLnkChronologyIssues(context.rows), document.key).toEqual([])
    expect(getPstoChronologyIssues(context.rows), document.key).toEqual([])
  }
  return documents
}

async function login(browser: Browser, baseURL: string, area: Area, action: 'edit' | 'delete' | 'view') {
  const email = `workflow-${randomUUID()}@e2e.test`
  const permissions: Permission[] = action === 'view' ? [`${area}.view`] : [`${area}.view`, `${area}.${action}`]
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Только своя специальность', email, title: '', role: 'user', permissions })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'workflow123!' })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'workflow123!' }, headers: { origin: baseURL } })).ok()).toBe(true)
  const page = await context.newPage()
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
  await expect.poll(() => observed).not.toBe('')
  return { email, context, page, call: rpc(context.request, observed, baseURL) }
}

function rpc(client: APIRequestContext, observed: string, baseURL: string) {
  return async (name: string, data: unknown, method = 'POST') => {
    const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`)), encoded = await serializeRpcData(data)
    if (method === 'GET') url.searchParams.set('payload', encoded)
    const response = await client.fetch(url.href, { method, ...(method === 'POST' ? { data: encoded } : {}),
      headers: { origin: baseURL, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    return await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
  }
}
const grid = (project: string, area: Area, type: SystemDocumentReference['type'] = 'lnkConclusion') => ({
  type, workflowArea: area, search: project, startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [],
})
const snapshot = (ids: number[]) => withE2eDatabase(async db => ({
  rows: (await db.query('select * from weld_joints where id=any($1::int[]) order by id', [ids])).rows,
  documents: (await db.query('select * from generated_documents where id in (select document_id from generated_document_weld_joints where weld_joint_id=any($1::int[])) order by id', [ids])).rows,
  pre: (await db.query('select * from pre_heat_treatment_controls where weld_joint_id=any($1::int[]) order by id', [ids])).rows,
  cycles: (await db.query('select * from psto_repeat_cycles where weld_joint_id=any($1::int[]) order by id', [ids])).rows,
}))
async function cleanup(project: string, session?: { context: BrowserContext; email: string }) {
  await session?.context.close()
  await cleanupLineProgramProjects([project])
  if (session) await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [session.email]))
}

for (const area of ['lnk', 'psto'] as const) test(`${area}: own-only editor reads and renames every own stage, keeps foreign data and generic documents closed`, async ({ browser, baseURL }) => {
  const project = `WORKFLOW-RIGHTS-${randomUUID()}`
  const documents = await seed(project)
  const session = await login(browser, baseURL!, area, 'edit')
  try {
    const foreign = documents.filter(doc => doc.area !== area)
    for (const type of ['lnkConclusion', ...(area === 'psto' ? ['pstoConclusion'] : [])] as const) {
      const list = await session.call('listWorkflowDocumentHistoryGrid', grid(project, area, type as SystemDocumentReference['type']))
      expect(list.error).toBeUndefined()
      expect(list.result.rows.length).toBeGreaterThan(0)
      expect(list.result.rows.every((row: any) => area === 'lnk' ? row.methodCode !== 'ТВМТ' : type === 'pstoConclusion' || row.methodCode === 'ТВМТ')).toBe(true)
      expect(list.result.rows.some((row: any) => foreign.some(doc => doc.reference.documentId === row.documentId))).toBe(false)
    }
    expect((await session.call('listSystemDocumentHistoryGrid', grid(project, area))).error?.message).toContain('Недостаточно прав')
    expect((await session.call('listWorkflowDocumentHistoryGrid', grid(project, area === 'lnk' ? 'psto' : 'lnk'))).error?.message).toContain('Недостаточно прав')
    const hiddenMethod = await session.call('listWorkflowDocumentHistoryGrid', { ...grid(project, area), rowGroupCols: ['method'],
      columnFilters: { method: buildWeldColumnValueFilter([area === 'lnk' ? 'ТВМТ' : 'ВИК']) } })
    expect(hiddenMethod.error).toBeUndefined()
    expect(hiddenMethod.result.total).toBe(0)
    expect(hiddenMethod.result.rows).toEqual([])
    for (const document of foreign) expect((await session.call('getSystemDocumentDateContext', document.reference, 'GET')).error?.message).toContain('Недостаточно прав')
    // Opening a registry may initialize its derived index. Isolate the actual
    // rename effects from that existing preparation step.
    const before = await snapshot(foreign.flatMap(doc => doc.ids))
    for (const document of documents.filter(doc => doc.area === area)) {
      const context = await session.call('getSystemDocumentDateContext', document.reference, 'GET')
      expect(context.error).toBeUndefined()
      expect(context.result.rows).toHaveLength(3)
      expect(context.result.rows[0]).not.toHaveProperty('weldDate')
      expect(context.result.rows[0]).not.toHaveProperty(area === 'lnk' ? 'heatTreatmentDiagram' : 'vikConclusion')
      const saved = await session.call('changeSystemDocumentDate', { reference: document.reference, nextDate: document.reference.date,
        nextTitle: `${document.reference.title}-changed`, expectedVersions: context.result.rows.map((row: any) => ({ id: row.id, version: row.rowVersion })) })
      expect(saved.error, document.key).toBeUndefined()
      expect(saved.result.positionCount).toBe(3)
      expect(saved.result.nextTitle).toBe(`${document.reference.title}-changed`)
      expect(saved.result.rows[0]).not.toHaveProperty(area === 'lnk' ? 'heatTreatmentDiagram' : 'vikConclusion')
    }
    expect(await snapshot(foreign.flatMap(doc => doc.ids))).toEqual(before)
  } finally { await cleanup(project, session) }
})

for (const area of ['lnk', 'psto'] as const) test(`${area}: own-only UI changes date and name without hidden-area false chronology or journal access`, async ({ browser, baseURL }) => {
  const project = `WORKFLOW-UI-${randomUUID()}`
  const documents = await seed(project), document = documents.find(doc => doc.key === area)!
  const session = await login(browser, baseURL!, area, 'edit')
  try {
    const { page } = session
    await page.goto(`/${area}`)
    await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
    await page.getByRole('button', { name: area === 'lnk' ? 'Все результаты ЛНК' : 'История ПСТО и ТВМТ', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('tab', { name: 'Документы', exact: true }) })
    await dialog.getByRole('tab', { name: 'Документы', exact: true }).click()
    const pane = dialog.getByRole('tabpanel', { name: 'Документы', exact: true })
    if (area === 'psto') await pane.getByRole('combobox', { name: 'Вид документа', exact: true }).selectOption('psto-results')
    await pane.getByPlaceholder('Поиск документов').fill(document.reference.title)
    await pane.getByRole('complementary').getByRole('button').filter({ hasText: document.reference.title }).click()
    await expect(pane.getByRole('region', { name: 'Полный состав документа' })).toContainText('F3')
    await expect(pane.getByRole('button', { name: 'Показать стык в журнале', exact: true })).toHaveCount(0)
    await pane.getByRole('button', { name: 'Редактировать', exact: true }).click()
    const nextDate = area === 'lnk' ? '2026-01-20' : '2026-01-11'
    await pane.getByLabel('Дата документа', { exact: true }).fill(nextDate)
    await pane.getByLabel('Название документа', { exact: true }).fill(`${document.reference.title}-UI`)
    const save = pane.getByRole('button', { name: 'Сохранить изменения документа', exact: true })
    await expect(save).toBeEnabled()
    await save.click()
    await page.getByRole('dialog', { name: 'Сохранить изменения документа', exact: true }).getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    await expect(pane.getByRole('heading', { name: `${document.reference.title}-UI`, exact: true })).toBeVisible()
    expect(await withE2eDatabase(async db => (await db.query('select title,period_from::text from generated_documents where id=$1', [document.reference.documentId])).rows[0]))
      .toEqual({ title: `${document.reference.title}-UI`, period_from: nextDate })
  } finally { await cleanup(project, session) }
})

for (const action of ['view', 'delete'] as const) test(`${action}-only cannot use the working-document save API`, async ({ browser, baseURL }) => {
  const project = `WORKFLOW-DENIED-${randomUUID()}`, documents = await seed(project)
  try { for (const area of ['lnk', 'psto'] as const) {
    const session = await login(browser, baseURL!, area, action)
    try {
      const document = documents.find(doc => doc.key === area)!
      const context = await session.call('getSystemDocumentDateContext', document.reference, 'GET')
      expect(context.error).toBeUndefined()
      const before = await snapshot(document.ids)
      const saved = await session.call('changeSystemDocumentDate', { reference: document.reference, nextDate: document.reference.date, nextTitle: 'Forbidden',
        expectedVersions: context.result.rows.map((row: any) => ({ id: row.id, version: row.rowVersion })) })
      expect(saved.error?.message).toContain('Недостаточно прав')
      expect(await snapshot(document.ids)).toEqual(before)
    } finally {
      await session.context.close()
      await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [session.email]))
    }
  } } finally { await cleanup(project) }
})

test('forged ID/type/method/source/cycle cannot disclose or mutate another document; hidden third member still blocks chronology atomically', async ({ browser, baseURL }) => {
  const project = `WORKFLOW-FORGED-${randomUUID()}`, documents = await seed(project)
  const own = documents.find(doc => doc.key === 'lnk')!, foreign = documents.find(doc => doc.key === 'tvmt')!, pre = documents.find(doc => doc.key === 'pre')!
  const session = await login(browser, baseURL!, 'lnk', 'edit')
  try {
    const before = await snapshot(documents.flatMap(doc => doc.ids))
    const context = await session.call('getSystemDocumentDateContext', own.reference, 'GET')
    expect(context.error).toBeUndefined()
    const expectedVersions = context.result.rows.map((row: any) => ({ id: row.id, version: row.rowVersion }))
    for (const forged of [
      { ...own.reference, documentId: foreign.reference.documentId },
      { ...foreign.reference, methodCode: 'ВИК' },
      { ...foreign.reference, type: 'lnkRequest' },
      { ...pre.reference, sourceKind: 'pstoCycle', cycleSequences: [2] },
      { ...pre.reference, cycleSequences: [99] },
      { ...own.reference, cycleSequences: [99] },
    ]) {
      const read = await session.call('getSystemDocumentDateContext', forged, 'GET')
      expect(Boolean(read.error) || read.result?.rows.length === 0).toBe(true)
      const save = await session.call('changeSystemDocumentDate', { reference: forged, nextDate: forged.date, nextTitle: 'Forbidden', expectedVersions })
      expect(save.error).toBeTruthy()
    }
    const invalid = await session.call('changeSystemDocumentDate', { reference: own.reference, nextDate: '2026-01-18', nextTitle: 'Invalid chronology', expectedVersions })
    expect(invalid.error?.message).toMatch(/F3|хронолог|дата/i)
    expect(await snapshot(documents.flatMap(doc => doc.ids))).toEqual(before)
  } finally { await cleanup(project, session) }
})

test('revoking own edit permission while a save waits for its members prevents every write', async ({ browser, baseURL }) => {
  const project = `WORKFLOW-REVOKED-${randomUUID()}`, documents = await seed(project)
  const document = documents.find(doc => doc.key === 'lnk')!
  const session = await login(browser, baseURL!, 'lnk', 'edit')
  try {
    const context = await session.call('getSystemDocumentDateContext', document.reference, 'GET')
    expect(context.error).toBeUndefined()
    const before = await snapshot(document.ids)
    let pending: ReturnType<typeof session.call> | undefined
    await withE2eDatabase(async blocker => {
      await blocker.query('begin')
      try {
        const pid = (await blocker.query('select pg_backend_pid() as pid')).rows[0].pid
        await blocker.query('select id from weld_joints where id=any($1::int[]) order by id for update', [document.ids])
        pending = session.call('changeSystemDocumentDate', { reference: document.reference, nextDate: document.reference.date,
          nextTitle: `${document.reference.title}-revoked`, expectedVersions: context.result.rows.map((row: any) => ({ id: row.id, version: row.rowVersion })) })
        await expect.poll(() => withE2eDatabase(async observer => (await observer.query(
          'select count(*)::int as count from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid))', [pid],
        )).rows[0].count)).toBe(1)
        // Real concurrent permission change, after the request passed its
        // middleware check but before the first business write.
        await withE2eDatabase(db => db.query('update auth_users set permissions=$1::jsonb,revision=revision+1 where email=$2',
          [JSON.stringify(['lnk.view']), session.email]))
      } finally { await blocker.query('rollback') }
    })
    expect((await pending)?.error?.message).toContain('Недостаточно прав')
    expect(await snapshot(document.ids)).toEqual(before)
  } finally { await cleanup(project, session) }
})

test('own-only editors change complete primary/pre-TO/repeated requests without granting another specialty', async ({ browser, baseURL }) => {
  const project = `WORKFLOW-REQUESTS-${randomUUID()}`
  const sources = await seed(project)
  const requestDefinitions = [
    { key: 'lnk', area: 'lnk', type: 'lnkRequest', storage: 'lnkRequest', table: 'weld_joints', name: 'vik_request', date: 'vik_request_date', previous: '2026-01-18', next: '2026-01-19' },
    { key: 'pre', area: 'lnk', type: 'lnkRequest', storage: 'lnkRequest', table: 'pre_heat_treatment_controls', name: 'request_name', date: 'request_date', previous: '2026-01-02', next: '2026-01-03' },
    { key: 'psto', area: 'psto', type: 'pstoRequest', storage: 'pstoRequest', table: 'weld_joints', name: 'psto_request', date: 'psto_request_date', previous: '2026-01-11', next: '2026-01-12' },
    { key: 'repeat', area: 'psto', type: 'pstoRequest', storage: 'pstoRequest', table: 'psto_repeat_cycles', name: 'psto_request', date: 'psto_request_date', previous: '2026-01-14', next: '2026-01-15' },
    { key: 'tvmt', area: 'psto', type: 'lnkRequest', storage: 'tvmtRequest', table: 'weld_joints', name: 'tvmt_request', date: 'tvmt_request_date', previous: '2026-01-12', next: '2026-01-13', methodCode: 'ТВМТ' },
    { key: 'repeat-tvmt', area: 'psto', type: 'lnkRequest', storage: 'tvmtRequest', table: 'psto_repeat_cycles', name: 'tvmt_request', date: 'tvmt_request_date', previous: '2026-01-15', next: '2026-01-16', methodCode: 'ТВМТ' },
  ] as const
  try {
    const documents = await withE2eDatabase(async db => {
      const records = []
      for (const definition of requestDefinitions) {
        const source = sources.find(document => document.key === definition.key)!
        const title = `${project}-${definition.key}-request`
        // All SQL identifiers and conditions come from the fixed matrix above.
        const where = definition.table === 'weld_joints' ? 'id=any($3::int[])'
          : `weld_joint_id=any($3::int[]) and ${definition.table === 'pre_heat_treatment_controls' ? "method in ('ВИК','РК')" : 'sequence=2'}`
        await db.query(`update ${definition.table} set ${definition.name}=$1,${definition.date}=$2 where ${where}`, [title, definition.previous, source.ids])
        if (definition.key === 'lnk') {
          await db.query(`update weld_joints set has_rk='да',rk_request=$1,rk_request_date=$2,
            rk_result='годен',rk_conclusion='Complete RK result',rk_conclusion_date='2026-01-20' where id=any($3::int[])`,
          [title, definition.previous, source.ids])
        }
        const raw = (await db.query('select source_metadata from generated_documents where id=$1', [source.reference.documentId])).rows[0].source_metadata
        const metadata = JSON.parse(raw)
        const methodCode = 'methodCode' in definition ? definition.methodCode : undefined
        const expectedPositions = definition.area === 'lnk' ? 6 : 3
        Object.assign(metadata, { methodCode, methodCodes: methodCode ? [methodCode] : definition.area === 'lnk' ? ['ВИК', 'РК'] : [], positionCount: expectedPositions })
        if (definition.key === 'pre') {
          const positions = (await db.query("select id,weld_joint_id,method from pre_heat_treatment_controls where weld_joint_id=any($1::int[]) and method in ('ВИК','РК') order by id", [source.ids])).rows
          metadata.sourcePositions = positions.map(row => ({ kind: 'beforeHeatTreatment', weldJointId: row.weld_joint_id, relationId: row.id, methodCode: row.method }))
        }
        const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
          values($1,$2,'request-access.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3,$3,3,$4) returning id`,
        [`system:${definition.storage}`, title, definition.previous, JSON.stringify(metadata)])).rows[0].id as number
        await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [id, source.ids])
        const reference: SystemDocumentReference = { type: definition.type, documentId: id, title, date: definition.previous,
          ...(methodCode ? { methodCode } : {}), ...(source.reference.sourceKind ? { sourceKind: source.reference.sourceKind } : {}),
          ...(source.reference.cycleSequences ? { cycleSequences: source.reference.cycleSequences } : {}),
        }
        records.push({ definition, reference, ids: source.ids, expectedPositions })
      }
      return records
    })
    for (const area of ['lnk', 'psto'] as const) {
      const session = await login(browser, baseURL!, area, 'edit')
      try {
        for (const type of new Set(documents.filter(item => item.definition.area === area).map(item => item.reference.type))) {
          const list = await session.call('listWorkflowDocumentHistoryGrid', grid(project, area, type))
          expect(list.error).toBeUndefined()
          expect(list.result.rows.some((row: any) => documents.some(item => item.definition.area !== area && item.reference.documentId === row.documentId))).toBe(false)
        }
        for (const document of documents.filter(item => item.definition.area !== area)) {
          expect((await session.call('getSystemDocumentDateContext', document.reference, 'GET')).error?.message).toContain('Недостаточно прав')
          expect((await session.call('changeSystemDocumentDate', { reference: document.reference, nextDate: document.definition.next,
            nextTitle: 'Forbidden request', expectedVersions: [] })).error?.message).toContain('Недостаточно прав')
        }
        for (const document of documents.filter(item => item.definition.area === area)) {
          const context = await session.call('getSystemDocumentDateContext', document.reference, 'GET')
          expect(context.error, document.definition.key).toBeUndefined()
          expect(context.result.rows.map((row: any) => row.id).sort((a: number, b: number) => a - b)).toEqual([...document.ids].sort((a, b) => a - b))
          const title = `${document.reference.title}-changed`
          const expectedVersions = context.result.rows.map((row: any) => ({ id: row.id, version: row.rowVersion }))
          if (area === 'lnk') {
            // Both methods occupy the same three joint IDs. ID coverage alone
            // must not let a forged method leave half of a common request old.
            const before = await snapshot(document.ids)
            const partial = { ...document.reference, methodCode: 'ВИК' }
            const partialRead = await session.call('getSystemDocumentDateContext', partial, 'GET')
            expect(Boolean(partialRead.error) || partialRead.result?.rows.length === 0).toBe(true)
            const partialSave = await session.call('changeSystemDocumentDate', { reference: partial, nextDate: document.definition.next, nextTitle: title, expectedVersions })
            expect(partialSave.error).toBeTruthy()
            expect(await snapshot(document.ids)).toEqual(before)
          }
          const save = await session.call('changeSystemDocumentDate', { reference: document.reference, nextDate: document.definition.next, nextTitle: title,
            expectedVersions })
          expect(save.error, document.definition.key).toBeUndefined()
          expect(save.result).toMatchObject({ nextTitle: title, nextDate: document.definition.next, rowCount: 3, positionCount: document.expectedPositions })
          const persisted = await withE2eDatabase(async db => {
            const definition = document.definition
            const where = definition.table === 'weld_joints' ? 'id=any($1::int[])'
              : `weld_joint_id=any($1::int[]) and ${definition.table === 'pre_heat_treatment_controls' ? "method in ('ВИК','РК')" : 'sequence=2'}`
            if (definition.key === 'lnk') return (await db.query(`select v.name,v.date::text from weld_joints w
              cross join lateral (values(w.vik_request,w.vik_request_date),(w.rk_request,w.rk_request_date)) v(name,date)
              where w.id=any($1::int[])`, [document.ids])).rows
            return (await db.query(`select ${definition.name} as name,${definition.date}::text as date from ${definition.table} where ${where}`, [document.ids])).rows
          })
          expect(persisted).toEqual(Array.from({ length: document.expectedPositions }, () => ({ name: title, date: document.definition.next })))
        }
        expect((await session.call('listSystemDocumentHistoryGrid', grid(project, area, 'lnkRequest'))).error?.message).toContain('Недостаточно прав')
      } finally {
        await session.context.close()
        await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [session.email]))
      }
    }
  } finally { await cleanup(project) }
})
