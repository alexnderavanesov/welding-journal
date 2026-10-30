import { asE2eOwner } from '../with-owner-access'
import { expect, test, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { extendLnkRequest as raw_extendLnkRequest } from '../../src/server/weld-mutations'
import { getLnkWorkflowRequestSummary as raw_getLnkWorkflowRequestSummary } from '../../src/server/lnk-workflow-context'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E LNK extension after results'
const line = 'EXT-L1'
const requestName = 'EXT-REQUEST'
const requestDate = '2026-09-05'
let ids: Record<string, number>

test.beforeEach(async () => {
  ids = await withLineProgramFixture(async db => {
    const rows = (await db.query(`insert into weld_joints (
      project_title, subtitle_code, line, joint, weld_date, officiality, revision_actuality,
      material_group, connection_type, welding_method, d1, d2, t1, t2, wdi,
      stamp_1_k, stamp_1_k_fact, has_vik, has_rk, psto_required, final_status
    ) select $1,'EXT',$2,'F95'||n,'2026-09-01','действующий','актуальная',
      'M01','СШ','РД',159,159,6,6,6,'EXT-K','EXT-K','да','да','нет','ожидает заявку'
      from generate_series(1,6) n returning id,joint`, [project, line])).rows
    const byJoint = Object.fromEntries(rows.map(row => [row.joint, row.id]))
    await db.query(`update weld_joints set vik_request=$2,vik_request_date=$3,vik_result='годен',
      vik_conclusion='EXT-VIK-C',vik_conclusion_date='2026-09-06' where id=$1`, [byJoint.F951, requestName, requestDate])
    await db.query(`update weld_joints set rk_request=$2,rk_request_date=$3,rk_result='ремонт',
      rk_conclusion='EXT-RK-C',rk_conclusion_date='2026-09-06',final_status='не годен',lnk_defect_description='Старая дефектограмма'
      where id=$1`, [byJoint.F952, requestName, requestDate])
    await db.query("update weld_joints set weld_date='2026-09-10' where id=$1", [byJoint.F955])
    await db.query(`update weld_joints set vik_request='EXT-OTHER',vik_request_date=$2,vik_result='ожидает НК',final_status='ожидает НК'
      where id=$1`, [byJoint.F956, requestDate])
    return byJoint
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
})

async function state() {
  return withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    documents: (await db.query(`select d.*,array_agg(a.weld_joint_id order by a.weld_joint_id) as joints
      from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
      where exists (select 1 from generated_document_weld_joints x join weld_joints w on w.id=x.weld_joint_id
        where x.document_id=d.id and w.project_title=$1) group by d.id order by d.id`, [project])).rows,
  }))
}
async function openManager(page: Page) {
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
  await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование заявок ЛНК', exact: true }) })
  await manager.getByPlaceholder('Название, дата, стык или линия').fill(requestName)
  await manager.getByRole('button', { name: new RegExp(requestName) }).click()
  await expect(manager.getByRole('button', { name: 'Добавить позиции', exact: true })).toBeEnabled()
  return manager
}
async function chooseFreshPosition(page: Page) {
  const manager = await openManager(page)
  await manager.getByRole('button', { name: 'Добавить позиции', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Заявка ЛНК', exact: true }) })
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('F953')
  await dialog.getByRole('checkbox', { name: `Выбрать стык ${line} F953`, exact: true }).check()
  for (const method of ['ВИК', 'РК']) {
    const button = dialog.getByRole('button', { name: method, exact: true })
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
  }
  await expect(dialog.getByRole('button', { name: 'Добавить в заявку', exact: true })).toBeEnabled()
  return dialog
}
function data(targetIds: number[], methodKey: 'vikRequest' | 'rkRequest' = 'vikRequest') {
  return { requestName, requestDate, targets: targetIds.map(rowId => ({ rowId, methodKey })) }
}

test('оператор дополняет заявку с годным ВИК и ремонтом РК; отмена, старые факты и заключения сохранены', async ({ page }, info) => {
  const before = await state()
  let writes = 0
  page.on('request', request => { if (rpcName(request.url()).startsWith('extendLnkRequest_')) writes++ })
  let dialog = await chooseFreshPosition(page)
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(writes).toBe(0)
  expect(await state()).toEqual(before)

  dialog = await chooseFreshPosition(page)
  await page.screenshot({ path: info.outputPath('extend-completed-request.png') })
  await dialog.getByRole('button', { name: 'Добавить в заявку', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(writes).toBe(1)
  const after = await state()
  expect(after.rows.filter(row => row.id !== ids.F953)).toEqual(before.rows.filter(row => row.id !== ids.F953))
  expect(after.rows.find(row => row.id === ids.F953)).toMatchObject({
    vik_request: requestName, rk_request: requestName, vik_result: 'ожидает НК', rk_result: 'ожидает НК',
    vik_conclusion: null, vik_conclusion_date: null, rk_conclusion: null, rk_conclusion_date: null,
  })
  const conclusions = (snapshot: Awaited<ReturnType<typeof state>>) => snapshot.documents.filter(doc => doc.title.startsWith('EXT-') && doc.title.endsWith('-C'))
  expect(conclusions(before)).toHaveLength(2)
  expect(conclusions(after)).toEqual(conclusions(before))
  const requestBefore = before.documents.find(doc => doc.title === requestName)!
  expect(after.documents.find(doc => doc.id === requestBefore.id)?.joints).toEqual([ids.F951, ids.F952, ids.F953])
  const manager = await openManager(page)
  await expect(manager.getByText(`${line} · F953`, { exact: true })).toBeVisible()
  await manager.getByRole('button', { name: 'Дополнительные действия с заявкой' }).click()
  await expect(manager.getByRole('button', { name: 'Удалить выбранную заявку' })).toBeDisabled()
})

test('другая позиция того же стыка дополняется без изменения его старого результата', async () => {
  const before = (await state()).rows.find(row => row.id === ids.F951)
  await extendLnkRequest({ data: data([ids.F951], 'rkRequest') })
  const after = (await state()).rows.find(row => row.id === ids.F951)
  for (const key of ['vik_request', 'vik_request_date', 'vik_result', 'vik_conclusion', 'vik_conclusion_date']) {
    expect(after[key]).toEqual(before[key])
  }
  expect(after).toMatchObject({ rk_request: requestName, rk_result: 'ожидает НК', rk_conclusion: null })
})

test('сервер сохраняет проверки дат, другой заявки, собственного результата, повторов и атомарность', async () => {
  const before = await state()
  for (const [target, reason] of [[ids.F955, 'дата сварки позднее'], [ids.F956, 'другой заявке'], [ids.F951, 'уже входит']] as const) {
    await expect(extendLnkRequest({ data: data([ids.F953, target]) })).rejects.toThrow(reason)
    expect(await state()).toEqual(before)
  }
  await expect(extendLnkRequest({ data: data([ids.F953, ids.F953]) })).rejects.toThrow('повторный')
  await expect(extendLnkRequest({ data: { ...data([ids.F953]), requestDate: '2026-09-04' } })).rejects.toThrow('больше не существует')
  expect(await state()).toEqual(before)
  await withLineProgramFixture(db => db.query("update weld_joints set vik_result='годен',vik_conclusion='EXT-OWN' where id=$1", [ids.F954]))
  const withOwnResult = await state()
  await expect(extendLnkRequest({ data: data([ids.F953, ids.F954]) })).rejects.toThrow('уже есть результат')
  expect(await state()).toEqual(withOwnResult)
})

test('устаревший выбор оператора отклоняется сервером без частичного сохранения', async ({ page }) => {
  const dialog = await chooseFreshPosition(page)
  await withLineProgramFixture(db => db.query(`update weld_joints set rk_request='EXT-CONCURRENT',rk_request_date=$2,
    rk_result='ожидает НК' where id=$1`, [ids.F953, requestDate]))
  const beforeSave = await state()
  await dialog.getByRole('button', { name: 'Добавить в заявку', exact: true }).click()
  await expect(dialog.getByText(/Стык F953, РК: позиция уже относится к другой заявке/)).toBeVisible()
  await expect(dialog).toBeVisible()
  expect(await state()).toEqual(beforeSave)
})

test('одновременные добавления не теряются, повторный стык добавляется только один раз', async () => {
  await Promise.all([extendLnkRequest({ data: data([ids.F953]) }), extendLnkRequest({ data: data([ids.F954]) })])
  const snapshot = await state()
  expect(snapshot.documents.find(doc => doc.title === requestName)?.joints).toEqual([ids.F951, ids.F952, ids.F953, ids.F954])
  const attempts = await Promise.allSettled([
    extendLnkRequest({ data: data([ids.F953], 'rkRequest') }),
    extendLnkRequest({ data: data([ids.F953], 'rkRequest') }),
  ])
  expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
  const failure = attempts.find(attempt => attempt.status === 'rejected') as PromiseRejectedResult
  expect(failure.reason.message).toContain('уже входит')
  const summary = await getLnkWorkflowRequestSummary({ search: requestName })
  expect(summary.requestOptions.find(option => option.name === requestName)).toMatchObject({
    disabledReason: null, rowCount: 4, positionCount: 5,
  })
})

const extendLnkRequest = asE2eOwner(raw_extendLnkRequest, 'lnk.edit')
const getLnkWorkflowRequestSummary = asE2eOwner(raw_getLnkWorkflowRequestSummary, 'lnk.view')
