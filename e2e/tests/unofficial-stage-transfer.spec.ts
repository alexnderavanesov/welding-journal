import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

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

async function snapshot(id: number) {
  return withE2eDatabase(async db => ({
    row: (await db.query('select uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,rk_result,pvk_result from weld_joints where id=$1', [id])).rows[0],
    controls: (await db.query('select * from pre_heat_treatment_controls where weld_joint_id=$1 order by id', [id])).rows,
    documents: (await db.query(`select d.* from generated_documents d join generated_document_weld_joints a on a.document_id=d.id where a.weld_joint_id=$1 order by d.id`, [id])).rows,
  }))
}


for (const officiality of ['действующий', 'неофициальный']) {
  test(`смены этапа нет в документах и реестрах обоих этапов: ${officiality}`, async ({ page }) => {
    const id = await seed(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await withE2eDatabase(db => db.query('update weld_joints set officiality=$1 where id=$2', [officiality, id]))
    await page.goto('/documents')
    await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
    const document = page.getByText(title, { exact: true }).first()
    await expect(document).toBeVisible()
    const before = await snapshot(id)
    await document.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " grid ")][1]').click({ button: 'right' })
    await expect(page.getByTestId('context-action-menu')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Изменить этап контроля', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.goto('/lnk')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F781')
    await page.getByRole('button', { name: 'Выбрать стык F781', exact: true }).click()
    await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
    await page.getByRole('button', { name: 'Редактировать выбранные', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('Стык, линия, заявка или заключение').fill(line)
    await expect(dialog.getByText('STAGE-VIK-C', { exact: true }).first()).toBeVisible()
    await dialog.getByText('STAGE-VIK-C', { exact: true }).first().click({ button: 'right' })
    await expect(page.getByTestId('context-action-menu')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Изменить этап контроля', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await dialog.getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'До ТО', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('Стык, линия, заявка или заключение').fill(line)
    await expect(dialog.getByText('STAGE-PRE-VIK-C', { exact: true }).first()).toBeVisible()
    await dialog.getByText('STAGE-PRE-VIK-C', { exact: true }).first().click({ button: 'right' })
    await expect(page.getByTestId('context-action-menu')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Изменить этап контроля', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
    await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
    dialog = page.getByRole('dialog')
    // Viewing a different stage remains available; it is not a data transfer.
    await expect(dialog.getByRole('group', { name: 'Этап контроля ЛНК' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Изменить этап контроля', exact: true })).toHaveCount(0)
    const after = await snapshot(id)
    expect(after.row).toEqual(before.row)
    expect(after.controls).toEqual(before.controls)
    expect(after.documents.some(document => document.title === title)).toBe(true)
    expect(errors).toEqual([])
  })
}
