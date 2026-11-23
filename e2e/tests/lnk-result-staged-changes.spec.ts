import { asE2eOwner } from '../with-owner-access'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { inArray } from 'drizzle-orm'
import { requireDb } from '@/db'
import { preHeatTreatmentControls, weldJoints } from '@/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { updateWeldJoints as raw_updateWeldJoints } from '@/server/weld-mutations'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { lnkResultConfirmation, confirmLnkResultChanges } from '../lnk-result-confirmation'
import { rpcName, serializeRpcData } from '../rpc'

const project = 'E2E staged LNK corrections'
const line = 'STAGED-LNK'
const title = 'STAGED-SHARED-VIK'
const signers = { first: { id: 99881, name: 'Сохранённый специалист', certificate: 'УД-99881' }, second: null }
type Stage = 'primary' | 'beforeHeatTreatment'
let settings: { key: string; value: string; updated_at: Date }[] = []

test.beforeEach(async () => withE2eDatabase(async db => {
  settings = (await db.query("select key,value,updated_at from app_settings where key in ('data-list','control-processes')")).rows
  for (const [key, value] of [
    ['data-list', { weldingTypes: ['РД'], connectionTypes: ['С17'], materialGroups: ['M01'] }],
    ['control-processes', { preHeatTreatmentMode: 'allPsto' }],
  ] as const) await db.query(`insert into app_settings(key,value) values ($1,$2)
    on conflict(key) do update set value=excluded.value,updated_at=now()`, [key, JSON.stringify(value)])
}))

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query("delete from app_settings where key in ('data-list','control-processes')")
    for (const row of settings) await db.query('insert into app_settings(key,value,updated_at) values ($1,$2,$3)', [row.key, row.value, row.updated_at])
  })
})

