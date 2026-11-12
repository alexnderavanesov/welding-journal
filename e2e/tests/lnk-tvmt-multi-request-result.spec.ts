import { expect, test, type Page } from '@playwright/test'
import { eq, inArray } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { pstoRepeatCycles, preHeatTreatmentControls, weldJoints } from '../../src/db/schema'
import { buildSystemDocumentSummaries } from '../../src/lib/system-document-types'
import { buildPstoRepeatSystemDocumentRow } from '../../src/lib/system-document-virtual-row'
import type { WeldRow } from '../../src/lib/dispatcher-types'
import type { PstoWorkflowAvailability } from '../../src/server/weld-contracts'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { prepareDocumentCreationIndex } from '../../src/server/document-name-conflicts'
import { syncSystemDocumentsForWeldChangesInTransaction, upsertSourcedSystemDocumentsInTransaction } from '../../src/server/system-document-index'
import { syncPreHeatTreatmentDocumentsInTransaction } from '../../src/server/pre-heat-treatment-system-documents'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, rpcName } from '../rpc'

const project = 'E2E LNK TVMT mixed requests'
type Kind = 'primary' | 'pre' | 'tvmt' | 'tvmt-repeat'
const methods = [{ code: 'ВИК', field: 'vik' }, { code: 'РК', field: 'rk' }, { code: 'УЗК', field: 'uzk' }, { code: 'ПВК', field: 'pvk' }] as const
let originalSettings: { value: string; updated_at: Date } | undefined

test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    originalSettings = (await db.query("select value,updated_at from app_settings where key='request-conclusion'")).rows[0]
    await db.query("insert into app_settings(key,value) values('request-conclusion',$1) on conflict(key) do update set value=excluded.value", [JSON.stringify(REQUEST_CONCLUSION_DEFAULT_SETTINGS)])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => originalSettings
    ? db.query("update app_settings set value=$1,updated_at=$2 where key='request-conclusion'", [originalSettings.value, originalSettings.updated_at])
    : db.query("delete from app_settings where key='request-conclusion'"))
})

async function seed(kind: Kind, method: typeof methods[number]) {
  const ids = await withLineProgramFixture(async db => {
    const ids = (await db.query(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,has_rk,has_uzk,has_pvk,psto_required,pre_heat_treatment_required,d1)
      select $1,'MIXED','RESULT-L'||n,case when n<3 then 'F8830'||n else 'F8840'||n end,
        '2026-09-01'::date,'С17','действующий','актуальная','да',$2,$3,$4,$5,$5='да',108
      from generate_series(1,3) n returning id`, [project, method.field === 'rk' ? 'да' : null, method.field === 'uzk' ? 'да' : null, method.field === 'pvk' ? 'да' : null, kind === 'primary' ? 'нет' : 'да'])).rows.map(row => row.id as number)
    for (let n = 0; n < ids.length; n++) {
      const name = n === 2 ? 'Mixed request 3' : 'Mixed shared name'
      const date = n === 0 ? '2026-09-04' : '2026-09-06'
      if (kind === 'primary') {
        if (method.field !== 'vik') await db.query(`update weld_joints set vik_request='Previous VIK',vik_request_date='2026-09-02',vik_result='годен',vik_conclusion='Previous VIK conclusion',vik_conclusion_date='2026-09-03' where id=$1`, [ids[n]])
        // Field names come from the fixed method table above, never user input.
        await db.query(`update weld_joints set ${method.field}_request=$2,${method.field}_request_date=$3,${method.field}_result='ожидает НК' where id=$1`, [ids[n], name, date])
      } else {
        if (kind !== 'pre' || method.field !== 'vik') await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date) values($1,'ВИК','Previous pre VIK','2026-09-02','годен','Previous pre VIK conclusion','2026-09-03')`, [ids[n]])
        if (kind === 'pre') await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result) values($1,$2,$3,$4,'ожидает НК')`, [ids[n], method.code, name, date])
        else {
          await db.query(`update weld_joints set psto_request='PSTO request',psto_request_date='2026-09-03',psto_date='2026-09-04',psto_result='проведено',heat_treatment_diagram='PSTO diagram',tvmt_request=$2,tvmt_request_date=$3,tvmt_result='ожидает НК' where id=$1`, [ids[n], name, date])
          if (kind === 'tvmt-repeat' && n === 1) {
            await db.query(`update weld_joints set tvmt_request='Previous TVMT',tvmt_request_date='2026-09-04',tvmt_result='не годен',tvmt_conclusion='Previous TVMT conclusion',tvmt_conclusion_date='2026-09-04' where id=$1`, [ids[n]])
            await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,psto_result,heat_treatment_diagram,tvmt_request,tvmt_request_date,tvmt_result) values($1,2,'Repeat PSTO request','2026-09-05','2026-09-06','проведено','Repeat PSTO diagram',$2,$3,'ожидает НК')`, [ids[n], name, date])
          }
        }
      }
    }
    return ids
  })
  const tvmt = kind.startsWith('tvmt')
  await prepareDocumentCreationIndex({ settingId: tvmt ? 'tvmtConclusion' : `lnkConclusion${method.field[0]!.toUpperCase()}${method.field.slice(1)}` as 'lnkConclusionVik', mode: 'none' })
  const rows = await requireDb().select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
  await requireDb().transaction(async tx => {
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    const controls = await tx.select().from(preHeatTreatmentControls).where(inArray(preHeatTreatmentControls.weldJointId, ids))
    await syncPreHeatTreatmentDocumentsInTransaction(tx, rows as WeldRow[], controls)
  })
  if (kind === 'tvmt-repeat') {
    const [cycle] = await requireDb().select().from(pstoRepeatCycles).where(eq(pstoRepeatCycles.weldJointId, ids[1]))
    const virtual = buildPstoRepeatSystemDocumentRow(rows.find(row => row.id === ids[1]) as WeldRow, cycle)
    await requireDb().transaction(tx => upsertSourcedSystemDocumentsInTransaction({ tx, documents: (['pstoRequest', 'pstoConclusion', 'lnkRequest'] as const).flatMap(type => buildSystemDocumentSummaries([virtual], type).map(summary => ({ summary: { ...summary, sourceKind: 'pstoCycle' as const, cycleSequences: [2] }, sourcePositions: [{ kind: 'pstoCycle' as const, weldJointId: ids[1], relationId: cycle.id, sequence: 2, ...(summary.methodCode ? { methodCode: summary.methodCode } : {}) }] }))) }))
  }
  await ensureDispatcherTaskIndexFresh()
  return ids
}

