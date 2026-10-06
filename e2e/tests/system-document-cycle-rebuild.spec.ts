import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { buildCurrentSystemDocumentName } from '../../src/lib/system-document-types'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { updateWeldJoint } from '@/server/weld-mutations'

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

async function openRebuild(page: Page, navigate = true) {
  if (navigate) await page.goto('/settings')
  else await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  await page.getByRole('button', { name: 'Заявки и заключения', exact: true }).click()
  await page.getByRole('button', { name: 'Пересобрать системные документы по текущим правилам', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Пересборка системных документов', exact: true }) })
  await expect(dialog.getByText('Область пересборки', { exact: true })).toBeVisible()
  return dialog
}

function facts(record: Record<string, unknown>) {
  const names = new Set(definitions.map(item => item.field))
  return Object.fromEntries(Object.entries(record).filter(([key]) => !names.has(key) && !['updated_at', 'lnk_updated_at', 'psto_updated_at'].includes(key)))
}

test('all four mixed-cycle documents: cancel, stale preview, retry, preserved facts and exact positions', async ({ page }, info) => {
  const seedData = await seed(), errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) requests.push(rpcName(request.url()).split('_')[0]) })
  let dialog = await openRebuild(page)
  await expect(dialog.getByText(/S1 \(циклы: 2\)/).first()).toBeVisible()
  await expect(dialog.getByText(/S2 \(циклы: 1\)/).first()).toBeVisible()
  const beforeCancel = await snapshot()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await snapshot()).toEqual(beforeCancel)
  expect(requests.filter(name => name === 'previewSystemDocumentRebuild')).toHaveLength(1)
  expect(requests.filter(name => name === 'applySystemDocumentRebuild')).toHaveLength(0)
  dialog = await openRebuild(page)
  await withE2eDatabase(db => db.query(`update psto_repeat_cycles set psto_note='Changed by second operator' where id=$1`, [seedData.cycleId]))
  const beforeStale = await snapshot()
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog.getByText(/Системные документы или стыки изменились/)).toBeVisible()
  expect(await snapshot()).toEqual(beforeStale)
  await dialog.getByRole('button', { name: 'Обновить предпросмотр', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('cycle-rebuild-preview.png'), fullPage: true })
  const before = await snapshot()
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await snapshot()
  expect(after.rows.map(facts)).toEqual(before.rows.map(facts))
  expect(after.cycles.map(facts)).toEqual(before.cycles.map(facts))
  for (const definition of definitions) expect(after.rows[0][definition.field]).toEqual(before.rows[0][definition.field])
  const cycleDocuments = after.documents.filter(doc => JSON.parse(doc.source_metadata || '{}').sourceKind === 'pstoCycle')
  expect(cycleDocuments).toHaveLength(8)
  for (const definition of definitions) {
    const pair = cycleDocuments.filter(doc => doc.type === `system:${definition.storage}`)
    expect(pair).toHaveLength(2)
    expect(new Set(pair.map(doc => doc.title)).size).toBe(2)
    expect(pair.map(doc => JSON.parse(doc.source_metadata).sourcePositions).flat().map(({ weldJointId, relationId, sequence }) =>
      [weldJointId, relationId, sequence]).sort()).toEqual([[seedData.ids[0], seedData.cycleId, 2], [seedData.ids[1], seedData.ids[1], 1]].sort())
    expect(pair.map(doc => doc.title)).toContain(after.cycles[0][definition.field])
    expect(pair.map(doc => doc.title)).toContain(after.rows[1][definition.field])
  }
  expect(errors).toEqual([])
})

test('pending rebuild cannot be dismissed as if it were cancelled', async ({ page }, info) => {
  await seed()
  const dialog = await openRebuild(page)
  let release!: () => void, received!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const responseReady = new Promise<void>(resolve => { received = resolve })
  let writes = 0
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith('applySystemDocumentRebuild_')) return route.continue()
    writes++
    // Real local save, held response: closing a modal cannot undo this commit.
    const response = await route.fetch()
    received()
    await gate
    await route.fulfill({ response })
  })
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await responseReady
  try {
    await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Применяю...', exact: true })).toBeDisabled()
    await dialog.screenshot({ path: info.outputPath('rebuild-pending.png') })
    expect(writes).toBe(1)
  } finally { release() }
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Пересобрано документов: 4 · затронуто стыков: 2', { exact: true })).toBeVisible()
})

