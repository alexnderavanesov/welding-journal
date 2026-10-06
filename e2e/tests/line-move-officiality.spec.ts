import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E line move officiality', sourceLine = 'MOVE-UNOFFICIAL', targetLine = 'MOVE-NO-PSTO', joint = 'F781', stamp = 'E2MO'
let dataListSnapshot: { value: string; updated_at: Date } | undefined
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [stamp])
    await db.query("delete from app_settings where key='data-list'")
    if (dataListSnapshot) await db.query("insert into app_settings(key,value,updated_at) values ('data-list',$1,$2)", [dataListSnapshot.value, dataListSnapshot.updated_at])
  })
})

async function seed() {
  return withE2eDatabase(async db => {
    dataListSnapshot = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
    await db.query(`insert into app_settings(key,value,updated_at) values ('data-list',$1,now())
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({ weldingTypes: ['РД'], connectionTypes: ['С17'], materialGroups: ['M01'] })])
    await db.query(`insert into welder_stamps(naks_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits)
      values ($1,'E2E перенос неофициального','РД','M01','1','1000','1','100','2026-01-01','2026-12-31',$2)`,
    [stamp, JSON.stringify([{ id: 'e2e-line-move', weldType: 'РД', materialGroups: 'M01', diameterFrom: '1', diameterTo: '1000', thicknessFrom: '1', thicknessTo: '100', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }])])
    const { rows: lines } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'U',$2,'II','A',10,0),($1,'U',$3,'II','A',10,0) returning id,line`, [project, sourceLine, targetLine])
    // The mistaken rejected primary set was already cleared by the operator;
    // an earlier good pre-TO set and unofficiality remain. No performed PSTO.
    const { rows: [row] } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,weld_date,
      connection_type,material_group,welding_method,d1,d2,t1,t2,wdi,stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,has_vik,psto_required)
      values ($1,$2,'U',$3,$4,'неофициальный','2026-09-01','С17','M01','РД',108,108,4,4,0.42,$5,$5,$5,$5,$5,$5,'да','да') returning id`,
    [lines.find(line => line.line === sourceLine).id, project, sourceLine, joint, stamp])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      values ($1,'ВИК','MO-PRE','2026-09-01','годен','MO-PRE-C','2026-09-02','ДНО')`, [row.id])
    return row.id as number
  })
}

async function openMove(page: Page, id: number, existingStages = false) {
  await page.goto('/journal')
  await page.locator(`tr[data-weld-row-id="${id}"]`).getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  const line = editor.getByText('Линия', { exact: true }).locator('..').getByRole('textbox')
  const checked = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('getPstoWeldLineMovePreview_'))
  await line.fill(targetLine)
  await line.press('Tab')
  await checked
  if (!existingStages) await expect(page.getByRole('heading', { name: 'Перенос стыка на линию без ПСТО', exact: true })).toBeVisible()
  return editor
}