async function snapshot() {
  return withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    controls: (await db.query('select c.* from pre_heat_treatment_controls c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by c.id', [project])).rows,
    cycles: (await db.query('select c.* from psto_repeat_cycles c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by c.id', [project])).rows,
    documents: (await db.query(`select distinct d.* from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 order by d.id`, [project])).rows,
    links: (await db.query(`select a.document_id,a.weld_joint_id from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 order by a.document_id,a.weld_joint_id`, [project])).rows,
    counters: (await db.query("select * from app_settings where key like 'system-document-next-number:%' order by key")).rows,
  }))
}

const scenarios = [ ...(['primary', 'pre'] as const).flatMap(kind => methods.map(method => ({ kind, method }))), ...(['tvmt', 'tvmt-repeat'] as const).map(kind => ({ kind, method: methods[0] })) ]
function nextAvailability(page: Page) {
  return page.waitForResponse(response => response.url().includes('/_serverFn/') &&
    /^getPstoWorkflowAvailability(?:_|$)/.test(rpcName(response.url()))).then(async response => {
    expect(response.ok()).toBe(true)
    const payload = await deserializeRpcResponse(await response.text()) as { result: PstoWorkflowAvailability; error?: unknown }
    expect(payload.error).toBeUndefined()
    return payload.result
  })
}
for (const { kind, method } of scenarios) test(`${kind} ${method.code}: one conclusion preserves separate requests and history`, async ({ page }, info) => {
  const ids = await seed(kind, method)
  const tvmt = kind.startsWith('tvmt')
  const pre = kind === 'pre'
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(tvmt ? '/psto' : '/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F8830')
  await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
  await page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox').check()
  await expect(page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox')).toBeChecked()
  const initialAvailability = kind === 'tvmt-repeat' ? nextAvailability(page) : undefined
  let availabilityReadAt = 0
  await page.locator('header').getByRole('button', { name: tvmt ? 'ТВМТ' : 'Результат', exact: true }).click()
  if (initialAvailability) {
    // Every fixture current cycle awaits TVMT; the old failure is superseded
    // by repeat #2. The setup joint lacks its prerequisite pre-TO VIK result,
    // so it cannot independently make the global request flag true.
    expect((await initialAvailability).requestCandidates).toBe(false)
    availabilityReadAt = performance.now()
    await page.keyboard.press('Escape')
    await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
    await expect(page.locator('[data-workflow-menu]').getByRole('button', { name: 'Новая заявка', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.locator('header').getByRole('button', { name: 'ТВМТ', exact: true }).click()
  }
  await page.getByRole('button', { name: tvmt ? 'Внести результаты ТВМТ' : 'Внести результаты', exact: true }).click()
  const title = tvmt ? 'Внесение результатов ТВМТ' : pre ? 'Внесение результатов ЛНК до ТО' : 'Внесение результатов ЛНК'
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  if (!tvmt) {
    const controlMethod = dialog.getByRole('combobox', { name: 'Метод контроля', exact: true })
    const value = pre ? method.code : `${method.field}Request`
    // Pre-TO infers the pending method after loading the selected joints.
    // A read-then-selectOption race can dispatch a synthetic change for the
    // already selected method, unlike the actual Select popup.
    if (pre) await expect(controlMethod).toHaveValue(value)
    else {
      await controlMethod.click()
      await page.getByRole('listbox').getByRole('option', { name: method.code, exact: true }).click()
      await expect(controlMethod).toHaveValue(value)
    }
  }
  const count = (n: number) => dialog.getByRole('button', { name: `Выбрано: ${n}`, exact: true })
  const filter = dialog.getByRole('combobox', { name: `Фильтр по заявке ${tvmt ? 'ТВМТ' : pre ? 'ЛНК до ТО' : 'ЛНК'}`, exact: true })
  const row = (n: number) => dialog.getByRole('checkbox', { name: `Выбрать стык RESULT-L${n} F88${n < 3 ? 3 : 4}0${n}`, exact: true })
  await expect(count(2)).toBeVisible()
  await expect(row(1)).toBeChecked()
  await expect(row(2)).toBeChecked()
  await expect(dialog.getByText('Заявки: 2 · Выбрано: 2', { exact: true })).toBeVisible()
  if (tvmt) await dialog.getByRole('combobox', { name: 'Результат для выбранных' }).selectOption('годен')
  else await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
  if (tvmt) await row(2).locator('..').getByRole('button', { name: 'не годен', exact: true }).click()

  await filter.click()
  await expect(filter).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(filter).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog).toBeVisible()
  await expect(count(2)).toBeVisible()
  await expect(row(1)).toBeChecked()
  await expect(row(2)).toBeChecked()
  // Reopening by clicking the still-focused field must work after Escape.
  await filter.click()
  await dialog.getByRole('option', { name: /Mixed request 3/ }).click()
  await expect(row(3)).toBeVisible()
  await expect(count(2)).toBeVisible()
  await row(3).check()
  await expect(count(3)).toBeVisible()
  await row(3).uncheck()
  await count(2).click()
  await expect(row(1)).toBeChecked()
  await expect(row(2)).toBeChecked()
  // A selected row outside the request filter must remain operable.
  await row(1).click()
  await expect(count(1)).toBeVisible()
  await dialog.getByRole('button', { name: 'Сбросить выбранную заявку' }).click()
  await dialog.getByRole('button', { name: 'Все стыки', exact: true }).click()
  await row(1).check()
  if (!tvmt) await row(1).locator('..').getByRole('button', { name: 'годен', exact: true }).click()
  await expect(count(2)).toBeVisible()
  const save = dialog.getByRole('button', { name: pre ? 'Сохранить результат до ТО' : 'Сохранить результат', exact: true })
  const date = dialog.getByLabel(tvmt ? 'Дата ТВМТ' : 'Дата контроля', { exact: true })
  await date.fill('2026-09-05')
  await expect(save).toBeDisabled()
  await date.fill('2026-09-09')
  await dialog.getByRole('combobox', { name: 'Разделение документов', exact: true }).selectOption('none')
  await dialog.getByRole('tab', { name: /^Заключения и имена/ }).click()
  const input = dialog.getByRole('textbox', { name: /^Название заключения/ })
  await expect(input).toHaveCount(1)
  const name = await input.inputValue()
  expect(name).not.toBe('')
  await dialog.screenshot({ path: info.outputPath('mixed-request-conclusion.png') })
  const before = await snapshot()
  const sentPromise = page.waitForRequest(request => request.method() === 'POST' && /^(savePstoRepeatWorkflow_|savePreHeatTreatmentLnkWorkflow_|updateWeldJoints_)/.test(rpcName(request.url())))
  await expect(save).toBeEnabled()
  await save.click()
  const sent = await sentPromise
  await expect(dialog).toBeHidden()
  const after = await snapshot()
  const created = after.documents.filter(document => document.title === name)
  expect(created).toHaveLength(1)
  expect(created[0].row_count).toBe(2)
  expect(after.links.filter(link => link.document_id === created[0].id).map(link => link.weld_joint_id)).toEqual(ids.slice(0, 2))
  const target = (state: typeof after, n: number) => pre ? state.controls.find(c => c.weld_joint_id === ids[n] && c.method === method.code)! : kind === 'tvmt-repeat' && n === 1 ? state.cycles[0] : state.rows[n]
  const prefix = pre ? '' : tvmt ? 'tvmt_' : `${method.field}_`
  for (const n of [0, 1]) {
    expect(target(after, n)[`${prefix}${pre ? 'conclusion_name' : 'conclusion'}`]).toBe(name)
    expect(target(after, n)[`${prefix}result`]).toBe(tvmt && n === 1 ? 'не годен' : 'годен')
    expect(target(after, n)[`${prefix}${pre ? 'request_name' : 'request'}`]).toBe(target(before, n)[`${prefix}${pre ? 'request_name' : 'request'}`])
    expect(target(after, n)[`${prefix}request_date`]).toEqual(target(before, n)[`${prefix}request_date`])
  }
  expect(after.rows[2]).toEqual(before.rows[2])
  if (kind === 'tvmt-repeat') {
    const primaryFacts = ({ updated_at: _updated, psto_created_at: _created, psto_updated_at: _pstoUpdated, final_status: _status, ...facts }: Record<string, unknown>) => facts
    expect(primaryFacts(after.rows[1])).toEqual(primaryFacts(before.rows[1]))
    expect(JSON.parse(created[0].source_metadata).sourcePositions).toEqual([
      { kind: 'pstoCycle', weldJointId: ids[0], relationId: ids[0], sequence: 1, methodCode: 'ТВМТ' },
      { kind: 'pstoCycle', weldJointId: ids[1], relationId: before.cycles[0].id, sequence: 2, methodCode: 'ТВМТ' },
    ])
  }
  if (pre) expect(JSON.parse(created[0].source_metadata).sourcePositions).toEqual(ids.slice(0, 2).map(id => ({ kind: 'beforeHeatTreatment', weldJointId: id, relationId: before.controls.find(c => c.weld_joint_id === id && c.method === method.code)!.id, methodCode: method.code })))
  const oldIds = new Set(before.documents.map(document => document.id))
  const content = ({ updated_at: _timestamp, ...document }: Record<string, unknown>) => document
  expect(after.documents.filter(document => oldIds.has(document.id)).map(content)).toEqual(before.documents.map(content))
  expect(after.links.filter(link => oldIds.has(link.document_id))).toEqual(before.links)
  expect(after.controls.filter(c => !pre || c.method !== method.code || c.weld_joint_id === ids[2])).toEqual(before.controls.filter(c => !pre || c.method !== method.code || c.weld_joint_id === ids[2]))
  const retry = await page.request.post(sent.url(), { data: sent.postData()!, headers: { 'content-type': sent.headers()['content-type'], origin: new URL(sent.url()).origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true' } })
  const rejected = await deserializeRpcResponse(await retry.text()) as { error?: Error }
  // Primary LNK validates the already-reserved name before row versions; both
  // guards must reject an exact transport retry without any stored changes.
  expect(String(rejected.error)).toMatch(/устарел|уже изменен|уже внесен|уже проведен|системное имя уже занято/i)
  expect(await snapshot()).toEqual(after)
  if (kind === 'tvmt-repeat') {
    // The newly saved failed TVMT on repeat #2 now permits the next PSTO
    // request. Reopen the already cached menu without reloading the page.
    expect(performance.now() - availabilityReadAt, 'Availability must not expire naturally during this check').toBeLessThan(60000)
    const refreshedAvailability = nextAvailability(page)
    await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
    expect((await refreshedAvailability).requestCandidates).toBe(true)
    await expect(page.locator('[data-workflow-menu]').getByRole('button', { name: 'Новая заявка', exact: true })).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('[data-workflow-menu]').getByRole('button', { name: 'Новая заявка', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-workflow-menu]')).toHaveCount(0)
  }
  expect(errors).toEqual([])
})
