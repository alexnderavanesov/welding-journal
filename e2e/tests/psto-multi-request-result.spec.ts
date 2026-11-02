import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { pstoRow, revealPstoColumn } from './psto-grid-helpers'
import { requireDb } from '../../src/db'
import { pstoRepeatCycles, weldJoints } from '../../src/db/schema'
import { buildSystemDocumentSummaries } from '../../src/lib/system-document-types'
import { buildPstoRepeatSystemDocumentRow } from '../../src/lib/system-document-virtual-row'
import type { WeldRow } from '../../src/lib/dispatcher-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { prepareDocumentCreationIndex } from '../../src/server/document-name-conflicts'
import { syncSystemDocumentsForWeldChangesInTransaction, upsertSourcedSystemDocumentsInTransaction } from '../../src/server/system-document-index'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'

const project = 'E2E PSTO mixed requests'
let originalSettings: { value: string; updated_at: Date } | undefined

test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    originalSettings = (await db.query("select value,updated_at from app_settings where key='request-conclusion'")).rows[0]
    await db.query("insert into app_settings(key,value) values('request-conclusion',$1) on conflict(key) do update set value=excluded.value",
      [JSON.stringify(REQUEST_CONCLUSION_DEFAULT_SETTINGS)])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => originalSettings
    ? db.query("update app_settings set value=$1,updated_at=$2 where key='request-conclusion'", [originalSettings.value, originalSettings.updated_at])
    : db.query("delete from app_settings where key='request-conclusion'"))
})

