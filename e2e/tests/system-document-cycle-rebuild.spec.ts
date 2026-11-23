import { asE2eOwner } from '../with-owner-access'
import { randomUUID } from 'node:crypto'
import { previewOperation as rawPreviewOperation, applyOperation as rawApplyOperation, getOperationResult as rawGetOperationResult } from '../../src/server/document-operation-service'
import type { DocumentOperationRequest } from '../../src/lib/system-document-operation'
import { openDocumentOperation, confirmDocumentOperation } from '../document-operation-ui'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcPayload, rpcName } from '../rpc'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { buildCurrentSystemDocumentName } from '../../src/lib/system-document-types'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { updateWeldJoint as raw_updateWeldJoint } from '@/server/weld-mutations'

const project = 'E2E cycle document rebuild'
let settings: { value: string; updated_at: Date } | undefined
const definitions = [
  { type: 'pstoRequest' as const, storage: 'pstoRequest', field: 'psto_request', date: '2026-09-04' },
  { type: 'pstoConclusion' as const, storage: 'pstoConclusion', field: 'heat_treatment_diagram', date: '2026-09-05' },
  { type: 'lnkRequest' as const, storage: 'tvmtRequest', methodCode: 'ТВМТ', field: 'tvmt_request', date: '2026-09-05' },
  { type: 'lnkConclusion' as const, storage: 'tvmtConclusion', methodCode: 'ТВМТ', field: 'tvmt_conclusion', date: '2026-09-06' },
]

