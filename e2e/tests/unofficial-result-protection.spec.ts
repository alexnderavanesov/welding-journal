import { lnkRow as lnkGridRow } from './lnk-grid-helpers'
import { expect, test, type Page, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { confirmLnkResultChanges, lnkResultConfirmation } from '../lnk-result-confirmation'

const project = 'E2E unofficial result guard', joint = 'F731', lineName = 'UNOFFICIAL-GUARD'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed() {
  return withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ($1,'U',$2,'II','A',10,0) returning id`, [project, lineName])
    const { rows: [row] } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,weld_date,connection_type,material_group,welding_method,d1,d2,t1,t2,wdi,stamp_1_k,has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,final_status)
      values ($1,$2,'U',$3,$4,'неофициальный','актуальная','2026-09-01','С17','M01','РД',108,108,4,4,0.42,'A','да','годен','UG-VIK','2026-09-01','UG-VIK-C','2026-09-02','да','ремонт','UG-UZK','2026-09-02','UG-UZK-C','2026-09-03','не годен') returning id`, [line.id, project, lineName, joint])
    return row.id as number
  })
}

const stored = (id: number) => withE2eDatabase(async db => (await db.query('select officiality,uzk_result,vik_result,xmin::text as version from weld_joints where id=$1', [id])).rows[0])
async function openManager(page: Page) {
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК', exact: true }) })
  await dialog.getByLabel('Вид контроля в реестре').selectOption('uzkRequest')
  await dialog.getByRole('button', { name: new RegExp(`${lineName} · ${joint}`) }).click()
  return dialog
}