test('перенос линии не обходит официальность: UI, старый клиент, отсутствие частичного переноса и исправление через официальность', async ({ page }) => {
  const id = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const state = () => withE2eDatabase(async db => (await db.query(`select w.line,w.officiality,w.vik_result,w.vik_conclusion,
    c.id as control_id,c.result,c.conclusion_name from weld_joints w
    left join pre_heat_treatment_controls c on c.weld_joint_id=w.id where w.id=$1`, [id])).rows)
  const before = await state()
  let editor = await openMove(page, id)
  const promotionButton = page.getByRole('button', { name: /^Перенести НК «До ТО»/ })
  const promotionWasDisabled = await promotionButton.isDisabled()
  const promotionExplanation = await promotionButton.innerText()
  // Simulate the old dialog's valid wire request, with a fresh version. This
  // must reach the business guard rather than rely on a disabled button.
  let changedRequest = false
  const isSave = (url: string) => url.includes('/_serverFn/') && rpcName(url).startsWith('updateWeldJoint_')
  await page.route('**/_serverFn/**', async route => {
    if (!changedRequest && isSave(route.request().url())) {
      const body = route.request().postData()!
      expect(body).toContain('keepPrimary')
      changedRequest = true
      await route.continue({ postData: body.replaceAll('keepPrimary', 'promoteBeforeHeatTreatment') })
    } else await route.continue()
  })
  await page.getByRole('button', { name: /^Изменить только линию/ }).click()
  await page.getByRole('button', { name: 'Применить решение', exact: true }).click()
  const response = page.waitForResponse(response => isSave(response.url()))
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect(await (await response).text()).toContain('Сначала верните стыку официальность')
  expect(promotionWasDisabled).toBe(true)
  expect(promotionExplanation).toContain('Сначала верните стыку официальность')
  await expect(editor).toBeVisible()
  expect(await state()).toEqual(before)

  await page.goto('/lnk')
  await page.getByRole('button', { name: 'Официальность', exact: true }).click()
  const officiality = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
  await officiality.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  await officiality.getByRole('button').filter({ hasText: `${sourceLine} · ${joint}` }).click()
  await officiality.getByRole('button', { name: /^Официальный/ }).click()
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(officiality).toBeHidden()
  editor = await openMove(page, id)
  await page.getByRole('button', { name: /^Перенести НК «До ТО»/ }).click()
  await page.getByRole('button', { name: 'Применить решение', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(await state()).toEqual([{ line: targetLine, officiality: null, vik_result: 'годен', vik_conclusion: 'MO-PRE-C', control_id: null, result: null, conclusion_name: null }])
  expect(errors).toEqual([])
})

test('сохранённый брак до ТО после смены линии виден и предлагает продолжение, а не скрытый годный стык', async ({ page }) => {
  const id = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await withE2eDatabase(async db => {
    await db.query('update weld_joints set officiality=null where id=$1', [id])
    await db.query("update pre_heat_treatment_controls set result='ремонт' where weld_joint_id=$1", [id])
  })
  const editor = await openMove(page, id)
  await expect(page.getByRole('button', { name: 'Применить решение', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: /^Изменить только линию/ }).click()
  await page.getByRole('button', { name: 'Применить решение', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(await withE2eDatabase(async db => (await db.query(`select w.line,w.final_status,c.result,c.conclusion_name
    from weld_joints w join pre_heat_treatment_controls c on c.weld_joint_id=w.id where w.id=$1`, [id])).rows))
    .toEqual([{ line: targetLine, final_status: 'не годен', result: 'ремонт', conclusion_name: 'MO-PRE-C' }])
  await page.locator(`tr[data-weld-row-id="${id}"]`).getByRole('button', { name: joint, exact: true }).click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Картина стыка ${joint}`, exact: true }) })
  await expect(picture.getByText(/На текущей линии этап не предусмотрен/)).toBeVisible()
  await expect(picture.getByRole('region', { name: 'Продолжение цепочки стыка' }).getByRole('button', { name: `Создать ${joint}R1`, exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('возврат на линию ПСТО сохраняет ранее разделённые этапы и не переносит основной РК поверх истории', async ({ page }) => {
  const id = await seed()
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set officiality=null,psto_required=null,has_rk='да',rk_request='BACK-RK',
      rk_request_date='2026-09-02',rk_result='ожидает НК' where id=$1`, [id])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,psto_required,has_vik)
      select id,project_title,subtitle_code,line,'F782','да','да' from line_programs where project_title=$1 and line=$2`, [project, targetLine])
  })
  const editor = await openMove(page, id, true)
  // This joint already has separate pre/primary stages, not a new stage choice.
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(await withE2eDatabase(async db => (await db.query(`select method,result from pre_heat_treatment_controls where weld_joint_id=$1 order by method`, [id])).rows))
    .toEqual([{ method: 'ВИК', result: 'годен' }])
  expect(await withE2eDatabase(async db => (await db.query('select psto_required,rk_request,rk_result from weld_joints where id=$1', [id])).rows[0]))
    .toEqual({ psto_required: 'да', rk_request: 'BACK-RK', rk_result: 'ожидает НК' })
  await page.goto('/lnk')
  await expect(page.locator(`tr[data-weld-row-id="${id}"]`).getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true })).toBeVisible()
})
