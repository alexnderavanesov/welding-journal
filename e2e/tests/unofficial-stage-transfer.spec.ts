import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E unofficial stage transfer', line = 'UNOFF-STAGE', title = 'UNOFF-STAGE-UZK'
let settings: { value: string; updated_at: Date } | undefined

test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    settings = (await db.query(`select value,updated_at from app_settings where key='control-processes'`)).rows[0]
    await db.query(`insert into app_settings(key,value) values ('control-processes',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({ preHeatTreatmentLnkEnabled: true, allowPrimaryLnkBeforePreviousStagesComplete: true })])
  })
})
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    if (settings) await db.query(`update app_settings set value=$1,updated_at=$2 where key='control-processes'`, [settings.value, settings.updated_at])
    else await db.query(`delete from app_settings where key='control-processes'`)
  })
})

async function seed() {
  return withE2eDatabase(async db => {
    const { rows: [row] } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,
      weld_date,connection_type,officiality,revision_actuality,psto_required,
      has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,
      has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,
      has_pvk,pvk_result,pvk_request,pvk_request_date,pvk_conclusion,pvk_conclusion_date,final_status)
      values ($1,'STAGE',$2,'F781','2026-09-01','С17','неофициальный','актуальная','да',
      'да','годен','STAGE-VIK-R','2026-09-01','STAGE-VIK-C','2026-09-01',
      'да','годен','STAGE-UZK-R','2026-09-02',$3,'2026-09-03',
      'да','годен','STAGE-PVK-R','2026-09-01','STAGE-PVK-C','2026-09-01','не годен') returning id`, [project, line, title])
    await db.query(`update weld_joints set welding_method='РД',material_group='M01',d1=108,d2=108,t1=4,t2=4,wdi=0.42,
      stamp_1_k='STAGE-A',stamp_1_z='STAGE-A',stamp_1_o='STAGE-A',
      stamp_1_k_fact='STAGE-A',stamp_1_z_fact='STAGE-A',stamp_1_o_fact='STAGE-A',
      has_rk='да',rk_result='ремонт',rk_request='STAGE-RK-R',rk_request_date='2026-09-02',
      rk_conclusion='STAGE-RK-C',rk_conclusion_date='2026-09-03' where id=$1`, [row.id])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,request_name,request_date,conclusion_name,conclusion_date)
      values ($1,'ВИК','годен','STAGE-PRE-VIK-R','2026-09-01','STAGE-PRE-VIK-C','2026-09-01'),
      ($1,'ПВК','годен','STAGE-PRE-PVK-R','2026-09-01','STAGE-PRE-PVK-C','2026-09-01')`, [row.id])
    const { rows: [document] } = await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
      values ('system:lnkConclusionUzk',$1,'stage.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-09-03','2026-09-03',1,$2) returning id`, [title, JSON.stringify({ methodCode: 'УЗК', methodCodes: ['УЗК'], positionCount: 1, projects: [project], lines: [line] })])
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)`, [document.id, row.id])
    return row.id as number
  })
}

async function openTransfer(page: Page) {
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  await page.getByText(title, { exact: true }).first()
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " grid ")][1]').click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Изменить этап контроля', exact: true }).click()
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Изменить этап контроля', exact: true }) })
}

async function restoreOfficiality(page: Page) {
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Официальность', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(line)
  await expect(dialog.getByText('Найдено: 1 · Выбрано: 0', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await dialog.getByRole('button', { name: /^Официальный/ }).click()
  await dialog.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function snapshot(id: number) {
  return withE2eDatabase(async db => ({
    row: (await db.query('select uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,rk_result,pvk_result from weld_joints where id=$1', [id])).rows[0],
    controls: (await db.query('select * from pre_heat_treatment_controls where weld_joint_id=$1 order by id', [id])).rows,
    documents: (await db.query(`select d.* from generated_documents d join generated_document_weld_joints a on a.document_id=d.id where a.weld_joint_id=$1 order by d.id`, [id])).rows,
  }))
}

test('годное заключение в обе стороны: запрет, старое окно, сохранность документов и повтор после возврата официальности', async ({ page }) => {
  const id = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const target of ['До ТО', 'Основной']) {
    let dialog = await openTransfer(page)
    await expect(dialog.getByText(/Сначала верните стыку официальность/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Проверить перенос', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await restoreOfficiality(page)
    dialog = await openTransfer(page)
    await expect(dialog.getByText(target, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Проверить перенос', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Подтвердить перенос', exact: true })).toBeEnabled()
    // A second operator changes officiality after preview. The write must
    // revalidate the business rule, not rely on the earlier selected positions.
    await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный' where id=$1`, [id]))
    const before = await snapshot(id)
    const response = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('transferLnkDocumentStage_'))
    await dialog.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
    expect(await (await response).text()).toContain('Сначала верните стыку официальность')
    await expect(dialog.getByText(/Сначала верните стыку официальность/)).toBeVisible()
    expect(await snapshot(id)).toEqual(before)
    await page.keyboard.press('Escape')
    await restoreOfficiality(page)
    dialog = await openTransfer(page)
    await dialog.getByRole('button', { name: 'Проверить перенос', exact: true }).click()
    await dialog.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
    await expect(dialog).toBeHidden()
    const after = await snapshot(id)
    if (target === 'До ТО') {
      expect(after.row.uzk_conclusion).toBeNull()
      expect(after.controls.find(control => control.method === 'УЗК')).toMatchObject({ result: 'годен', conclusion_name: title })
    } else {
      expect(after.row).toMatchObject({ uzk_result: 'годен', uzk_conclusion: title, uzk_request: 'STAGE-UZK-R' })
      expect(after.controls.some(control => control.method === 'УЗК')).toBe(false)
    }
    expect(after.row.rk_result).toBe('ремонт')
    expect(after.row.pvk_result).toBe('годен')
    expect(after.documents.some(document => document.title === title)).toBe(true)
    // The independent rejected RK still makes unofficiality a valid state.
    await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный' where id=$1`, [id]))
  }
  expect(errors).toEqual([])
})