for (const beforeHeatTreatment of [false, true]) test(`довнесение ВИК годен при сохранённом ремонте УЗК: ${beforeHeatTreatment ? 'до ТО' : 'основной этап'}`, async ({ page }) => {
  const id = await seed(), errors: string[] = [], writes: Request[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/') && /^(updateWeldJoints_|savePreHeatTreatment)/.test(rpcName(request.url()))) writes.push(request) })
  await withE2eDatabase(async db => {
    if (beforeHeatTreatment) {
      await db.query(`update weld_joints set vik_result=null,vik_request=null,vik_request_date=null,vik_conclusion=null,vik_conclusion_date=null,
        uzk_result=null,uzk_request=null,uzk_request_date=null,uzk_conclusion=null,uzk_conclusion_date=null,psto_required='да' where id=$1`, [id])
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
        values ($1,'ВИК','UG-PRE-VIK','2026-09-01','ожидает НК',null,null),
          ($1,'УЗК','UG-PRE-UZK','2026-09-02','ремонт','UG-PRE-UZK-C','2026-09-03')`, [id])
    } else {
      await db.query("update weld_joints set vik_result='ожидает НК',vik_conclusion=null,vik_conclusion_date=null where id=$1", [id])
    }
  })
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
  await lnkGridRow(page, joint).getByRole('checkbox').click()
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Внести результаты', exact: true }).click()
  if (beforeHeatTreatment) {
    const stage = page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК' })
    await stage.getByRole('button', { name: 'До ТО', exact: true }).click()
  }
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', {
    name: beforeHeatTreatment ? 'Внесение результатов ЛНК до ТО' : 'Внесение результатов ЛНК', exact: true,
  }) })
  if (!beforeHeatTreatment) await dialog.getByLabel('Метод контроля', { exact: true }).selectOption('vikRequest')
  const selectedJoint = dialog.getByRole('checkbox', { name: `Выбрать стык ${lineName} ${joint}`, exact: true })
  // The pre-TO form applies its initial selected joint before enabling input.
  await expect(selectedJoint).toBeEnabled()
  await selectedJoint.check()
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-02')
  await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
  await dialog.getByRole('button', { name: beforeHeatTreatment ? 'Сохранить результат до ТО' : 'Сохранить результат', exact: true }).click()
  await expect(dialog).toBeHidden()
  const facts = () => withE2eDatabase(async db => {
    const row = (await db.query('select officiality,final_status,vik_result,uzk_result from weld_joints where id=$1', [id])).rows[0]
    if (beforeHeatTreatment) {
      for (const control of (await db.query('select method,result from pre_heat_treatment_controls where weld_joint_id=$1', [id])).rows) {
        row[control.method === 'ВИК' ? 'vik_result' : 'uzk_result'] = control.result
      }
    }
    return row
  })
  await expect.poll(facts).toEqual({ officiality: 'неофициальный', final_status: 'не годен', vik_result: 'годен', uzk_result: 'ремонт' })
  await page.reload()
  expect(await facts()).toEqual({ officiality: 'неофициальный', final_status: 'не годен', vik_result: 'годен', uzk_result: 'ремонт' })
  expect(errors).toEqual([])
  expect(writes).toHaveLength(1)
})

test('негодный неофициальный: запрет годного результата, отдельное восстановление официальности и защита от старого клиента', async ({ page }) => {
  const id = await seed(), writes: Request[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('updateWeldJoints_')) writes.push(request) })
  await page.goto('/lnk')
  let manager = await openManager(page)
  await expect(manager.getByRole('button', { name: 'годен', exact: true }).last()).toBeDisabled()
  await expect(manager.getByText(/Сначала верните стыку официальность/).first()).toBeVisible()
  await expect(manager.getByRole('button', { name: 'Удалить результат', exact: true })).toBeDisabled()
  await expect(manager.getByText(/последний негодный результат/)).toBeVisible()
  expect(writes).toHaveLength(0)
  await manager.getByRole('button', { name: 'Закрыть', exact: true }).click()
  expect(await stored(id)).toMatchObject({ officiality: 'неофициальный', uzk_result: 'ремонт', vik_result: 'годен' })

  await page.locator('header').getByRole('button', { name: 'Официальность', exact: true }).click()
  const officiality = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
  await officiality.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  await officiality.getByRole('button').filter({ hasText: `${lineName} · ${joint}` }).click()
  await officiality.getByRole('button', { name: /^Официальный/ }).click()
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(officiality).toBeHidden()
  expect((await stored(id)).officiality).not.toBe('неофициальный')

  manager = await openManager(page)
  await expect(manager.getByRole('button', { name: 'годен', exact: true }).last()).toBeEnabled()
  await page.waitForLoadState('networkidle')
  const before = await stored(id)
  await manager.getByRole('button', { name: 'годен', exact: true }).last().click()
  await manager.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await confirmLnkResultChanges(page)
  await expect(manager).toBeHidden()
  expect((await stored(id)).uzk_result).toBe('годен')
  expect(writes).toHaveLength(1)

  // Replay the real wire format with a fresh version: server validation, not
  // stale-token rejection or disabled UI, must protect the unofficial result.
  await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный',uzk_result='ремонт',final_status='не годен' where id=$1`, [id]))
  const current = await stored(id), request = writes[0], body = request.postData()!
  expect(body).toContain(`"${before.version}"`)
  const headers = await request.allHeaders()
  delete headers['content-length']
  const response = await page.request.post(request.url(), { headers, data: body.replaceAll(`"${before.version}"`, `"${current.version}"`) })
  expect(await response.text()).toContain('Сначала верните стыку официальность')
  expect(await stored(id)).toEqual(current)
  expect(errors).toEqual([])
})

test('удаление последнего брака: возврат официальности, отмена удаления и серверный запрет старому клиенту', async ({ page }) => {
  const id = await seed(), writes: Request[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/') && /^updateWeldJoints?_/.test(rpcName(request.url()))) writes.push(request) })
  await page.goto('/lnk')
  const restore = async () => {
    await page.locator('header').getByRole('button', { name: 'Официальность', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
    await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
    await dialog.getByRole('button').filter({ hasText: `${lineName} · ${joint}` }).click()
    await dialog.getByRole('button', { name: /^Официальный/ }).click()
    await dialog.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  await restore()
  const manager = await openManager(page)
  const remove = manager.getByRole('button', { name: 'Удалить результат', exact: true })
  await expect(remove).toBeEnabled()
  await remove.click()
  // Deletion is staged, like replacement; consent is requested only on Save.
  expect((await stored(id)).uzk_result).toBe('ремонт')
  expect(writes).toHaveLength(0)
  await manager.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  const confirm = lnkResultConfirmation(page)
  await confirm.getByRole('button', { name: 'Вернуться к редактированию', exact: true }).click()
  expect((await stored(id)).uzk_result).toBe('ремонт')
  expect(writes).toHaveLength(0)
  const before = await stored(id)
  await manager.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await confirmLnkResultChanges(page)
  await expect.poll(async () => (await stored(id)).uzk_result).not.toBe('ремонт')
  expect(writes).toHaveLength(1)
  await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный',uzk_result='ремонт',
    uzk_conclusion='UG-UZK-C',uzk_conclusion_date='2026-09-03',final_status='не годен' where id=$1`, [id]))
  const current = await stored(id), request = writes[0], body = request.postData()!, headers = await request.allHeaders()
  delete headers['content-length']
  expect(body).toContain(`"${before.version}"`)
  const response = await page.request.post(request.url(), { headers, data: body.replaceAll(`"${before.version}"`, `"${current.version}"`) })
  expect(await response.text()).toContain('последний негодный результат')
  expect(await stored(id)).toEqual(current)
  expect(errors).toEqual([])
})

test('старый неофициальный стык: последний негодный дубль не удаляется; предупреждение без потери данных', async ({ page }) => {
  const id = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set uzk_result='годен' where id=$1`, [id])
    await db.query(`insert into duplicate_controls(weld_joint_id,method,result,control_date,conclusion,conclusion_date)
      values ($1,'УЗК','ремонт','2026-09-04','UG-DUP','2026-09-04')`, [id])
  })
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const registry = page.getByRole('dialog')
  await registry.getByRole('button', { name: /Внесенные дубли/ }).click()
  await registry.getByRole('button', { name: 'Удалить', exact: true }).click()
  const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Удалить дубль-контроль', exact: true }) })
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(registry.getByRole('alert')).toContainText('последний негодный результат')
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int n from duplicate_controls where weld_joint_id=$1', [id])).rows[0].n)).toBe(1)
  expect(errors).toEqual([])
})

test('дубль-контроль не позволяет внести любой результат неофициальному стыку', async ({ page }) => {
  const id = await seed()
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  await expect(dialog.getByText('Найдено: 1 · Выбрано: 0', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await dialog.getByRole('button', { name: 'УЗК', exact: true }).click()
  for (const result of ['годен', 'ремонт', 'вырез']) {
    await expect(dialog.getByRole('group', { name: 'Результат', exact: true }).getByRole('button', { name: result, exact: true })).toBeDisabled()
  }
  await expect(dialog.getByRole('button', { name: 'Добавить дубль', exact: true })).toBeDisabled()
  await expect(dialog.getByText(/Сначала верните стыку официальность/)).toBeVisible()
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int as n from duplicate_controls where weld_joint_id=$1', [id])).rows[0].n)).toBe(0)
  expect((await stored(id)).uzk_result).toBe('ремонт')
})

test('НК до ТО: предупреждение и запрет удаления последнего негодного результата', async ({ page }) => {
  const id = await seed(), errors: string[] = [], writes: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('correctPreHeatTreatment')) writes.push(request.url()) })
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set uzk_result=null,uzk_request=null,uzk_request_date=null,
      uzk_conclusion=null,uzk_conclusion_date=null,psto_required='да' where id=$1`, [id])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      values ($1,'УЗК','UG-PRE-UZK','2026-09-02','ремонт','UG-PRE-UZK-C','2026-09-03')`, [id])
  })
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  await page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'До ТО', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК до ТО', exact: true }) })
  await dialog.getByPlaceholder('Стык, линия, заявка или заключение').fill(joint)
  await dialog.getByRole('button').filter({ hasText: 'UG-PRE-UZK-C' }).click()
  await expect(dialog.getByRole('button', { name: 'Удалить результат', exact: true })).toBeDisabled()
  await expect(dialog.getByText(/последний негодный результат/)).toBeVisible()
  expect(writes).toEqual([])
  expect(await withE2eDatabase(async db => (await db.query('select result from pre_heat_treatment_controls where weld_joint_id=$1', [id])).rows[0].result)).toBe('ремонт')
  expect(errors).toEqual([])
})