test('custom cycle documents stay unchanged until explicit manual split', async ({ page }) => {
  const data = await seed(true)
  const dialog = await openRebuild(page)
  await expect(dialog.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeDisabled()
  const before = await snapshot()
  const customSection = dialog.locator('section').filter({ has: page.getByRole('heading', { name: 'Пользовательские названия', exact: true }) })
  const document = customSection.getByText(data.documents[0].title, { exact: true }).locator('xpath=../..').locator('..')
  await document.getByRole('button', { name: 'Пересобрать вручную', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeDisabled()
  await document.getByRole('textbox').nth(0).fill('Ручная заявка Л1')
  await document.getByRole('textbox').nth(1).fill('Ручная заявка Л2')
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await snapshot()
  for (const original of before.documents.filter(doc => data.documents.slice(1).some(item => item.id === doc.id))) {
    // Metadata timestamps may refresh, but names and position membership do not.
    expect(after.documents.find(doc => doc.id === original.id)?.title).toBe(original.title)
  }
  expect(after.cycles[0].psto_request).toBe('Ручная заявка Л1')
  expect(after.rows[1].psto_request).toBe('Ручная заявка Л2')
})

test('a manual name colliding with an existing first-cycle document rolls back every group', async ({ page }) => {
  const data = await seed(true)
  await withE2eDatabase(async db => {
    // Another selected kind reserves a new system number before the conflict
    // is detected; its counter and every document must roll back as well.
    const automaticName = buildCurrentSystemDocumentName({ ...definitions[1], title: '' }, [], REQUEST_CONCLUSION_DEFAULT_SETTINGS, 900)
    await db.query('update psto_repeat_cycles set heat_treatment_diagram=$1 where id=$2', [automaticName, data.cycleId])
    await db.query('update weld_joints set heat_treatment_diagram=$1 where id=$2', [automaticName, data.ids[1]])
    await db.query('update generated_documents set title=$1 where id=$2', [automaticName, data.documents[1].id])
    const id = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,has_vik,psto_required,psto_request,psto_request_date)
      values ($1,'CYCLE','CYCLE-L3','S3','2026-09-01','да','да','Occupied','2026-09-04') returning id`, [project])).rows[0].id
    const doc = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
      values ('system:pstoRequest','Occupied','occupied.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-09-04','2026-09-04',1,$1) returning id`,
      [JSON.stringify({ positionCount: 1, projects: [project], lines: ['CYCLE-L3'], methodCodes: [] })])).rows[0].id
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)`, [doc, id])
  })
  const dialog = await openRebuild(page)
  const customSection = dialog.locator('section').filter({ has: page.getByRole('heading', { name: 'Пользовательские названия', exact: true }) })
  const document = customSection.getByText(data.documents[0].title, { exact: true }).locator('xpath=../..').locator('..')
  await document.getByRole('button', { name: 'Пересобрать вручную', exact: true }).click()
  await document.getByRole('textbox').nth(0).fill('Non-conflicting repeat')
  await document.getByRole('textbox').nth(1).fill('Occupied')
  const before = await snapshot()
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog.getByText(/одинаковые названия документов/)).toBeVisible()
  expect(await snapshot()).toEqual(before)
  await document.getByRole('textbox').nth(1).fill('Non-conflicting first')
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await snapshot()
  expect(after.rows.find(row => row.joint === 'S3')?.psto_request).toBe('Occupied')
  expect(after.cycles[0].psto_request).toBe('Non-conflicting repeat')
  expect(after.rows.find(row => row.joint === 'S2')?.psto_request).toBe('Non-conflicting first')
})

test('returning to recently opened history shows rebuilt names with one refresh and no inactive refetch', async ({ page }) => {
  const data = await seed(true), requests: string[] = []
  page.on('request', request => {
    if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('listSystemDocumentHistory_')) requests.push(request.url())
  })
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заявка ПСТО', exact: true }).click()
  await expect(page.getByText(data.documents[0].title, { exact: true })).toBeVisible()
  const count = requests.length
  const dialog = await openRebuild(page, false)
  const customSection = dialog.locator('section').filter({ has: page.getByRole('heading', { name: 'Пользовательские названия', exact: true }) })
  const document = customSection.getByText(data.documents[0].title, { exact: true }).locator('xpath=../..').locator('..')
  await document.getByRole('button', { name: 'Пересобрать вручную', exact: true }).click()
  await document.getByRole('textbox').nth(0).fill('Cached history L1')
  await document.getByRole('textbox').nth(1).fill('Cached history L2')
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(requests).toHaveLength(count)
  await page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Документы', exact: true }).click()
  await page.getByRole('button', { name: 'Заявка ПСТО', exact: true }).click()
  await expect(page.getByText('Cached history L1', { exact: true })).toBeVisible()
  await expect(page.getByText('Cached history L2', { exact: true })).toBeVisible()
  await expect(page.getByText(data.documents[0].title, { exact: true })).toHaveCount(0)
  expect(requests).toHaveLength(count + 1)
})

test('a concurrently saved naming rule cannot mix old and new names within one rebuild', async ({ page }) => {
  await seed()
  const dialog = await openRebuild(page)
  const before = await snapshot()
  await withE2eDatabase(async db => {
    await db.query('begin')
    let committed = false
    try {
      await db.query(`select pg_advisory_xact_lock(hashtext('request-conclusion'))`)
      const pid = (await db.query('select pg_backend_pid() as pid')).rows[0].pid
      await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
      await expect.poll(() => withE2eDatabase(async observer => (await observer.query(
        `select count(*)::int as count from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid))`, [pid],
      )).rows[0].count)).toBe(1)
      const value = JSON.parse((await db.query(`select value from app_settings where key='request-conclusion'`)).rows[0].value)
      value.splitModes.pstoRequest = 'none'
      await db.query(`update app_settings set value=$1,updated_at=now() where key='request-conclusion'`, [JSON.stringify(value)])
      await db.query('commit')
      committed = true
    } finally {
      if (!committed) await db.query('rollback')
    }
  })
  await expect(dialog.getByText(/Настройки разделения изменились/)).toBeVisible()
  expect(await snapshot()).toEqual(before)
})

test('rebuild refreshes persisted dispatcher repair links without a full unrelated rebuild', async ({ page }) => {
  const data = await seed()
  // A stored chronology issue needs a link to the exact current document.
  // Renaming must not leave that correction pointing at the vanished name.
  await withE2eDatabase(db => db.query(`update weld_joints set weld_date='2026-09-07' where id=$1`, [data.ids[1]]))
  await markDispatcherTaskIndexDirty()
  await ensureDispatcherTaskIndexFresh()
  const readActions = () => withE2eDatabase(async db => (await db.query('select tasks from dispatcher_task_pages'))
    .rows.flatMap(row => JSON.parse(row.tasks)).filter(task => task.row?.id === data.ids[1])
    .flatMap(task => task.rootCauseActions ?? []).map(action => action.target.documentName).filter(Boolean))
  expect(await readActions()).toContain(data.documents[0].title)
  const before = await withE2eDatabase(async db => (await db.query('select source_revision from dispatcher_task_index_state where id=1')).rows[0])
  const dialog = await openRebuild(page)
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog).toBeHidden()
  const currentName = (await snapshot()).rows.find(row => row.id === data.ids[1])!.psto_request
  expect(currentName).not.toBe(data.documents[0].title)
  const dirty = await withE2eDatabase(async db => (await db.query('select full_rebuild,dirty_scopes from dispatcher_task_index_state where id=1')).rows[0])
  expect(dirty.full_rebuild).toBe(false)
  expect(JSON.parse(dirty.dirty_scopes)).toEqual(expect.arrayContaining(data.ids.map((_id, index) => ({
    projectTitle: project, subtitleCode: 'CYCLE', line: `CYCLE-L${index + 1}`,
  }))))
  expect(JSON.parse(dirty.dirty_scopes)).toHaveLength(2)
  await ensureDispatcherTaskIndexFresh()
  expect(await readActions()).toContain(currentName)
  expect(await readActions()).not.toContain(data.documents[0].title)
  const state = await withE2eDatabase(async db => (await db.query('select source_revision,computed_revision,full_rebuild from dispatcher_task_index_state where id=1')).rows[0])
  expect(state.source_revision).toBe(before.source_revision + 1)
  expect(state.computed_revision).toBe(state.source_revision)
  expect(state.full_rebuild).toBe(false)
})

test('pending rebuild permits reading; concurrent edit and second rebuild wait then reject their stale snapshots', async ({ page, context }) => {
  const data = await seed()
  const first = await openRebuild(page)
  const secondPage = await context.newPage()
  const second = await openRebuild(secondPage)
  const reader = await context.newPage()
  const before = await snapshot()
  const version = await withE2eDatabase(async db => (await db.query(
    'select xmin::text as version from weld_joints where id=$1', [data.ids[1]],
  )).rows[0].version as string)
  let edit: Promise<string> | undefined
  await withE2eDatabase(async gate => {
    await gate.query('begin')
    try {
      // Stop a real rebuild AFTER it has updated weld names but before its
      // document replacements commit. No application-only test hooks.
      await gate.query('select id from generated_documents where id=$1 for update', [data.documents[0].id])
      const gatePid = (await gate.query('select pg_backend_pid() as pid')).rows[0].pid
      await first.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
      const waiting = () => withE2eDatabase(async db => (await db.query(
        'select pid,query from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid))', [gatePid],
      )).rows)
      await expect.poll(async () => (await waiting()).length).toBe(1)
      const [rebuild] = await waiting()
      expect(rebuild.query).toContain('delete from "generated_documents"')
      const reportResponse = reader.waitForResponse(response => response.url().includes('/_serverFn/') &&
        rpcName(response.url()).startsWith('listWeldingJournalPage_'))
      await reader.goto('/journal')
      expect((await reportResponse).ok()).toBe(true)
      await expect(reader.locator('table tbody tr').first()).toBeVisible()
      expect(await snapshot()).toEqual(before)
      edit = updateWeldJoint({ data: { id: data.ids[1], expectedVersion: version,
        weldingJournalNote: 'Must not overwrite rebuilt documents',
      } }).then(() => 'unexpected success', error => String(error.message))
      await second.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
      await expect.poll(() => withE2eDatabase(async db => (await db.query(
        'select count(*)::int as n from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid))', [rebuild.pid],
      )).rows[0].n)).toBe(2)
      await expect(first.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled()
    } finally { await gate.query('rollback') }
  })
  await expect(first).toBeHidden()
  expect(await edit).toContain('уже изменен другим пользователем')
  await expect(second.getByText(/Системные документы или стыки изменились/)).toBeVisible()
  const after = await snapshot()
  expect(after.rows.map(facts)).toEqual(before.rows.map(facts))
  expect(after.cycles.map(facts)).toEqual(before.cycles.map(facts))
  expect(after.documents.filter(doc => JSON.parse(doc.source_metadata || '{}').sourceKind === 'pstoCycle')).toHaveLength(8)
  await second.getByRole('button', { name: 'Обновить предпросмотр', exact: true }).click()
  await expect(second.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeDisabled()
  await expect(second.getByRole('button', { name: 'Отмена', exact: true })).toBeEnabled()
  await second.getByRole('button', { name: 'Отмена', exact: true }).click()
  await secondPage.close()
  await reader.close()
})

test('late database failure rolls back names, cycles, deleted documents and reserved numbers; same preview can retry', async ({ page }) => {
  await seed()
  const dialog = await openRebuild(page)
  const before = await snapshot()
  await withE2eDatabase(db => db.query(`alter table generated_documents add constraint e2e_rebuild_late_failure
    check (not (row_count=1 and source_metadata like '%E2E cycle document rebuild%'))`))
  try {
    await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeEnabled()
    await expect(dialog.locator('.text-rose-700')).toBeVisible()
    expect(await snapshot()).toEqual(before)
  } finally {
    await withE2eDatabase(db => db.query('alter table generated_documents drop constraint e2e_rebuild_late_failure'))
  }
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await snapshot()
  expect(after.rows.map(facts)).toEqual(before.rows.map(facts))
  expect(after.cycles.map(facts)).toEqual(before.cycles.map(facts))
  expect(after.documents.filter(doc => JSON.parse(doc.source_metadata || '{}').sourceKind === 'pstoCycle')).toHaveLength(8)
})

test('lost successful rebuild response: stale retry cannot duplicate documents or numbering; refresh recovers', async ({ page }) => {
  await seed()
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const dialog = await openRebuild(page)
  const before = await snapshot()
  // The server commits normally, but the client never receives that successful
  // reply. A network timeout is not evidence that a mutation was rolled back.
  await page.route(url => rpcName(url.toString()).startsWith('applySystemDocumentRebuild_'), async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    await route.abort('timedout')
  }, { times: 1 })
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog.locator('.text-rose-700')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeEnabled()
  const committed = await snapshot()
  expect(committed.rows.map(facts)).toEqual(before.rows.map(facts))
  expect(committed.cycles.map(facts)).toEqual(before.cycles.map(facts))
  expect(committed.documents.filter(doc => JSON.parse(doc.source_metadata || '{}').sourceKind === 'pstoCycle')).toHaveLength(8)
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog.getByText(/Системные документы или стыки изменились/)).toBeVisible()
  expect(await snapshot()).toEqual(committed)
  const refreshed = page.waitForResponse(response => rpcName(response.url()).startsWith('previewSystemDocumentRebuild_'))
  await dialog.getByRole('button', { name: 'Обновить предпросмотр', exact: true }).click()
  expect((await refreshed).ok()).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Обновить предпросмотр', exact: true })).toBeEnabled()
  await expect(dialog.getByText('В выбранной области пока нет документов для пересборки.', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(calls.filter(name => name.startsWith('previewSystemDocumentRebuild_'))).toHaveLength(2)
  expect(calls.filter(name => name.startsWith('applySystemDocumentRebuild_'))).toHaveLength(2)
  expect(errors).toEqual([])
})
