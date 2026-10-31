import { expect, test, type Page, type APIRequestContext, type Route } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl, rpcName } from '../rpc'
import type { SystemDocumentReference, SystemDocumentSourcePosition } from '../../src/lib/system-document-types'
import { getSystemDocumentTemplateId } from '../../src/lib/system-document-template-types'
import { requireDb } from '../../src/db'
import { authUsers } from '../../src/db/schema'
import { asE2eOwner } from '../with-owner-access'
import { accessContext } from '../../src/server/access-store'
import { runWithAccess, toAccessIdentity } from '../../src/server/access-context'
import { beginDocumentSaveReceipt, finishDocumentSaveReceipt } from '../../src/server/document-save-receipt'
import { inviteAccount, completeAccountLink, changeAccount } from '../../src/server/account-management'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { getWeldLineMembershipLockKeys } from '../../src/server/weld-line-membership-lock'
import { auditSqlCount } from '../audit-sql'

const project = 'E2E workflow help'
const date = '2026-10-02'
type Connections = { reference: SystemDocumentReference; total: number; completed: number; linked: number; documentCount: number; items: Array<{ reference: SystemDocumentReference; positions: number }> }
async function rpc(page: Page) {
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  await page.goto('/account')
  await expect.poll(() => observed).not.toBe('')
  return async <T>(name: string, data: unknown, request: APIRequestContext = page.request) => {
    const url = siblingRpcUrl(observed, `${name}_createServerFn_handler`)
    const response = await request.post(url, { data: await serializeRpcData(data), headers: { origin: new URL(url).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    return await deserializeRpcResponse(await response.text()) as { result?: T; error?: Error }
  }
}
async function seed() {
  return withLineProgramFixture(async db => {
    const ids = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,has_rk,psto_required,has_tvmt,
      vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date)
      select $1,'HELP','HELP-L'||n,'F9770'||n,'2026-10-01','С17','действующий','актуальная','да','нет','да','да',
      case when n=2 then 'Help B' else 'Help A' end,'2026-10-02',case when n=3 then 'ожидает НК' when n=1 then 'ремонт' else 'годен' end,
      case when n<3 then 'Help shared VIK' end,case when n<3 then '2026-10-03'::date end from generate_series(1,3)n returning id`, [project])).rows.map(row => Number(row.id))
    await db.query("update weld_joints set has_rk='да',rk_request='Help A',rk_request_date=$2,rk_result='годен',rk_conclusion='Help RK',rk_conclusion_date='2026-10-03' where id=$1", [ids[0], date])
    await db.query("update weld_joints set psto_request='Help PSTO old',psto_request_date=$2,psto_result='проведено (отменен)',psto_date='2026-10-03',heat_treatment_diagram='Help old diagram' where id=$1", [ids[0], date])
    await db.query("update weld_joints set psto_request='Help PSTO primary',psto_request_date=$2,psto_result='да',psto_date='2026-10-06',heat_treatment_diagram='Help mixed diagram',tvmt_request='Help TVMT primary',tvmt_request_date='2026-10-07',tvmt_result='не годен',tvmt_conclusion='Help mixed TVMT',tvmt_conclusion_date='2026-10-08' where id=$1", [ids[1], date])
    const cycle = (await db.query("insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_result,psto_date,heat_treatment_diagram,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date) values($1,2,'Help PSTO repeat','2026-10-04','проведено','2026-10-06','Help mixed diagram','Help TVMT repeat','2026-10-07','не годен','Help mixed TVMT','2026-10-08') returning id", [ids[0]])).rows[0].id
    const pre = (await db.query("insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date) values($1,'ВИК','Help A',$2,'годен','Help before VIK','2026-10-03') returning id", [ids[0], date])).rows[0].id
    const docs: Record<string, SystemDocumentReference> = {}
    const add = async (key: string, reference: SystemDocumentReference, rowIds: number[], positions?: SystemDocumentSourcePosition[]) => {
      const metadata = { ...reference, sourcePositions: positions ?? [], positionCount: positions?.length ?? rowIds.length, methodCodes: reference.methodCode ? [reference.methodCode] : reference.type === 'lnkRequest' ? key === 'a' ? ['ВИК', 'РК'] : ['ВИК'] : [], projects: [project], subtitleCodes: ['HELP'], lines: [], cycleSequences: positions?.map(position => position.sequence).filter(Boolean) }
      const id = (await db.query('insert into generated_documents(type,title,file_name,mime_type,period_from,row_count,source_metadata) values($1,$2,$3,$4,$5,$6,$7) returning id', [`system:${getSystemDocumentTemplateId(reference)}`, reference.title, `${reference.title}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', reference.date, new Set(rowIds).size, JSON.stringify(metadata)])).rows[0].id
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::integer[])', [id, [...new Set(rowIds)]])
      docs[key] = { ...reference, documentId: id }
    }
    await add('a', { type: 'lnkRequest', title: 'Help A', date }, [ids[0], ids[2]])
    await add('b', { type: 'lnkRequest', title: 'Help B', date }, [ids[1]])
    await add('vik', { type: 'lnkConclusion', methodCode: 'ВИК', title: 'Help shared VIK', date: '2026-10-03' }, ids.slice(0, 2))
    await add('rk', { type: 'lnkConclusion', methodCode: 'РК', title: 'Help RK', date: '2026-10-03' }, [ids[0]])
    const before: SystemDocumentSourcePosition[] = [{ kind: 'beforeHeatTreatment', weldJointId: ids[0], relationId: pre, methodCode: 'ВИК' }]
    await add('preA', { type: 'lnkRequest', title: 'Help A', date, sourceKind: 'beforeHeatTreatment' }, [ids[0]], before)
    await add('preVik', { type: 'lnkConclusion', title: 'Help before VIK', date: '2026-10-03', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment' }, [ids[0]], before)
    const repeat: SystemDocumentSourcePosition[] = [{ kind: 'pstoCycle', weldJointId: ids[0], relationId: cycle, sequence: 2 }]
    const mixed: SystemDocumentSourcePosition[] = [...repeat, { kind: 'pstoCycle', weldJointId: ids[1], relationId: ids[1], sequence: 1 }]
    await add('oldPsto', { type: 'pstoRequest', title: 'Help PSTO old', date }, [ids[0]])
    await add('oldDiagram', { type: 'pstoConclusion', title: 'Help old diagram', date: '2026-10-03' }, [ids[0]])
    await add('primaryPsto', { type: 'pstoRequest', title: 'Help PSTO primary', date }, [ids[1]])
    await add('repeatPsto', { type: 'pstoRequest', title: 'Help PSTO repeat', date: '2026-10-04', sourceKind: 'pstoCycle' }, [ids[0]], repeat)
    await add('diagram', { type: 'pstoConclusion', title: 'Help mixed diagram', date: '2026-10-06', sourceKind: 'pstoCycle' }, ids.slice(0, 2), mixed)
    await add('primaryTvmt', { type: 'lnkRequest', methodCode: 'ТВМТ', title: 'Help TVMT primary', date: '2026-10-07' }, [ids[1]])
    await add('repeatTvmt', { type: 'lnkRequest', methodCode: 'ТВМТ', title: 'Help TVMT repeat', date: '2026-10-07', sourceKind: 'pstoCycle' }, [ids[0]], repeat.map(position => ({ ...position, methodCode: 'ТВМТ' })))
    await add('tvmt', { type: 'lnkConclusion', methodCode: 'ТВМТ', title: 'Help mixed TVMT', date: '2026-10-08', sourceKind: 'pstoCycle' }, ids.slice(0, 2), mixed.map(position => ({ ...position, methodCode: 'ТВМТ' })))
    return { ids, docs }
  })
}
test.afterEach(() => cleanupLineProgramProjects([project]))

test('connections count positions, preserve pending requests and distinguish methods and equal stage names', async ({ page }) => {
  const { docs } = await seed(), call = await rpc(page)
  const a = await call<Connections>('getDocumentConnections', { reference: docs.a })
  expect(a.error).toBeUndefined()
  expect(a.result).toMatchObject({ total: 3, completed: 2, linked: 2, documentCount: 2 })
  expect(a.result!.items.map(item => item.reference.title).sort()).toEqual(['Help RK', 'Help shared VIK'])
  const result = await call<Connections>('getDocumentConnections', { reference: docs.vik })
  expect(result.result).toMatchObject({ total: 2, documentCount: 2 })
  expect(result.result!.items.map(item => [item.reference.documentId, item.positions]).sort()).toEqual([[docs.a.documentId, 1], [docs.b.documentId, 1]].sort())
  const before = await call<Connections>('getDocumentConnections', { reference: { ...docs.preA, documentId: undefined } })
  expect(before.result).toMatchObject({ total: 1, completed: 1, items: [{ reference: { documentId: docs.preVik.documentId }, positions: 1 }] })
})

test('PSTO and TVMT connect primary plus repeat positions without inheriting earlier cycle history', async ({ page }) => {
  const { docs } = await seed(), call = await rpc(page)
  for (const [result, expected] of [['diagram', ['repeatPsto', 'primaryPsto']], ['tvmt', ['repeatTvmt', 'primaryTvmt']]] as const) {
    const response = await call<Connections>('getDocumentConnections', { reference: docs[result] })
    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({ total: 2, documentCount: 2 })
    expect(response.result!.items.map(item => item.reference.documentId).sort()).toEqual(expected.map(key => docs[key].documentId).sort())
  }
  for (const request of ['oldPsto', 'primaryPsto', 'repeatPsto', 'primaryTvmt', 'repeatTvmt']) {
    const response = await call<Connections>('getDocumentConnections', { reference: docs[request] })
    expect(response.result).toMatchObject({ total: 1, completed: 1, linked: 1 })
    if (request === 'oldPsto') expect(response.result!.items[0].reference.documentId).toBe(docs.oldDiagram.documentId)
  }
})

test('document links load on demand, navigate both directions and remain usable on a narrow screen', async ({ page }) => {
  const { docs } = await seed()
  let calls = 0
  page.on('request', request => { if (rpcName(request.url()).startsWith('getDocumentConnections_')) calls++ })
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  const row = page.locator(`[data-document-history-grid] .ag-row[row-id="document:system-document:${docs.a.documentId}"]`).first()
  await expect(row).toBeVisible()
  expect(calls).toBe(0)
  await row.click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Связи документов', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Связи документов', exact: true })
  await expect(dialog.getByText('Результат внесён: 2 из 3', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Ожидают результата: 1', { exact: true })).toBeVisible()
  expect(calls).toBe(1)
  await dialog.screenshot({ path: 'outputs/document-workflow-help-connections.png' })
  const initialBounds = await dialog.boundingBox()
  let releaseTransition!: () => void
  const transitionGate = new Promise<void>(resolve => { releaseTransition = resolve })
  const holdConnections = async (route: Route) => {
    if (!rpcName(route.request().url()).startsWith('getDocumentConnections_')) return route.continue()
    const response = await route.fetch()
    await transitionGate
    await route.fulfill({ response })
  }
  await page.route('**/_serverFn/**', holdConnections)
  await dialog.getByRole('button', { name: /Help shared VIK.*Общих позиций: 1/ }).click()
  await expect(dialog.getByRole('status', { name: 'Открываем «Help shared VIK»' })).toBeVisible()
  // A slow response must retain the previous, correctly labelled content and geometry.
  await expect(dialog.getByText('Результат внесён: 2 из 3', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Help RK.*Общих позиций/ })).toBeDisabled()
  expect(await dialog.boundingBox()).toEqual(initialBounds)
  releaseTransition()
  await expect(dialog.getByRole('region', { name: 'Исходные заявки' })).toBeVisible()
  expect(await dialog.boundingBox()).toEqual(initialBounds)
  await page.unroute('**/_serverFn/**', holdConnections)
  await expect(dialog.getByRole('button', { name: /Help B.*Общих позиций: 1/ })).toBeVisible()
  await dialog.getByRole('button', { name: 'К предыдущему документу', exact: true }).click()
  await expect(dialog.getByText('Ожидают результата: 1', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 740 })
  await expect(dialog).toBeInViewport()
  await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true }).last()).toBeInViewport()
  await dialog.screenshot({ path: 'outputs/document-workflow-help-connections-mobile.png' })
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).last().focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true }).first()).toBeFocused()
  await dialog.getByText('Позиций контроля: 3', { exact: true }).click()
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('Escape closes document connections after clicking text and preserves the underlying request manager', async ({ page }) => {
  await seed()
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
  await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование заявок ЛНК', exact: true }) })
  await manager.getByPlaceholder('Название, дата, стык или линия').fill('Help B')
  await manager.getByRole('button', { name: /Help B/ }).click()
  await manager.getByRole('button', { name: 'Связи документов', exact: true }).click()
  const connections = page.getByRole('dialog', { name: 'Связи документов', exact: true })
  await connections.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  await expect(preview).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  await expect(connections).toBeVisible()
  await expect(manager).toBeVisible()
  await connections.getByText('Позиций контроля: 1', { exact: true }).click()
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.keyboard.press('Escape')
  await expect(connections).toBeHidden()
  await expect(manager).toBeVisible()
  await expect(manager.getByRole('heading', { name: 'Help B', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(manager).toBeHidden()
})

for (const [route, title, count] of [
  ['/journal', 'Help B', 1],
  ['/lnk', 'Help B', 1],
  ['/psto', 'Help mixed diagram', 2],
] as const) test(`${route}: document cell context menu opens exact connections and preserves the report`, async ({ page }) => {
  await seed()
  let calls = 0
  page.on('request', request => { if (rpcName(request.url()).startsWith('getDocumentConnections_')) calls++ })
  await page.goto(route)
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  await search.fill(project)
  await expect(page.getByRole('button', { name: 'F97702', exact: true }).first()).toBeVisible()
  const document = page.getByRole('button', { name: title, exact: true }).first()
  const viewport = page.locator('.ag-grid-viewport')
  for (let step = 0; step < 40 && !await document.count(); step++) {
    if (await viewport.count()) await viewport.evaluate(element => { element.scrollLeft += 650 })
    else await page.evaluate(() => window.scrollBy(650, 0))
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
  await expect(document).toBeAttached()
  expect(calls).toBe(0)
  await document.click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Связи документов', exact: true }).click()
  const connections = page.getByRole('dialog', { name: 'Связи документов', exact: true })
  await expect(connections.getByText(title, { exact: true })).toBeVisible()
  await expect(connections.getByText(`Позиций контроля: ${count}`, { exact: true })).toBeVisible()
  expect(calls).toBe(1)
  await connections.getByText(`Позиций контроля: ${count}`, { exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(connections).toBeHidden()
  await expect(search).toHaveValue(project)
})

test('a large diagram keeps all request links across bounded pages', async ({ page }) => {
  const reference = await withLineProgramFixture(async db => {
    const rows = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,psto_request,psto_request_date,psto_result,psto_date,heat_treatment_diagram)
      select $1,'HELP','SCALE-L','F'||n,'Scale request '||(n%61),'2026-10-02','проведено','2026-10-03','Scale diagram'
      from generate_series(1,2000)n returning id,psto_request`, [project])).rows
    const groups = new Map<string, number[]>()
    for (const row of rows) groups.set(row.psto_request, [...(groups.get(row.psto_request) ?? []), Number(row.id)])
    const add = async (type: string, title: string, ids: number[], date: string) => {
      const metadata = JSON.stringify({ sourceKind: 'pstoCycle', cycleSequences: [1], sourcePositions: ids.map(id => ({ kind: 'pstoCycle', weldJointId: id, relationId: id, sequence: 1 })) })
      const id = (await db.query('insert into generated_documents(type,title,file_name,mime_type,period_from,row_count,source_metadata) values($1,$2,$3,$4,$5,$6,$7) returning id', [type, title, `${title}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', date, ids.length, metadata])).rows[0].id
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::integer[])', [id, ids])
      return id
    }
    for (const [title, ids] of groups) await add('system:pstoRequest', title, ids, '2026-10-02')
    const documentId = await add('system:pstoConclusion', 'Scale diagram', rows.map(row => Number(row.id)), '2026-10-03')
    return { documentId, type: 'pstoConclusion', title: 'Scale diagram', date: '2026-10-03', sourceKind: 'pstoCycle' } satisfies SystemDocumentReference
  })
  let observedRpc = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observedRpc = request.url() })
  const call = await rpc(page), seen = new Set<number>()
  const endpoint = siblingRpcUrl(observedRpc, 'getDocumentConnections_createServerFn_handler')
  const measurements: Array<{ page: number; sql?: number; bytes: number; milliseconds: number }> = []
  let positions = 0
  for (let page = 0; page < 3; page++) {
    const before = await auditSqlCount(endpoint), requestStarted = performance.now()
    const response = await call<Connections>('getDocumentConnections', { reference, page })
    const milliseconds = Math.round(performance.now() - requestStarted)
    const statements = before === undefined ? undefined : (await auditSqlCount(endpoint))! - before
    const bytes = Buffer.byteLength(JSON.stringify(response))
    if (statements !== undefined) {
      expect(statements).toBeGreaterThan(0)
      expect(statements).toBeLessThanOrEqual(10)
    }
    expect(bytes).toBeLessThan(32_000)
    measurements.push({ page, sql: statements, bytes, milliseconds })
    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({ total: 2000, completed: 2000, linked: 2000, documentCount: 61 })
    expect(response.result!.items).toHaveLength(page === 2 ? 1 : 30)
    for (const item of response.result!.items) { expect(seen.has(item.reference.documentId!)).toBe(false); seen.add(item.reference.documentId!); positions += item.positions }
  }
  expect(positions).toBe(2000)
  // The per-RPC budget includes session bookkeeping (which can add queries).
  // Bound every page, including 30 links and the final single link, instead of
  // requiring identical totals for authentication plus the document query.
  console.log('DOCUMENT_CONNECTIONS_BOUNDED', JSON.stringify(measurements))
  console.log(`Document connections: 2000 positions, 61 requests, 3 pages; HTTP calls ${measurements.reduce((sum, item) => sum + item.milliseconds, 0)} ms (SQL telemetry waits excluded)`)
})

test('receipt is visible only after commit, scoped to actor, compact, exact stage and absent after rollback', async ({ page }) => {
  const { docs } = await seed(), call = await rpc(page)
  const id = randomUUID(), operation = 'updateWeldJoints'
  const write = asE2eOwner(async (fail: boolean, nonce: string = id, payload: { row: number } = { row: 1 }) => {
    const context = accessContext.getStore()!; context.operation = operation; context.documentSaveId = nonce
    return requireDb().transaction(async tx => {
      const receipt = await beginDocumentSaveReceipt(tx, payload)
      await finishDocumentSaveReceipt(tx, receipt, [{ ...docs.a, rowIds: [1, 2], projects: ['private'] } as SystemDocumentReference, docs.preA])
      expect((await call<{ confirmed: boolean }>('checkDocumentSave', { operation, id: nonce })).result?.confirmed).toBe(false)
      if (fail) throw new Error('fixture rollback')
    })
  }, 'lnk.edit')
  await write(false)
  const receipt = (await call<{ confirmed: boolean; references: SystemDocumentReference[] }>('checkDocumentSave', { operation, id })).result!
  expect(receipt.confirmed).toBe(true)
  expect(receipt.references.map(ref => ref.documentId)).toEqual([docs.a.documentId, docs.preA.documentId])
  expect(JSON.stringify(receipt)).not.toMatch(/rowIds|projects|private/)
  await expect(write(false)).rejects.toThrow('WORKFLOW_SAVE_CONFIRMED')
  await expect(write(false, id, { row: 2 })).rejects.toThrow('другого состава')
  const rollback = randomUUID()
  await expect(write(true, rollback)).rejects.toThrow('fixture rollback')
  expect((await call<{ confirmed: boolean }>('checkDocumentSave', { operation, id: rollback })).result?.confirmed).toBe(false)
})

test('concurrent saves with the same UUID execute the mutation once and share its committed receipt', async ({ page }) => {
  const { docs } = await seed(), call = await rpc(page)
  const id = randomUUID(), operation = 'updateWeldJoints'
  let releaseFirst!: () => void, acquiredFirst!: () => void
  const firstAcquired = new Promise<void>(resolve => { acquiredFirst = resolve })
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
  let secondPid = 0, mutationCount = 0
  const save = asE2eOwner(async (first: boolean) => {
    const context = accessContext.getStore()!; context.operation = operation; context.documentSaveId = id
    return requireDb().transaction(async tx => {
      if (!first) secondPid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid)
      const receipt = await beginDocumentSaveReceipt(tx, { documentId: docs.a.documentId })
      mutationCount++
      if (first) { acquiredFirst(); await firstGate }
      await finishDocumentSaveReceipt(tx, receipt, [docs.a])
      return 'saved'
    })
  }, 'lnk.edit')
  const first = save(true)
  await firstAcquired
  const second = save(false).then(value => ({ value, error: null }), error => ({ value: null, error: error as Error }))
  try {
    await expect.poll(async () => secondPid && await withE2eDatabase(async db =>
      (await db.query("select wait_event_type='Lock' and wait_event='advisory' as waiting from pg_stat_activity where pid=$1", [secondPid])).rows[0]?.waiting,
    )).toBe(true)
    expect(mutationCount).toBe(1)
    expect((await call<{ confirmed: boolean }>('checkDocumentSave', { operation, id })).result?.confirmed).toBe(false)
  } finally { releaseFirst() }
  expect(await first).toBe('saved')
  expect((await second).error?.message).toContain('WORKFLOW_SAVE_CONFIRMED')
  expect(mutationCount).toBe(1)
  expect((await call<{ confirmed: boolean; references: SystemDocumentReference[] }>('checkDocumentSave', { operation, id })).result).toMatchObject({ confirmed: true, references: [{ documentId: docs.a.documentId }] })
})