test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    settings = (await db.query(`select value,updated_at from app_settings where key='request-conclusion'`)).rows[0]
    await db.query(`insert into app_settings(key,value) values ('request-conclusion',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({ ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, pstoRequest: 'line', pstoConclusion: 'line', tvmtRequest: 'line', tvmtConclusion: 'line' } })])
  })
})
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    if (settings) await db.query(`update app_settings set value=$1,updated_at=$2 where key='request-conclusion'`, [settings.value, settings.updated_at])
    else await db.query(`delete from app_settings where key='request-conclusion'`)
  })
})

async function seed(custom = false) {
  return withE2eDatabase(async db => {
    const ids: number[] = []
    for (let i = 1; i <= 2; i++) {
      ids.push((await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
        has_vik,psto_required,psto_request,psto_request_date,psto_date,heat_treatment_diagram,psto_result,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date)
        values ($1,'CYCLE',$2,$3,'2026-09-01','действующий','актуальная','да','да',
        'First request','2026-09-01','2026-09-02','First diagram','выполнено','First TVMT request','2026-09-02','не годен','First TVMT conclusion','2026-09-03') returning id`, [project, `CYCLE-L${i}`, `S${i}`])).rows[0].id)
    }
    const cycleId = (await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request_date,psto_date,psto_result,
      tvmt_request_date,tvmt_result,tvmt_conclusion_date,psto_note)
      values ($1,2,'2026-09-04','2026-09-05','выполнено','2026-09-05','годен','2026-09-06','  Do not normalize this history  ') returning id`, [ids[0]])).rows[0].id as number
    await db.query(`update weld_joints set psto_request_date='2026-09-04',psto_date='2026-09-05',tvmt_request_date='2026-09-05',
      tvmt_result='годен',tvmt_conclusion_date='2026-09-06' where id=$1`, [ids[1]])
    const documents: Array<{ id: number; title: string }> = []
    for (const definition of definitions) {
      const title = custom ? `Ручной ${definition.storage}` : buildCurrentSystemDocumentName({ ...definition, title: '' }, [], REQUEST_CONCLUSION_DEFAULT_SETTINGS, 900)
      // All column identifiers come from the fixed definitions above.
      await db.query(`update psto_repeat_cycles set ${definition.field}=$1 where id=$2`, [title, cycleId])
      await db.query(`update weld_joints set ${definition.field}=$1 where id=$2`, [title, ids[1]])
      const sourcePositions = [
        { kind: 'pstoCycle', weldJointId: ids[0], relationId: cycleId, sequence: 2 },
        { kind: 'pstoCycle', weldJointId: ids[1], relationId: ids[1], sequence: 1 },
      ].map(position => ({ ...position, ...(definition.type.startsWith('lnk') ? { methodCode: 'ТВМТ' } : {}) }))
      const metadata = { sourceKind: 'pstoCycle', sourcePositions, cycleSequences: [1, 2], positionCount: 2,
        ...(definition.type.startsWith('lnk') ? { methodCode: 'ТВМТ', methodCodes: ['ТВМТ'] } : { methodCodes: [] }),
        projects: [project], subtitleCodes: ['CYCLE'], lines: ['CYCLE-L1', 'CYCLE-L2'] }
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
        values ($1,$2,'cycle.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3,$3,2,$4) returning id`,
        [`system:${definition.storage}`, title, definition.date, JSON.stringify(metadata)])).rows[0].id
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2),($1,$3)`, [id, ...ids])
      documents.push({ id, title })
    }
    return { ids, cycleId, documents }
  })
}

async function snapshot() {
  return withE2eDatabase(async db => ({
    rows: (await db.query(`select * from weld_joints where project_title=$1 order by id`, [project])).rows,
    cycles: (await db.query(`select c.* from psto_repeat_cycles c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by c.id`, [project])).rows,
    documents: (await db.query(`select distinct d.* from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
      join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 order by d.id`, [project])).rows,
    counters: (await db.query(`select * from app_settings where key like 'system-document-next-number:%' order by key`)).rows,
  }))
}

function request(documentIds: number[], mode: 'line' | 'none' = 'line', merge = false): DocumentOperationRequest { return { documentIds, action: 'split', mode, merge } }
async function prepare(input: DocumentOperationRequest) {
  const preview = await previewOperation(input)
  return { ...input, fingerprint: preview.fingerprint, previewHash: preview.previewHash, operationId: randomUUID() }
}
function facts(record: Record<string, unknown>) {
  const names = new Set(definitions.map(item => item.field))
  return Object.fromEntries(Object.entries(record).filter(([key]) => !names.has(key) && !['updated_at', 'lnk_updated_at', 'psto_updated_at'].includes(key)))
}



test('all four mixed-cycle kinds through UI: split, standalone merge, cancel, stale preview and exact preserved positions', async ({ page }, info) => {
  const data = await seed(), errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', req => { if (req.url().includes('/_serverFn/')) calls.push(rpcName(req.url()).split('_')[0]) })
  const kinds = ['Заявка ПСТО', 'Заключение ПСТО', 'Заявка ТВМТ', 'Заключение ТВМТ']
  for (let i = 0; i < definitions.length; i++) {
    let dialog = await openDocumentOperation(page, [data.documents[i].title], kinds[i])
    await expect(dialog.getByText(/Выбрано в пакете: 1 → Получится: 2/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Посмотреть состав: 1' }).first().click()
    const panel = dialog.getByRole('complementary', { name: 'Состав будущего документа' })
    await expect(panel.locator('tbody tr')).toHaveCount(1)
    await expect(panel.locator('tbody')).toContainText('S1')
    await expect(panel.locator('tbody tr')).toContainText('Цикл 2')
    await panel.getByRole('button', { name: 'Свернуть состав' }).click()
    if (i === 0) {
      const beforeCancel = await snapshot()
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
      expect(await snapshot()).toEqual(beforeCancel)
      expect(calls.filter(name => name === 'applyDocumentOperation')).toHaveLength(0)
      dialog = await openDocumentOperation(page, [data.documents[i].title], kinds[i])
      await withE2eDatabase(db => db.query('update psto_repeat_cycles set psto_note=$1 where id=$2', ['Changed by second operator', data.cycleId]))
      const beforeStale = await snapshot()
      await dialog.getByRole('button', { name: 'Подтвердить и применить' }).click()
      await expect(dialog.getByRole('alert')).toContainText('Нажмите «Проверить изменения»')
      expect(await snapshot()).toEqual(beforeStale)
      await dialog.getByRole('button', { name: 'Проверить результат' }).click()
      await dialog.getByRole('button', { name: 'Проверить изменения' }).click()
      await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeEnabled()
      await dialog.screenshot({ path: info.outputPath('cycle-split-preview.png') })
    }
    const before = await snapshot()
    await confirmDocumentOperation(dialog)
    const after = await snapshot()
    expect(after.rows.map(facts)).toEqual(before.rows.map(facts))
    expect(after.cycles.map(facts)).toEqual(before.cycles.map(facts))
    for (const definition of definitions) expect(after.rows[0][definition.field]).toEqual(before.rows[0][definition.field])
    const pair = after.documents.filter(doc => doc.type === 'system:' + definitions[i].storage && JSON.parse(doc.source_metadata || '{}').sourceKind === 'pstoCycle')
    expect(pair).toHaveLength(2)
    expect(pair.map(doc => doc.id)).toContain(data.documents[i].id)
    expect(pair.flatMap(doc => JSON.parse(doc.source_metadata).sourcePositions).map(({ weldJointId, relationId, sequence }) => [weldJointId, relationId, sequence]).sort()).toEqual([[data.ids[0], data.cycleId, 2], [data.ids[1], data.ids[1], 1]].sort())
    await dialog.getByRole('button', { name: 'Остановиться / закрыть' }).click()

    // Explicit merge must reunite different welds' cycles, not confuse their sequence numbers.
    dialog = await openDocumentOperation(page, pair.map(doc => doc.title), kinds[i], 'merge')
    await expect(dialog.getByText('Выбрано в пакете: 2 → Получится: 1')).toBeVisible()
    await confirmDocumentOperation(dialog)
    const mergedState = await snapshot()
    expect(mergedState.rows.map(facts)).toEqual(after.rows.map(facts))
    expect(mergedState.cycles.map(facts)).toEqual(after.cycles.map(facts))
    const merged = mergedState.documents.filter(doc => doc.type === 'system:' + definitions[i].storage && JSON.parse(doc.source_metadata || '{}').sourceKind === 'pstoCycle')
    expect(merged).toHaveLength(1)
    expect(JSON.parse(merged[0].source_metadata).sourcePositions).toEqual(expect.arrayContaining(pair.flatMap(doc => JSON.parse(doc.source_metadata).sourcePositions)))
    expect(JSON.parse(merged[0].source_metadata).sourcePositions).toHaveLength(2)
    expect(mergedState.cycles[0][definitions[i].field]).toBe(merged[0].title)
    expect(mergedState.rows[1][definitions[i].field]).toBe(merged[0].title)
    expect(mergedState.rows[0][definitions[i].field]).toBe(after.rows[0][definitions[i].field])
    await dialog.getByRole('button', { name: 'Остановиться / закрыть' }).click()
  }
  expect(calls.filter(name => name === 'applyDocumentOperation')).toHaveLength(9)
  expect(errors).toEqual([])
})

test('pending operation cannot be dismissed as cancellation', async ({ page }) => {
  const data = await seed(), dialog = await openDocumentOperation(page, [data.documents[0].title])
  let release!: () => void, received!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { received = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith('applyDocumentOperation_')) return route.continue()
    const response = await route.fetch(); received(); await gate; await route.fulfill({ response })
  })
  await dialog.getByRole('button', { name: 'Подтвердить и применить' }).click()
  await ready
  try {
    await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeDisabled()
  } finally { release() }
  await expect(dialog.getByRole('status')).toContainText('Сохранено пакетов: 1')
})

test('custom cycle names need explicit names for changed membership; other kinds stay untouched', async ({ page }) => {
  const data = await seed(true), dialog = await openDocumentOperation(page, [data.documents[0].title])
  await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeDisabled()
  const before = await snapshot()
  const inputs = dialog.getByRole('textbox', { name: /^Название:/ })
  await inputs.nth(0).fill('Ручная заявка Л1'); await inputs.nth(1).fill('Ручная заявка Л2'); await inputs.nth(1).blur()
  await dialog.getByRole('button', { name: 'Проверить изменения' }).click()
  await confirmDocumentOperation(dialog)
  const after = await snapshot()
  for (const original of before.documents.filter(doc => data.documents.slice(1).some(item => item.id === doc.id))) expect(after.documents.find(doc => doc.id === original.id)?.title).toBe(original.title)
  expect(after.cycles[0].psto_request).toBe('Ручная заявка Л1')
  expect(after.rows[1].psto_request).toBe('Ручная заявка Л2')
})

test('manual collision with unselected legacy first cycle is refused, including direct apply', async () => {
  const data = await seed(true)
  await withE2eDatabase(async db => {
    const id = (await db.query("insert into weld_joints(project_title,subtitle_code,line,joint,psto_request,psto_request_date) values ($1,'CYCLE','L3','S3','Occupied','2026-09-04') returning id", [project])).rows[0].id
    const doc = (await db.query("insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata) values ('system:pstoRequest','Occupied','occupied.xlsx','application/xlsx','2026-09-04','2026-09-04',1,'{}') returning id")).rows[0].id
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)', [doc, id])
  })
  const input = request(data.documents.map(d => d.id)), preview = await previewOperation(input)
  const names = Object.fromEntries(preview.groups.map((g, i) => [g.key, { mode: 'custom' as const, name: i === 0 ? 'Occupied' : 'Independent ' + i, membership: g.membership }]))
  const conflict = await previewOperation({ ...input, names })
  expect(conflict.groups[0].error).toContain('вне выбора')
  const before = await snapshot()
  await expect(applyOperation({ ...input, names, fingerprint: conflict.fingerprint, previewHash: conflict.previewHash, operationId: randomUUID() })).rejects.toThrow('вне выбора')
  expect(await snapshot()).toEqual(before)
})

test('active history refresh is coalesced and reopening does not restore stale names', async ({ page }) => {
  const data = await seed(true), calls: string[] = []
  const historyRequests: Array<{ selectionOnly?: boolean; selectedIds?: Array<string | number>; startRow: number; endRow: number }> = []
  page.on('request', req => {
    if (!req.url().includes('/_serverFn/')) return
    const name = rpcName(req.url()).split('_')[0]
    calls.push(name)
    if (name === 'listSystemDocumentHistoryGrid') {
      const payload = deserializeRpcPayload(req.postData()!) as { data: typeof historyRequests[number] }
      historyRequests.push(payload.data)
    }
  })
  const dialog = await openDocumentOperation(page, [data.documents[0].title])
  const before = historyRequests.length
  const inputs = dialog.getByRole('textbox', { name: /^Название:/ })
  await inputs.nth(0).fill('Cached history L1'); await inputs.nth(1).fill('Cached history L2'); await inputs.nth(1).blur()
  await dialog.getByRole('button', { name: 'Проверить изменения' }).click()
  await confirmDocumentOperation(dialog)
  await dialog.getByRole('button', { name: 'Остановиться / закрыть' }).click()
  await expect(page.getByText('Cached history L1', { exact: true })).toBeVisible()
  await expect(page.getByText('Cached history L2', { exact: true })).toBeVisible()
  // Refresh the active block once. Retained selection contains IDs only;
  // its current cards are hydrated lazily when the next action is opened.
  expect(historyRequests).toHaveLength(before + 1)
  expect(historyRequests[before].selectionOnly).toBeUndefined()
  await page.getByRole('button', { name: /^Действия с документами, выбрано:/ }).click()
  await page.getByRole('button', { name: 'Изменить разделение', exact: true }).click()
  const reopened = page.getByRole('dialog', { name: 'Изменить разделение', exact: true })
  await expect(reopened.getByRole('textbox', { name: /^Название:/ }).first()).toHaveValue('Cached history L1')
  expect(historyRequests).toHaveLength(before + 2)
  expect(historyRequests[before + 1]).toMatchObject({ selectionOnly: true })
  expect(historyRequests[before + 1].selectedIds).toHaveLength(1)
  for (const request of historyRequests.slice(before)) expect(request.endRow - request.startRow).toBe(100)
  expect(calls.filter(n => n === 'getDocumentOperationComposition')).toHaveLength(0)
})

test('concurrent naming template change rejects stale preview, while another split preference does not rewrite a draft', async () => {
  const data = await seed(), input = request([data.documents[0].id]), prepared = await prepare(input)
  await withE2eDatabase(async db => {
    const row = (await db.query("select value from app_settings where key='request-conclusion'")).rows[0]
    const value = JSON.parse(row.value); value.pstoRequest.systemPattern = 'Changed-{{номер}}'
    await db.query("update app_settings set value=$1,updated_at=now() where key='request-conclusion'", [JSON.stringify(value)])
  })
  const before = await snapshot()
  await expect(applyOperation(prepared)).rejects.toThrow('Нажмите «Проверить изменения»')
  expect(await snapshot()).toEqual(before)
  const fresh = await prepare(input)
  await withE2eDatabase(async db => {
    const value = JSON.parse((await db.query("select value from app_settings where key='request-conclusion'")).rows[0].value)
    value.splitModes.pstoRequest = 'none'; value.splitModes.tvmtRequest = 'joint'
    await db.query("update app_settings set value=$1,updated_at=now() where key='request-conclusion'", [JSON.stringify(value)])
  })
  expect((await applyOperation(fresh)).resultingDocumentCount).toBe(2)
  await withE2eDatabase(async db => {
    const value = JSON.parse((await db.query("select value from app_settings where key='request-conclusion'")).rows[0].value)
    expect(value.splitModes.pstoRequest).toBe('line'); expect(value.splitModes.tvmtRequest).toBe('joint')
  })
})

test('names update persisted dispatcher links with one scoped invalidation', async () => {
  const data = await seed()
  await withE2eDatabase(db => db.query("update weld_joints set weld_date='2026-09-07' where id=$1", [data.ids[1]]))
  await markDispatcherTaskIndexDirty(); await ensureDispatcherTaskIndexFresh()
  const readActions = () => withE2eDatabase(async db => (await db.query('select tasks from dispatcher_task_pages')).rows.flatMap(row => JSON.parse(row.tasks)).filter(task => task.row?.id === data.ids[1]).flatMap(task => task.rootCauseActions ?? []).map(action => action.target.documentName).filter(Boolean))
  expect(await readActions()).toContain(data.documents[0].title)
  const before = await withE2eDatabase(async db => (await db.query('select source_revision from dispatcher_task_index_state where id=1')).rows[0])
  await applyOperation(await prepare(request(data.documents.map(d => d.id))))
  const current = (await snapshot()).rows.find(row => row.id === data.ids[1])!.psto_request
  const dirty = await withE2eDatabase(async db => (await db.query('select full_rebuild,dirty_scopes from dispatcher_task_index_state where id=1')).rows[0])
  expect(dirty.full_rebuild).toBe(false); expect(JSON.parse(dirty.dirty_scopes)).toHaveLength(2)
  await ensureDispatcherTaskIndexFresh()
  expect(await readActions()).toContain(current); expect(await readActions()).not.toContain(data.documents[0].title)
  const after = await withE2eDatabase(async db => (await db.query('select source_revision,computed_revision from dispatcher_task_index_state where id=1')).rows[0])
  expect(after.source_revision).toBe(before.source_revision + 1); expect(after.computed_revision).toBe(after.source_revision)
})

test('concurrent stale edit and document operation wait, then reject; unrelated readers see committed state', async () => {
  const data = await seed(), input = request(data.documents.map(d => d.id)), first = await prepare(input), second = await prepare(input)
  const before = await snapshot()
  const version = await withE2eDatabase(async db => (await db.query('select xmin::text as version from weld_joints where id=$1', [data.ids[1]])).rows[0].version)
  let save!: ReturnType<typeof applyOperation>, stale!: Promise<string>, edit!: Promise<string>
  await withE2eDatabase(async gate => {
    await gate.query('begin')
    try {
      await gate.query('select id from generated_documents where id=$1 for update', [data.documents[0].id])
      const pid = (await gate.query('select pg_backend_pid() as pid')).rows[0].pid
      save = applyOperation(first)
      const waiting = () => withE2eDatabase(async db => (await db.query('select pid from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid))', [pid])).rows)
      await expect.poll(async () => (await waiting()).length).toBe(1)
      const [operation] = await waiting()
      expect(await snapshot()).toEqual(before)
      edit = updateWeldJoint({ data: { id: data.ids[1], expectedVersion: version, weldingJournalNote: 'Must not overwrite' } }).then(() => 'unexpected', error => error.message)
      stale = applyOperation(second).then(() => 'unexpected', error => error.message)
      await expect.poll(() => withE2eDatabase(async db => (await db.query('select count(*)::int as n from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid))', [operation.pid])).rows[0].n)).toBe(2)
    } finally { await gate.query('rollback') }
  })
  expect((await save).changedDocumentCount).toBe(4)
  expect(await edit).toContain('уже изменен другим пользователем'); expect(await stale).toContain('Нажмите «Проверить изменения»')
  expect((await snapshot()).rows.map(facts)).toEqual(before.rows.map(facts))
})

test('late failure rolls back all four kinds, exact cycles, links and counters; same operation retries once', async () => {
  const data = await seed(), prepared = await prepare(request(data.documents.map(d => d.id))), before = await snapshot()
  await withE2eDatabase(db => db.query(`alter table generated_documents add constraint e2e_rebuild_late_failure check (not (row_count=1 and source_metadata like '%E2E cycle document rebuild%'))`))
  try { await expect(applyOperation(prepared)).rejects.toThrow(); expect(await snapshot()).toEqual(before) }
  finally { await withE2eDatabase(db => db.query('alter table generated_documents drop constraint e2e_rebuild_late_failure')) }
  const result = await applyOperation(prepared)
  expect(result).toEqual({ changedDocumentCount: 4, resultingDocumentCount: 8, affectedRowCount: 2 })
  expect(await applyOperation(prepared)).toEqual(result)
  expect(await getOperationResult(prepared.operationId)).toEqual(result)
  const after = await snapshot()
  expect(after.rows.map(facts)).toEqual(before.rows.map(facts)); expect(after.cycles.map(facts)).toEqual(before.cycles.map(facts))
})

test('lost HTTP response is recovered from the committed receipt without another mutation', async ({ page }) => {
  const data = await seed(), dialog = await openDocumentOperation(page, [data.documents[0].title]), calls: string[] = []
  page.on('request', req => { if (req.url().includes('/_serverFn/')) calls.push(rpcName(req.url()).split('_')[0]) })
  await page.route(url => rpcName(url.toString()).startsWith('applyDocumentOperation_'), async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('timedout') }, { times: 1 })
  const before = await snapshot()
  await confirmDocumentOperation(dialog)
  expect(calls.filter(n => n === 'applyDocumentOperation')).toHaveLength(1)
  expect(calls.filter(n => n === 'getDocumentOperationResult')).toHaveLength(1)
  expect((await snapshot()).rows.map(facts)).toEqual(before.rows.map(facts))
  await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeDisabled()
})

const updateWeldJoint = asE2eOwner(raw_updateWeldJoint, 'welding.edit')
const previewOperation = asE2eOwner(rawPreviewOperation, 'documents.view')
const applyOperation = asE2eOwner(rawApplyOperation, 'documents.edit')
const getOperationResult = asE2eOwner(rawGetOperationResult, 'documents.view')

test('whole-document rename preserves mixed primary/repeat cycles, document IDs and unrelated fields', async () => {
  const fixture = await seed(true)
  const { changeSystemDocumentDate: rawChange } = await import('@/server/system-document-date-workflow')
  const change = asE2eOwner(rawChange, 'documents.edit')
  const initial = await snapshot()
  for (const [index, definition] of definitions.entries()) {
    const doc = fixture.documents[index]
    const versions = await withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [fixture.ids])).rows)
    const nextTitle = `${doc.title} renamed`
    await change({ data: {
      reference: { documentId: doc.id, type: definition.type, methodCode: definition.methodCode,
        title: doc.title, date: definition.date, sourceKind: 'pstoCycle', cycleSequences: [1, 2] },
      nextDate: definition.date, nextTitle, expectedVersions: versions,
    } })
    const current = await snapshot()
    expect(current.documents.find(row => row.id === doc.id)).toMatchObject({ title: nextTitle, row_count: 2 })
    expect(current.rows.find(row => row.id === fixture.ids[1])![definition.field]).toBe(nextTitle)
    expect(current.cycles[0][definition.field]).toBe(nextTitle)
    expect(current.rows.find(row => row.id === fixture.ids[0])![definition.field]).toBe(initial.rows.find(row => row.id === fixture.ids[0])![definition.field])
  }
  const after = await snapshot()
  const omit = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))
  const changed = [...definitions.map(d => d.field), 'updated_at', 'psto_updated_at']
  expect(after.rows.map(row => omit(row, changed))).toEqual(initial.rows.map(row => omit(row, changed)))
  expect(after.cycles.map(row => omit(row, changed))).toEqual(initial.cycles.map(row => omit(row, changed)))
  expect(after.documents.map(row => omit(row, ['title', 'file_name', 'updated_at']))).toEqual(initial.documents.map(row => omit(row, ['title', 'file_name', 'updated_at'])))
})

test('whole-document rename preserves the system-request restriction through cycle history', async () => {
  const fixture = await seed()
  const { changeSystemDocumentDate: rawChange } = await import('@/server/system-document-date-workflow')
  const change = asE2eOwner(rawChange, 'documents.edit')
  const doc = fixture.documents[0], definition = definitions[0]
  const versions = await withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [fixture.ids])).rows)
  const before = await snapshot()
  await expect(change({ data: {
    reference: { documentId: doc.id, type: definition.type, title: doc.title, date: definition.date, sourceKind: 'pstoCycle', cycleSequences: [1, 2] },
    nextDate: definition.date, nextTitle: 'Changed system request', expectedVersions: versions,
  } })).rejects.toThrow('Системную заявку нельзя переименовать')
  expect(await snapshot()).toEqual(before)
})

test('history uses explicit editing for all four PSTO/TVMT stages and keeps the mobile dialog within the viewport', async ({ page }, info) => {
  await seed(true)
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'История ПСТО и ТВМТ', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'История ПСТО и ТВМТ', exact: true }) })
  await dialog.getByPlaceholder('Стык, линия или документ').fill('CYCLE-L1')
  await expect(dialog.getByRole('tab', { name: 'Повтор #2', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(4)
  await expect(dialog.getByLabel('Название всего документа', { exact: true })).toHaveCount(0)
  for (const label of ['Заявка ПСТО', 'Результат ПСТО', 'Заявка ТВМТ', 'Заключение ТВМТ']) {
    const card = dialog.locator('article').filter({ has: page.getByRole('heading', { name: label, exact: true }) })
    await card.click({ button: 'right' })
    await page.getByRole('button', { name: 'Внести изменения', exact: true }).click()
    await expect(card.getByRole('button', { name: 'К документу', exact: true })).toBeEnabled()
    await expect(card.getByText(/только этого стыка$/, { exact: false })).toBeVisible()
    await card.getByRole('button', { name: 'Свернуть редактирование', exact: true }).click()
    await expect(card.getByRole('button', { name: 'К документу', exact: true })).not.toBeVisible()
    await expect(card.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  }
  const diagram = dialog.locator('article').filter({ has: page.getByRole('heading', { name: 'Результат ПСТО', exact: true }) })
  await diagram.scrollIntoViewIfNeeded()
  await diagram.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await diagram.getByRole('button', { name: 'К документу', exact: true }).click()
  const documentPane = dialog.getByRole('tabpanel', { name: 'Документы', exact: true })
  await documentPane.getByLabel('Название документа', { exact: true }).fill('Общая исправленная диаграмма')
  await documentPane.getByRole('button', { name: 'Сохранить изменения документа', exact: true }).click()
  const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Сохранить изменения документа', exact: true }) })
  await expect(confirm).toContainText('2 поз. в 2 ст.')
  await confirm.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await expect(documentPane.getByRole('heading', { name: 'Общая исправленная диаграмма', exact: true })).toBeVisible()
  await expect(documentPane.getByRole('button', { name: 'Сохранить изменения документа', exact: true })).toHaveCount(0)
  await documentPane.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await dialog.screenshot({ path: info.outputPath('psto-editing-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 2)).toBe(true)
  const asideBox = await documentPane.getByRole('complementary').boundingBox()
  const mainBox = await documentPane.getByRole('main').boundingBox()
  expect(asideBox!.y + asideBox!.height).toBeLessThanOrEqual(mainBox!.y + 1)
  await documentPane.getByRole('button', { name: 'Сохранить изменения документа', exact: true }).scrollIntoViewIfNeeded()
  await dialog.screenshot({ path: info.outputPath('psto-editing-mobile.png') })
})

test('TVMT menu opens shared tabs; all four document kinds save date and name with cancellation and chronology checks', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = await seed(true)
  await ensureDispatcherTaskIndexFresh()
  const initial = await snapshot()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'ТВМТ', exact: true }).click()
  await page.getByRole('button', { name: 'История ПСТО и ТВМТ', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'История ПСТО и ТВМТ', exact: true }) })
  await expect(dialog.getByRole('tab', { name: 'Стыки', exact: true })).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('tab', { name: 'Документы', exact: true }).click()
  const pane = dialog.getByRole('tabpanel', { name: 'Документы', exact: true })
  const choices = ['psto-requests', 'psto-results', 'tvmt-requests', 'tvmt-results']
  const dates = ['2026-09-03', '2026-09-04', '2026-09-04', '2026-09-07']
  const dateFields = ['psto_request_date', 'psto_date', 'tvmt_request_date', 'tvmt_conclusion_date']
  for (const [i, definition] of definitions.entries()) {
    await pane.getByRole('combobox', { name: 'Вид документа', exact: true }).selectOption(choices[i])
    await pane.getByPlaceholder('Поиск документов').fill(fixture.documents[i].title)
    await pane.getByRole('complementary').getByRole('button').filter({ hasText: fixture.documents[i].title }).click()
    await pane.getByRole('button', { name: 'Редактировать', exact: true }).click()
    const date = pane.getByLabel('Дата документа', { exact: true })
    const name = pane.getByLabel('Название документа', { exact: true })
    const save = pane.getByRole('button', { name: 'Сохранить изменения документа', exact: true })
    await expect(date).toBeEnabled()
    await expect(name).toBeEnabled()
    await expect(pane.getByRole('region', { name: 'Полный состав документа' })).toContainText('S1')
    await expect(pane.getByRole('region', { name: 'Полный состав документа' })).toContainText('S2')
    const before = await snapshot()
    await date.fill('2026-08-31')
    await expect(save).toBeDisabled()
    await expect(pane.getByText(/Сохранение заблокировано:/)).toBeVisible()
    expect(await snapshot()).toEqual(before)
    const nextTitle = `${fixture.documents[i].title} исправлено через вкладку`
    await date.fill(dates[i])
    await name.fill(nextTitle)
    await save.click()
    const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Сохранить изменения документа', exact: true }) })
    await expect(confirm).toContainText('2 поз. в 2 ст.')
    await confirm.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await snapshot()).toEqual(before)
    await expect(name).toHaveValue(nextTitle)
    await expect(date).toHaveValue(dates[i])
    await save.click()
    await confirm.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    await expect(pane.getByRole('heading', { name: nextTitle, exact: true })).toBeVisible()
    const after = await snapshot()
    expect(after.documents.find(doc => doc.id === fixture.documents[i].id)).toMatchObject({ title: nextTitle, row_count: 2 })
    expect(after.rows.find(row => row.id === fixture.ids[1])![definition.field]).toBe(nextTitle)
    expect(after.cycles[0][definition.field]).toBe(nextTitle)
    // The primary history of S1 must not be confused with its selected repeat.
    expect(after.rows.find(row => row.id === fixture.ids[0])![definition.field]).toBe(initial.rows.find(row => row.id === fixture.ids[0])![definition.field])
    const storedDates = await withE2eDatabase(async db => (await db.query(`select ${dateFields[i]}::text as date from weld_joints where id=$1
      union all select ${dateFields[i]}::text from psto_repeat_cycles where id=$2`, [fixture.ids[1], fixture.cycleId])).rows)
    expect(storedDates.map(row => row.date)).toEqual([dates[i], dates[i]])
  }
  expect(errors).toEqual([])
})