async function seed(stage: Stage) {
  const ids = await withE2eDatabase(async db => {
    const program = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'STAGED',$2,'II','A',10,0) returning id`, [project, line])).rows[0]
    const rows = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      connection_type,material_group,welding_method,officiality,revision_actuality,d1,d2,t1,t2,wdi,has_vik,psto_required,pre_heat_treatment_required,final_status)
      select $1,$2,'STAGED',$3,'F98'||n,'2026-09-01','С17','M01','РД','действующий','актуальная',108,108,4,4,0.42,'да',$4,$4::text='да',
        case when n=1 then 'не годен' when $4::text='да' then 'ожидает заявку' else 'годен' end
      from generate_series(1,3) n returning id`, [program.id, project, line, stage === 'primary' ? null : 'да'])).rows
    const ids = rows.map(row => row.id as number)
    if (stage === 'primary') {
      await db.query(`update weld_joints set vik_request='STAGED-REQUEST',vik_request_date='2026-09-02',
        vik_result=case when joint='F981' then 'ремонт' else 'годен' end,vik_conclusion=$2,vik_conclusion_date='2026-09-03',
        vik_defect_description=case when joint='F981' then 'Тестовый дефект' else 'ДНО' end where id=any($1::int[])`, [ids, title])
    } else {
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
        select id,'ВИК','STAGED-REQUEST','2026-09-02',case when joint='F981' then 'ремонт' else 'годен' end,$2,'2026-09-03',
        case when joint='F981' then 'Тестовый дефект' else 'ДНО' end from weld_joints where id=any($1::int[])`, [ids, title])
    }
    return ids
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
    if (stage === 'primary') await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    else await syncPreHeatTreatmentDocumentsInTransaction(tx, rows,
      await tx.select().from(preHeatTreatmentControls).where(inArray(preHeatTreatmentControls.weldJointId, ids)))
  })
  await withE2eDatabase(db => db.query('update generated_documents set specialists=$1::jsonb where title=$2', [JSON.stringify(signers), title]))
  return ids
}

async function facts(stage: Stage) {
  return withE2eDatabase(async db => (await db.query(stage === 'primary'
    ? `select id,joint,vik_result as result,vik_conclusion as conclusion,vik_conclusion_date::text as date,
        vik_request as request,vik_request_date::text as request_date,vik_defect_description as defect,officiality
        from weld_joints where project_title=$1 order by joint`
    : `select w.id,w.joint,c.result,c.conclusion_name as conclusion,c.conclusion_date::text as date,
        c.request_name as request,c.request_date::text as request_date,c.defect_description as defect,w.officiality
        from weld_joints w join pre_heat_treatment_controls c on c.weld_joint_id=w.id and c.method='ВИК'
        where w.project_title=$1 order by w.joint`, [project])).rows)
}

async function openManager(page: Page, stage: Stage) {
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  if (stage === 'beforeHeatTreatment') {
    await page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'До ТО', exact: true }).click()
  }
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', {
    name: stage === 'primary' ? 'Все результаты ЛНК' : 'Все результаты ЛНК до ТО', exact: true,
  }) })
  await manager.getByLabel('Вид контроля в реестре').selectOption(stage === 'primary' ? 'vikRequest' : 'ВИК')
  // Other scenarios may leave newer records above this fixture. Use the
  // operator's search instead of assuming its rows are in the virtual window.
  const loaded = page.waitForResponse(response => response.url().includes('/_serverFn/') &&
    rpcName(response.url()).startsWith('listLnkWorkflowRows') && Boolean(response.request().postData()?.includes(line)))
  await manager.getByPlaceholder('Стык, линия, заявка или заключение').fill(line)
  await loaded
  return manager
}

async function choose(manager: Locator, joint: string) {
  const entry = manager.getByRole('button').filter({ hasText: `${line} · ${joint}` })
  await expect(entry).toHaveCount(1)
  await entry.click()
  await expect(manager.getByRole('heading', { name: `${line} · ${joint}`, exact: true })).toBeVisible()
  const edit = manager.getByRole('button', { name: 'Редактировать', exact: true })
  if (await edit.isVisible()) await edit.click()
  return entry
}

async function prepare(manager: Locator) {
  await choose(manager, 'F981')
  await manager.getByRole('button', { name: 'годен', exact: true }).last().click()
  await choose(manager, 'F982')
  await manager.getByRole('button', { name: 'Удалить результат', exact: true }).click()
}

for (const stage of ['primary', 'beforeHeatTreatment'] as const) {
  test(`${stage}: смешанные изменения, отмена, закрытие, повтор и сохранность общего заключения`, async ({ page }, info) => {
    await seed(stage)
    const errors: string[] = [], writes: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      if (request.url().includes('/_serverFn/') && /^(updateWeldJoints_|correctPreHeatTreatment|savePreHeatTreatmentLnkResultEdits_)/.test(rpcName(request.url()))) writes.push(request.url())
    })
    let manager = await openManager(page, stage)
    const original = await facts(stage)
    await prepare(manager)
    await expect(manager.getByText('Будет удалён', { exact: true }).first()).toBeVisible()
    await expect(manager.getByRole('button', { name: 'Отменить изменения', exact: true })).toBeEnabled()
    expect(await facts(stage)).toEqual(original)
    expect(writes).toHaveLength(0)
    await manager.getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', {
      name: stage === 'primary' ? 'До ТО' : 'Основной', exact: true,
    }).click()
    await expect(manager).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Сначала сохраните или отмените изменения результатов' })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`notification-${stage}-modal.png`) })
    await page.getByRole('status').filter({ hasText: 'Сначала сохраните или отмените изменения результатов' }).getByRole('button', { name: 'Закрыть уведомление' }).click()
    await expect(manager.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeEnabled()
    await manager.getByRole('button', { name: 'Отменить изменения', exact: true }).click()
    await expect(manager.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeDisabled()
    expect(await facts(stage)).toEqual(original)

    await prepare(manager)
    // The second staged change leaves the visible registry selection, but must
    // remain in the confirmation and the single atomic batch.
    await manager.getByRole('group', { name: 'Фильтр результатов' }).getByRole('button', { name: 'ремонт', exact: true }).click()
    await expect(manager.getByRole('button').filter({ hasText: `${line} · F982` })).toHaveCount(0)
    await manager.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    const confirmation = lnkResultConfirmation(page)
    await expect(confirmation).toContainText('F981')
    await expect(confirmation).toContainText('F982')
    await expect(confirmation).toContainText('ремонт')
    await expect(confirmation).toContainText('годен')
    await expect(confirmation).toContainText('Удаление результата')
    await expect(confirmation).toContainText('ВИК')
    expect(await facts(stage)).toEqual(original)
    expect(writes).toHaveLength(0)
    await confirmation.screenshot({ path: info.outputPath(`changes-${stage}-desktop.png`) })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(confirmation.getByRole('button', { name: 'Применить изменения', exact: true })).toBeInViewport()
    expect(await confirmation.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await confirmation.screenshot({ path: info.outputPath(`changes-${stage}-mobile.png`) })
    await confirmation.getByRole('button', { name: 'Вернуться к редактированию', exact: true }).click()
    await page.setViewportSize({ width: 1600, height: 1000 })
    await expect(manager.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeEnabled()
    await manager.getByRole('button', { name: 'Закрыть', exact: true }).click()
    expect(await facts(stage)).toEqual(original)
    manager = await openManager(page, stage)
    await expect(manager.getByRole('button', { name: 'Сохранить изменения', exact: true })).toHaveCount(0)
    await prepare(manager)
    await manager.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    await confirmLnkResultChanges(page)
    await expect.poll(async () => (await facts(stage)).map(row => row.result)).toEqual(['годен', 'ожидает НК', 'годен'])
    const after = await facts(stage)
    expect(after[0]).toMatchObject({ conclusion: title, date: '2026-09-03', defect: 'ДНО' })
    expect(after[1]).toMatchObject({ conclusion: null, date: null, defect: null, request: 'STAGED-REQUEST', request_date: '2026-09-02' })
    expect(after[2]).toEqual(original[2])
    const document = await withE2eDatabase(async db => (await db.query(`select d.row_count,d.specialists,array_agg(w.joint order by w.joint) as joints
      from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id
      where d.title=$1 and d.type='system:lnkConclusionVik' group by d.id`, [title])).rows)
    expect(document).toEqual([{ row_count: 2, specialists: signers, joints: ['F981', 'F983'] }])
    expect(writes).toHaveLength(1)
    expect(errors).toEqual([])
    await page.screenshot({ path: info.outputPath(`notification-${stage}-saved.png`) })
  })

  test(`${stage}: устаревшая позиция блокирует весь подтверждённый пакет без частичного удаления`, async ({ page }) => {
    const ids = await seed(stage)
    const manager = await openManager(page, stage)
    await prepare(manager)
    await manager.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    await expect(lnkResultConfirmation(page)).toBeVisible()
    // A committed edit in another client changes the version after preview.
    await withE2eDatabase(db => db.query("update weld_joints set lnk_note='Изменено другим пользователем',updated_at=now() where id=$1", [ids[1]]))
    const before = await facts(stage)
    await confirmLnkResultChanges(page)
    await expect(page.getByRole('status').filter({ hasText: 'Ничего не сохранено' })).toBeVisible()
    expect(await facts(stage)).toEqual(before)
    await expect(manager).toBeVisible()
    await expect(manager.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeEnabled()
  })

  test(`${stage}: сервер отклоняет защищённое удаление вместе с допустимой заменой атомарно`, async ({ page }) => {
    const ids = await seed(stage)
    await withE2eDatabase(async db => {
      await db.query("update weld_joints set officiality='неофициальный',final_status='не годен' where id=$1", [ids[1]])
      if (stage === 'primary') await db.query("update weld_joints set vik_result='ремонт',vik_defect_description='Дефект' where id=$1", [ids[1]])
      else await db.query("update pre_heat_treatment_controls set result='ремонт',defect_description='Дефект' where weld_joint_id=$1 and method='ВИК'", [ids[1]])
    })
    const manager = stage === 'beforeHeatTreatment' ? await openManager(page, stage) : null
    if (manager) {
      await choose(manager, 'F981')
      await manager.getByRole('button', { name: 'годен', exact: true }).last().click()
    }
    const versions = await withE2eDatabase(async db => (await db.query<{ id: number; version: string }>(
      'select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids])).rows)
    const controls = await withE2eDatabase(async db => (await db.query<{ id: number; weld_joint_id: number }>(
      "select id,weld_joint_id from pre_heat_treatment_controls where weld_joint_id=any($1::int[]) and method='ВИК'", [ids])).rows)
    const snapshot = () => withE2eDatabase(async db => ({
      welds: (await db.query('select * from weld_joints where id=any($1::int[]) order by id', [ids])).rows,
      controls: (await db.query('select * from pre_heat_treatment_controls where weld_joint_id=any($1::int[]) order by id', [ids])).rows,
      documents: (await db.query('select * from generated_documents where title=$1 order by id', [title])).rows,
      links: (await db.query('select a.* from generated_document_weld_joints a join generated_documents d on d.id=a.document_id where d.title=$1 order by a.document_id,a.weld_joint_id', [title])).rows,
      dispatcher: (await db.query('select * from dispatcher_task_index_state order by id')).rows,
    }))
    // Call the real mutation with current versions, bypassing only disabled UI
    // controls. A stale-token rejection would not prove the business guard.
    const save = async (includeProtected: boolean) => {
      const targets = ids.slice(0, includeProtected ? 2 : 1)
      const expectedVersions = versions.filter(row => targets.includes(row.id))
      if (stage === 'primary') return updateWeldJoints({ data: {
        mutationScope: 'lnk', expectedVersions,
        records: targets.map((id, index) => index === 0
          ? { id, vikResult: 'годен', vikDefectDescription: 'ДНО' }
          : { id, vikResult: null, vikConclusion: null, vikConclusionDate: null, vikDefectDescription: null }),
      } })
      const data = { changes: targets.map((rowId, index) => ({
        rowId, relationId: controls.find(control => control.weld_joint_id === rowId)!.id,
        expectedVersion: expectedVersions.find(row => row.id === rowId)!.version, result: index === 0 ? 'годен' : null,
      })) }
      const isSave = (url: string) => url.includes('/_serverFn/') && rpcName(url).startsWith('savePreHeatTreatmentLnkResultEdits_')
      await page.route('**/_serverFn/**', async route => {
        if (!isSave(route.request().url())) return route.continue()
        await route.continue({ postData: await serializeRpcData(data) })
      })
      const response = page.waitForResponse(response => isSave(response.url()))
      await manager!.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
      await confirmLnkResultChanges(page)
      const body = await (await response).text()
      await page.unrouteAll({ behavior: 'wait' })
      if (includeProtected) {
        await expect(page.getByRole('status').filter({ hasText: /неофициальн|последний негодный/i })).toBeVisible()
        throw new Error(body)
      }
      await expect.poll(async () => (await facts(stage))[0].result).toBe('годен')
    }
    const before = await snapshot()
    await expect(save(true)).rejects.toThrow(/неофициальн|последний негодный/i)
    expect(await snapshot()).toEqual(before)
    // The companion really is editable; an unrelated fixture-validation error
    // must not make an ineffective atomicity regression pass.
    await save(false)
    expect((await facts(stage)).map(row => row.result)).toEqual(['годен', 'ремонт', 'годен'])
    expect((await facts(stage))[1].officiality).toBe('неофициальный')
  })
}

test('удаление заявки не захватывает стык, добавленный после открытия подтверждения', async ({ page }) => {
  await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
    officiality,revision_actuality,has_vik,vik_result,vik_request,vik_request_date)
    select $1,'STAGED',$2,'F99'||n,'2026-09-01','действующий','актуальная','да','ожидает НК','STAGED-REQUEST','2026-09-02'
    from generate_series(1,2) n`, [project, line]))
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
  await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Все заявки ЛНК', exact: true }) })
  await manager.getByPlaceholder('Название, дата, стык или линия').fill('STAGED-REQUEST')
  await manager.getByRole('button').filter({ hasText: 'STAGED-REQUEST' }).click()
  await manager.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await manager.getByRole('button', { name: 'Удалить выбранную заявку', exact: true }).click()
  const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Удалить заявку ЛНК', exact: true }) })
  await expect(confirmation).toBeVisible()
  await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
    officiality,revision_actuality,has_vik,vik_result,vik_request,vik_request_date)
    values ($1,'STAGED',$2,'F993','2026-09-01','действующий','актуальная','да','ожидает НК','STAGED-REQUEST','2026-09-02')`, [project, line]))
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /измен|устарел|обнов/i })).toBeVisible()
  expect(await withE2eDatabase(async db => (await db.query('select joint,vik_request from weld_joints where project_title=$1 order by joint', [project])).rows))
    .toEqual(['F991', 'F992', 'F993'].map(joint => ({ joint, vik_request: 'STAGED-REQUEST' })))
})

const updateWeldJoints = asE2eOwner(raw_updateWeldJoints, 'welding.edit')

for (const stage of ['primary', 'beforeHeatTreatment'] as const) {
  test(`${stage}: общий документ и отдельная позиция редактируются раздельно`, async ({ page }, info) => {
    await seed(stage)
    // Official joints use null in storage (the UI displays «официальный»).
    await withE2eDatabase(db => db.query("update weld_joints set officiality=null where project_title=$1", [project]))
    const initial = await facts(stage)
    const before = await withE2eDatabase(async db => (await db.query('select id,specialists from generated_documents where title=$1', [title])).rows[0])
    const manager = await openManager(page, stage)
    await expect(manager.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
    await expect(manager.getByRole('button', { name: 'Сохранить изменения документа', exact: true })).toHaveCount(0)
    await choose(manager, 'F982')
    const commonName = `${title}-RENAMED`
    await manager.getByRole('button', { name: 'К документу', exact: true }).click()
    const common = manager.getByRole('tabpanel', { name: 'Документы', exact: true }).getByLabel('Название документа', { exact: true })
    await expect(common).toBeEnabled()
    await common.fill(commonName)
    await expect(manager.getByRole('button', { name: 'Сохранить изменения документа', exact: true })).toBeEnabled()
    await manager.getByRole('tab', { name: 'Стыки', exact: true }).click()
    await expect(manager.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeDisabled()
    await manager.getByRole('tab', { name: 'Документы', exact: true }).click()
    await expect(common).toHaveValue(commonName)
    await expect(manager.getByRole('region', { name: 'Полный состав документа' })).toContainText('F983')
    await manager.getByRole('button', { name: 'Свернуть редактирование', exact: true }).click()
    await manager.getByRole('button', { name: 'Редактировать', exact: true }).click()
    await expect(common).toHaveValue(commonName)
    await manager.getByRole('button', { name: 'Сохранить изменения документа', exact: true }).click()
    const renameConfirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Сохранить изменения документа', exact: true }) })
    await expect(renameConfirm).toContainText('3 поз. в 3 ст.')
    await expect(renameConfirm).toContainText('Стыки не выделяются')
    await renameConfirm.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    await expect.poll(() => facts(stage)).toEqual(initial.map(row => ({ ...row, conclusion: commonName })))
    const renamed = await withE2eDatabase(async db => (await db.query('select id,specialists,row_count from generated_documents where title=$1', [commonName])).rows[0])
    expect(renamed).toEqual({ ...before, row_count: 3 })
    const reopened = await openManager(page, stage)
    await choose(reopened, 'F982')
    await reopened.getByText('Изменить заключение только этого стыка', { exact: true }).click()
    const separate = stage === 'primary' ? reopened.getByPlaceholder('Заключение только этого стыка') : reopened.getByLabel('Заключение только этого стыка', { exact: true })
    await expect(separate).toBeVisible()
    const separateName = `${title}-F982`
    await separate.fill(separateName)
    await reopened.getByRole('button', { name: 'Изменить заключение этого стыка', exact: true }).click()
    const moveConfirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Изменить документ только этой позиции', exact: true }) })
    await expect(moveConfirm).toContainText(`${commonName}» → «${separateName}`)
    await expect(moveConfirm).toContainText('Остальные позиции останутся')
    await moveConfirm.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await facts(stage)).toEqual(initial.map(row => ({ ...row, conclusion: commonName })))
    await reopened.getByRole('button', { name: 'Изменить заключение этого стыка', exact: true }).click()
    await moveConfirm.getByRole('button', { name: 'Изменить документ этой позиции', exact: true }).click()
    await expect.poll(() => facts(stage)).toEqual(initial.map(row => ({ ...row, conclusion: row.joint === 'F982' ? separateName : commonName })))
    const single = await openManager(page, stage)
    await choose(single, 'F982')
    await expect(single.getByRole('button', { name: 'К документу', exact: true })).toBeEnabled()
    await expect(single.getByText('Изменить заключение только этого стыка', { exact: true })).toHaveCount(0)
    await expect(single.getByRole('button', { name: 'Изменить заключение этого стыка', exact: true })).toHaveCount(0)
    await single.screenshot({ path: info.outputPath('single-document-editing.png') })
    await page.setViewportSize({ width: 1600, height: 1000 })
    await choose(single, 'F981')
    await single.getByRole('group', { name: 'Результат выбранного стыка', exact: true }).scrollIntoViewIfNeeded()
    await single.screenshot({ path: info.outputPath('shared-document-editing.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await single.getByRole('group', { name: 'Результат выбранного стыка', exact: true }).scrollIntoViewIfNeeded()
    expect(await single.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await single.screenshot({ path: info.outputPath('shared-document-editing-mobile.png') })
  })
}

for (const stage of ['primary', 'beforeHeatTreatment'] as const) {
  test(`${stage}: request document tab checks all three joints and saves date and name atomically`, async ({ page }) => {
    await seed(stage)
    // The complete registry must offer the before-TO stage even when its
    // currently selected primary request belongs to an unrelated ordinary weld.
    if (stage === 'beforeHeatTreatment') await withE2eDatabase(db => db.query(`insert into weld_joints(
      project_title,subtitle_code,line,joint,weld_date,revision_actuality,has_vik,
      vik_request,vik_request_date,vik_result)
      values ($1,'STAGED',$2,'F984','2026-09-01','актуальная','да',
        'STAGED-PRIMARY-ONLY','2026-09-02','ожидает НК')`, [project, line]))
    await withE2eDatabase(db => db.query("update weld_joints set weld_date='2026-09-02' where project_title=$1 and joint='F983'", [project]))
    const before = await facts(stage)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/lnk')
    await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
    await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
    if (stage === 'beforeHeatTreatment') await page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК' })
      .getByRole('button', { name: 'До ТО', exact: true }).click()
    const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', {
      name: stage === 'primary' ? 'Все заявки ЛНК' : 'Все заявки ЛНК до ТО', exact: true,
    }) })
    await manager.getByRole('tab', { name: 'Документы', exact: true }).click()
    const pane = manager.getByRole('tabpanel', { name: 'Документы', exact: true })
    await pane.getByPlaceholder('Поиск документов').fill('STAGED-REQUEST')
    await pane.getByRole('complementary').getByRole('button').filter({ hasText: 'STAGED-REQUEST' }).click()
    await pane.getByRole('button', { name: 'Редактировать', exact: true }).click()
    const date = pane.getByLabel('Дата документа', { exact: true })
    const name = pane.getByLabel('Название документа', { exact: true })
    const save = pane.getByRole('button', { name: 'Сохранить изменения документа', exact: true })
    await expect(date).toBeEnabled()
    await date.fill('2026-09-01')
    await expect(save).toBeDisabled()
    await expect(pane.getByText(/Сохранение заблокировано:/)).toBeVisible()
    expect(await facts(stage)).toEqual(before)
    await date.fill('2026-09-03')
    await name.fill('STAGED-REQUEST-EDITED')
    await expect(pane.getByRole('region', { name: 'Полный состав документа' })).toContainText('F983')
    await save.click()
    const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Сохранить изменения документа', exact: true }) })
    await expect(confirm).toContainText('3 поз. в 3 ст.')
    await confirm.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await facts(stage)).toEqual(before)
    await expect(name).toHaveValue('STAGED-REQUEST-EDITED')
    await save.click()
    await confirm.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    await expect.poll(() => facts(stage)).toEqual(before.map(row => ({ ...row, request: 'STAGED-REQUEST-EDITED', request_date: '2026-09-03' })))
    await expect(pane.getByRole('heading', { name: 'STAGED-REQUEST-EDITED', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}