test('reading an own committed receipt rechecks revoked view rights without discarding the receipt', async ({ page, browser, baseURL }) => {
  const { docs } = await seed(), call = await rpc(page)
  const email = `receipt-view-${randomUUID()}@e2e.test`, id = randomUUID(), operation = 'updateWeldJoints'
  await resetE2eAccountFixtureLimits()
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Инженер ЛНК', email, title: '', role: 'user', permissions: ['lnk.view', 'lnk.edit'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'workflow123' })
  const account = async () => (await requireDb().select().from(authUsers).where(eq(authUsers.email, email)))[0]
  const user = await account()
  await runWithAccess(toAccessIdentity(user), operation, ['lnk.edit'], async () => {
    accessContext.getStore()!.documentSaveId = id
    await requireDb().transaction(async tx => {
      const receipt = await beginDocumentSaveReceipt(tx, { documentId: docs.a.documentId })
      await finishDocumentSaveReceipt(tx, receipt, [docs.a])
    })
  })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'workflow123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const read = () => call<{ confirmed: boolean; references: SystemDocumentReference[] }>('checkDocumentSave', { operation, id }, context.request)
    expect((await read()).result?.confirmed).toBe(true)
    const change = asE2eOwner(changeAccount, 'welding.view')
    await change({ id: user.id, revision: user.revision, role: 'user', permissions: [] })
    const denied = await read()
    expect(denied.error).toBeDefined()
    expect(denied.result).toBeUndefined()
    expect(JSON.stringify(denied)).not.toContain(docs.a.title)
    const current = await account()
    await change({ id: user.id, revision: current.revision, role: 'user', permissions: ['lnk.view'] })
    expect((await read()).result).toMatchObject({ confirmed: true, references: [{ documentId: docs.a.documentId }] })
  } finally {
    await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})