test('сохранённое негодное до ТО переносится в пустой основной этап без изменения результата', async ({ page }) => {
  const id = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set officiality='действующий',psto_required='нет',rk_result='годен',
      uzk_result=null,uzk_request=null,uzk_request_date=null,uzk_conclusion=null,uzk_conclusion_date=null where id=$1`, [id])
    // §12 of the agreed system plan permits only one own rejection per record,
    // across stages. Keep the good prerequisites and make UZK the only failure.
    const control = (await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      values ($1,'УЗК','STAGE-UZK-R','2026-09-02','ремонт',$2,'2026-09-03','Исторический дефект') returning id`, [id, title])).rows[0]
    await db.query(`update generated_documents set source_metadata=$1 where title=$2`, [JSON.stringify({
      methodCode: 'УЗК', methodCodes: ['УЗК'], sourceKind: 'beforeHeatTreatment', positionCount: 1,
      sourcePositions: [{ kind: 'beforeHeatTreatment', weldJointId: id, relationId: control.id, methodCode: 'УЗК' }],
      projects: [project], lines: [line],
    }), title])
  })
  let dialog = await openTransfer(page)
  const before = await snapshot(id)
  expect(before.row.rk_result).toBe('годен')
  expect(before.controls.map(control => [control.method, control.result])).toEqual([
    ['ВИК', 'годен'], ['ПВК', 'годен'], ['УЗК', 'ремонт'],
  ])
  await expect(dialog.getByRole('button', { name: 'Проверить перенос', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  expect(await snapshot(id)).toEqual(before)
  dialog = await openTransfer(page)
  await dialog.getByRole('button', { name: 'Проверить перенос', exact: true }).click()
  await expect(dialog.getByText('ремонт', { exact: true }).first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await snapshot(id)
  expect(after.row).toMatchObject({ uzk_result: 'ремонт', uzk_request: 'STAGE-UZK-R', uzk_conclusion: title })
  expect(after.controls).toEqual(before.controls.filter(control => control.method !== 'УЗК'))
  expect(after.documents.find(document => document.title === title)).toBeDefined()
  expect(after.row.rk_result).toBe(before.row.rk_result)
  await withE2eDatabase(async db => {
    const row = (await db.query(`select uzk_defect_description,final_status from weld_joints where id=$1`, [id])).rows[0]
    expect(row).toEqual({ uzk_defect_description: 'Исторический дефект', final_status: 'не годен' })
  })
  expect(errors).toEqual([])
})