async function seed(repeat: boolean) {
  const ids = await withLineProgramFixture(async db => {
    const rows = (await db.query(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,psto_required,psto_request,psto_request_date)
      select $1,'MIXED','MIXED-L'||n,case when n<3 then 'F8810'||n else 'F8820'||n end,
        case when n=1 then '2026-09-01'::date else '2026-09-02'::date end,'С17','действующий','актуальная','да','да',
        'Mixed request '||n,case when n=1 then '2026-09-04'::date else '2026-09-06'::date end
      from generate_series(1,3) n returning id`, [project])).rows.map(row => row.id as number)
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'ВИК','Mixed pre request','2026-09-03','годен','Mixed pre conclusion','2026-09-03' from weld_joints where project_title=$1`, [project])
    if (repeat) {
      await db.query(`update weld_joints set psto_request='Previous request',psto_request_date='2026-09-04',psto_date='2026-09-05',
        heat_treatment_diagram='Previous diagram',psto_result='проведено',tvmt_request='Previous TVMT request',tvmt_request_date='2026-09-05',
        tvmt_result='не годен',tvmt_conclusion='Previous TVMT conclusion',tvmt_conclusion_date='2026-09-06' where id=$1`, [rows[1]])
      // Same name on different dates is still two different requests.
      await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_note)
        values($1,2,'Mixed request 1','2026-09-07','Keep repeat history')`, [rows[1]])
    }
    return rows
  })
  await prepareDocumentCreationIndex({ settingId: 'pstoConclusion', mode: 'none' })
  const rows = await requireDb().select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
  await requireDb().transaction(tx => syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map()))
  if (repeat) {
    const [cycle] = await requireDb().select().from(pstoRepeatCycles).where(eq(pstoRepeatCycles.weldJointId, ids[1]))
    const [summary] = buildSystemDocumentSummaries([
      buildPstoRepeatSystemDocumentRow(rows.find(row => row.id === ids[1]) as WeldRow, cycle),
    ], 'pstoRequest')
    await requireDb().transaction(tx => upsertSourcedSystemDocumentsInTransaction({ tx, documents: [{
      summary: { ...summary, sourceKind: 'pstoCycle', cycleSequences: [2] },
      sourcePositions: [{ kind: 'pstoCycle', weldJointId: ids[1], relationId: cycle.id, sequence: 2 }],
    }] }))
  }
  await ensureDispatcherTaskIndexFresh()
  return ids
}

async function snapshot() {
  return withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    cycles: (await db.query('select c.* from psto_repeat_cycles c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by c.id', [project])).rows,
    documents: (await db.query(`select distinct d.* from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
      join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 order by d.id`, [project])).rows,
    links: (await db.query(`select a.document_id,a.weld_joint_id from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
      where w.project_title=$1 order by a.document_id,a.weld_joint_id`, [project])).rows,
    counters: (await db.query("select * from app_settings where key like 'system-document-next-number:%' order by key")).rows,
  }))
}

for (const repeat of [false, true]) test(`one diagram from multiple requests/lines, ${repeat ? 'primary + repeat' : 'two primary cycles'}`, async ({ page }, info) => {
  const ids = await seed(repeat)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/psto')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F8810')
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  await page.locator('[data-psto-grid] .ag-header-cell').getByRole('checkbox').check()
  await page.getByRole('button', { name: 'F88101', exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Результаты и заключения', exact: true }).hover()
  await page.getByRole('button', { name: 'Внести результат · ПСТО', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Внесение результатов ПСТО', exact: true }) })
  const count = (n: number) => dialog.getByRole('button', { name: `Выбрано: ${n}`, exact: true })
  const filter = dialog.getByRole('combobox', { name: 'Фильтр по заявке ПСТО', exact: true })
  const row = (n: number) => dialog.getByRole('checkbox', { name: `Выбрать стык MIXED-L${n} F88${n < 3 ? 1 : 2}0${n}`, exact: true })
  await expect(count(2)).toBeVisible()
  await expect(dialog.getByText('Заявки: 2 · Выбрано: 2', { exact: true })).toBeVisible()
  await expect(row(1)).toBeChecked()
  await expect(row(2)).toBeChecked()
  await expect(filter).toHaveValue('')
  await dialog.getByRole('button', { name: 'Заявки: 2', exact: true }).click()
  await dialog.screenshot({ path: 'outputs/document-workflow-help-sources.png' })
  await dialog.getByRole('button', { name: /Mixed request 1.*1 ст\./ }).first().click()
  await expect(dialog.getByRole('checkbox', { name: /^Выбрать стык MIXED-/ })).toHaveCount(1)
  await expect(count(2)).toBeVisible()
  await dialog.getByRole('button', { name: 'Показать все выбранные', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: /^Выбрать стык MIXED-/ })).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Все стыки', exact: true }).click()
  await dialog.getByRole('button', { name: 'Заявки: 2', exact: true }).click()

  await filter.click()
  await dialog.getByRole('option', { name: /Mixed request 3/ }).click()
  await expect(row(3)).toBeVisible()
  await expect(count(2)).toBeVisible()
  await expect(filter).toHaveAttribute('aria-expanded', 'false')
  await dialog.getByRole('button', { name: 'Выбрать доступные', exact: true }).click()
  await expect(count(3)).toBeVisible()
  await dialog.getByRole('button', { name: 'Снять доступные', exact: true }).click()
  await expect(count(2)).toBeVisible()
  await dialog.getByRole('button', { name: 'Сбросить выбранную заявку' }).click()
  await expect(filter).toHaveAttribute('aria-expanded', 'false')
  await filter.click()
  await dialog.getByRole('option', { name: 'Все заявки', exact: true }).click()
  await expect(filter).toHaveAttribute('aria-expanded', 'false')
  await count(2).click()
  await expect(row(1)).toBeChecked()
  await expect(row(2)).toBeChecked()
  await expect(row(3)).toHaveCount(0)
  await dialog.getByLabel('Дата ПСТО', { exact: true }).fill('2026-09-05')
  await expect(dialog.getByRole('button', { name: 'Сохранить результат', exact: true })).toBeDisabled()
  await dialog.getByLabel('Дата ПСТО', { exact: true }).fill('2026-09-09')
  await dialog.getByRole('combobox', { name: 'Разделение документов', exact: true }).selectOption('none')
  await dialog.getByRole('tab', { name: /^Диаграммы и имена/ }).click()
  const diagramName = dialog.getByRole('textbox', { name: /^Название диаграммы ПСТО:/ })
  await expect(diagramName).toBeVisible()
  const name = await diagramName.inputValue()
  expect(name).not.toBe('')
  await dialog.screenshot({ path: info.outputPath('mixed-request-diagram.png') })
  const before = await snapshot()
  const savedRequest = page.waitForRequest(request => rpcName(request.url()).startsWith('savePstoRepeatWorkflow_'))
  await dialog.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  const sent = await savedRequest
  expect((deserializeRpcPayload(sent.postData()!) as { data: { groups: unknown[] } }).data.groups).toEqual([
    expect.objectContaining({ rowIds: ids.slice(0, 2), name }),
  ])
  await expect(dialog).toBeHidden()
  const after = await snapshot()
  const audit = await withE2eDatabase(async db => (await db.query(`select entity,changes from audit_changes where operation_id=(
    select operation_id from audit_changes where joint_id=$1 and changes ? 'pstoDate' order by id desc limit 1)`, [ids[0]])).rows)
  const cycleChanges = audit.filter(row => ['weld_joints', 'psto_repeat_cycles'].includes(row.entity) && row.changes.pstoDate)
  expect(cycleChanges).toHaveLength(2)
  for (const row of cycleChanges) {
    expect(row.changes.pstoDate.origin).toBe('user')
    expect(row.changes.pstoResult.origin).toBe('automatic')
    expect(row.changes.heatTreatmentDiagram.origin).toBe('automatic')
  }
  expect(audit.some(row => row.entity === 'generated_documents' && row.changes.title?.origin === 'automatic')).toBe(true)
  const created = after.documents.filter(document => document.type === 'system:pstoConclusion' && document.title === name)
  expect(created).toHaveLength(1)
  expect(created[0].row_count).toBe(2)
  expect(after.links.filter(link => link.document_id === created[0].id).map(link => link.weld_joint_id)).toEqual(ids.slice(0, 2))
  expect(JSON.parse(created[0].source_metadata).sourcePositions).toEqual([
    { kind: 'pstoCycle', weldJointId: ids[0], relationId: ids[0], sequence: 1 },
    { kind: 'pstoCycle', weldJointId: ids[1], relationId: repeat ? before.cycles[0].id : ids[1], sequence: repeat ? 2 : 1 },
  ])
  expect(after.rows.map(row => [row.psto_request, row.psto_request_date, row.weld_date])).toEqual(before.rows.map(row => [row.psto_request, row.psto_request_date, row.weld_date]))
  expect(after.rows[0]).toMatchObject({ heat_treatment_diagram: name, psto_result: 'проведено' })
  if (repeat) {
    // A repeat result updates the joint's service timestamps and derived
    // status, but must preserve every primary-cycle document and fact.
    const primaryFacts = ({ updated_at: _updated, psto_created_at: _created, psto_updated_at: _pstoUpdated, final_status: _status, ...facts }: Record<string, unknown>) => facts
    expect(primaryFacts(after.rows[1])).toEqual(primaryFacts(before.rows[1]))
    expect(after.cycles[0]).toMatchObject({ psto_request: before.cycles[0].psto_request, psto_request_date: before.cycles[0].psto_request_date, psto_note: 'Keep repeat history', heat_treatment_diagram: name, psto_result: 'проведено' })
  } else expect(after.rows[1]).toMatchObject({ heat_treatment_diagram: name, psto_result: 'проведено' })
  expect(after.rows[2]).toEqual(before.rows[2])
  const content = ({ updated_at: _timestamp, ...document }: Record<string, unknown>) => document
  const oldIds = new Set(before.documents.map(document => document.id))
  expect(after.documents.filter(document => oldIds.has(document.id)).map(content)).toEqual(before.documents.map(content))
  expect(after.links.filter(link => oldIds.has(link.document_id))).toEqual(before.links)
  // A transport retry must not reapply a result, consume another number, or
  // change the old requests/diagrams, including a repeat's primary history.
  const retry = await page.request.post(sent.url(), { data: sent.postData()!, headers: { 'content-type': sent.headers()['content-type'], origin: new URL(sent.url()).origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true' } })
  const rejected = await deserializeRpcResponse(await retry.text()) as { error?: Error }
  expect(String(rejected.error)).toMatch(/устарел|уже изменен|уже внесен|уже проведен/i)
  expect(await snapshot()).toEqual(after)
  // Verify the post-save refresh before reloading. Reloading during that read
  // can make WebKit report its native cancelled-fetch diagnostic as pageerror.
  await revealPstoColumn(page, 'heatTreatmentDiagram')
  await expect(pstoRow(page, 'F88101').getByText(name, { exact: true })).toBeVisible()
  await expect(pstoRow(page, 'F88102').getByText(name, { exact: true })).toBeVisible()
  await page.reload()
  await revealPstoColumn(page, 'heatTreatmentDiagram')
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
  await revealPstoColumn(page, 'jointNextAction')
  for (const n of [1, 2]) {
    await expect(pstoRow(page, `F8810${n}`).getByRole('button', {
      name: `Выполнить: Создать заявку ТВМТ · цикл ${repeat && n === 2 ? 2 : 1}`, exact: true,
    })).toBeEnabled()
  }
  expect(errors).toEqual([])
})

test('mixed-request server validation is atomic for dates and stale clients', async ({ page }) => {
  const ids = await seed(true)
  const observed = page.waitForRequest(request => request.url().includes('/_serverFn/'))
  await page.goto('/psto')
  const url = siblingRpcUrl((await observed).url(), 'savePstoRepeatWorkflow_createServerFn_handler')
  const expectedVersions = await withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids.slice(0, 2)])).rows)
  const data = { action: 'pstoResult', date: '2026-09-09', groups: [{ rowIds: ids.slice(0, 2), name: 'Mixed manual diagram', useSystemName: false }], expectedVersions,
    documentGrouping: { settingId: 'pstoConclusion', mode: 'none' } }
  const call = async (input: unknown) => {
    const response = await page.request.post(url, { data: await serializeRpcData(input), headers: { 'content-type': 'application/json', origin: new URL(url).origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true' } })
    return await deserializeRpcResponse(await response.text()) as { result?: unknown; error?: Error }
  }
  const before = await snapshot()
  const invalidDate = await call({ ...data, date: '2026-09-05' })
  expect(String(invalidDate.error)).toMatch(/дат|раньше|позже/i)
  expect(await snapshot()).toEqual(before)
  const stale = await call({ ...data, expectedVersions: expectedVersions.map(item => ({ ...item, version: '0' })) })
  expect(String(stale.error)).toMatch(/устарел|уже изменен/i)
  expect(await snapshot()).toEqual(before)
  const success = await call(data)
  expect(success.error).toBeUndefined()
  expect(success.result).toHaveLength(2)
  const after = await snapshot()
  expect(after.documents.filter(document => document.title === 'Mixed manual diagram')).toHaveLength(1)
  expect(after.rows[0].heat_treatment_diagram).toBe('Mixed manual diagram')
  expect(after.cycles[0].heat_treatment_diagram).toBe('Mixed manual diagram')
  const freshVersions = await withE2eDatabase(async db => (await db.query(
    'select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids.slice(0, 2)],
  )).rows)
  const alreadyCompleted = await call({ ...data, expectedVersions: freshVersions, groups: [{ ...data.groups[0], name: 'Unexpected replacement' }] })
  expect(String(alreadyCompleted.error)).toContain('действие не соответствует текущему циклу')
  expect(await snapshot()).toEqual(after)
})