test('actual legacy TVMT area and line deletion rights cannot be forged', async ({ page, browser, baseURL }) => {
  const { docs } = await seed(), call = await rpc(page)
  await withE2eDatabase(db => db.query("update generated_documents set type='system:lnkConclusionOther' where id=$1", [docs.tvmt.documentId]))
  await resetE2eAccountFixtureLimits()
  const nonce = randomUUID()
  await asE2eOwner(async () => {
    const context = accessContext.getStore()!; context.operation = 'updateWeldJoints'; context.documentSaveId = nonce
    await requireDb().transaction(async tx => { const receipt = await beginDocumentSaveReceipt(tx, { id: docs.a.documentId }); await finishDocumentSaveReceipt(tx, receipt, [docs.a]) })
  }, 'lnk.edit')()
  const email = `workflow-help-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Инженер ЛНК', email, title: '', role: 'user', permissions: ['lnk.view', 'lnk.edit', 'documents.view', 'lines.view', 'lines.edit'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'workflow123' })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'workflow123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    expect((await call('getDocumentConnections', { reference: docs.a }, context.request)).error).toBeUndefined()
    expect((await call('getDocumentConnections', { reference: { ...docs.a, documentId: docs.tvmt.documentId } }, context.request)).error).toBeDefined()
    expect((await call('deleteLineProgram', { id: 1, version: new Date().toISOString() }, context.request)).error).toBeDefined()
    expect((await call<{ confirmed: boolean }>('checkDocumentSave', { operation: 'updateWeldJoints', id: nonce }, context.request)).result?.confirmed).toBe(false)
  } finally { await context.close() }
})

async function emptyLine(line: string) {
  return withLineProgramFixture(async db => (await db.query('insert into line_programs(project_title,subtitle_code,line) values($1,$2,$3) returning id,updated_at', [project, 'HELP', line])).rows[0] as { id: number; updated_at: Date })
}
test('empty line deletion blocks hidden/legacy rows, closed history and stale clients', async ({ page }) => {
  const call = await rpc(page), empty = await emptyLine('EMPTY'), legacy = await emptyLine(' LEGACY '), history = await emptyLine('HISTORY')
  await withLineProgramFixture(async db => {
    await db.query("insert into weld_joints(project_title,subtitle_code,line,joint,officiality,revision_actuality) values($1,'help','legacy','F1','неофициальный','неактуальная')", [project])
    await db.query("insert into psto_chain_exceptions(line_program_id,root_joint,required,basis,closed_at,close_reason) values($1,'f1',true,'Historical decision',now(),'Closed')", [history.id])
  })
  for (const item of [legacy, history]) {
    const data = { id: item.id, version: item.updated_at.toISOString() }
    expect((await call<{ reason: string }>('previewLineProgramDeletion', data)).result?.reason).toBeTruthy()
    expect((await call('deleteLineProgram', data)).error).toBeDefined()
  }
  expect((await call('deleteLineProgram', { id: empty.id, version: '2020-01-01T00:00:00.000Z' })).error).toBeDefined()
  expect((await call('deleteLineProgram', { id: empty.id, version: empty.updated_at.toISOString() })).error).toBeUndefined()
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int as n from line_programs where project_title=$1', [project])).rows[0].n)).toBe(2)
})

test('empty line confirmation supports cancellation and refreshes the list after deletion', async ({ page }) => {
  const line = await emptyLine('DELETE-HELP')
  await page.goto('/journal')
  await page.getByRole('main').getByRole('button', { name: 'Программа линий', exact: true }).click()
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill('DELETE-HELP')
  const open = async () => {
    await program.getByRole('button', { name: 'Действия с линией DELETE-HELP', exact: true }).click()
    await page.getByRole('button', { name: 'Удалить линию из программы', exact: true }).click()
  }
  await open()
  const dialog = page.getByRole('dialog', { name: 'Удалить линию из программы', exact: true })
  await expect(dialog.getByRole('button', { name: 'Удалить линию', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await withE2eDatabase(async db => (await db.query('select id from line_programs where id=$1', [line.id])).rowCount)).toBe(1)
  await open()
  await dialog.screenshot({ path: 'outputs/document-workflow-help-line-delete.png' })
  await dialog.getByRole('button', { name: 'Удалить линию', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(program.getByText('Линии не найдены. Попробуйте изменить поиск или фильтр.')).toBeVisible()
})

test('deletion waits for concurrent line membership changes and rechecks all journal records', async ({ page }) => {
  const call = await rpc(page), line = await emptyLine('RACE')
  const lock = getWeldLineMembershipLockKeys([{ projectTitle: project, subtitleCode: 'HELP', line: 'RACE' }])[0]
  let deletion: ReturnType<typeof call> | undefined
  await withE2eDatabase(async db => {
    await db.query('begin')
    try {
      await db.query('select pg_advisory_xact_lock(hashtext($1))', [lock])
      deletion = call('deleteLineProgram', { id: line.id, version: line.updated_at.toISOString() })
      await expect.poll(() => withE2eDatabase(async read => Number((await read.query("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%ordered_weld_line_lock_keys%'")).rows[0].count))).toBeGreaterThan(0)
      await db.query("insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint) values($1,$2,'HELP','RACE','F999')", [line.id, project])
      await db.query('commit')
    } catch (error) { await db.query('rollback'); throw error }
  })
  const result = await deletion!
  expect(String(result.error)).toContain('В журнале есть записи этой линии')
  expect(await withE2eDatabase(async db => (await db.query('select id from line_programs where id=$1', [line.id])).rowCount)).toBe(1)
})
