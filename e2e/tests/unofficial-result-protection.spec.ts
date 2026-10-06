import { expect, test, type Page, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

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

test('негодный неофициальный: запрет годного результата, отдельное восстановление официальности и защита от старого клиента', async ({ page }) => {
  const id = await seed(), writes: Request[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('updateWeldJoints_')) writes.push(request) })
  await page.goto('/lnk')
  let manager = await openManager(page)
  await expect(manager.getByRole('button', { name: 'годен', exact: true }).last()).toBeDisabled()
  await expect(manager.getByText(/Сначала верните стыку официальность/)).toBeVisible()
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

test('дубль-контроль не позволяет внести любой результат неофициальному стыку', async ({ page }) => {
  const id = await seed()
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  await expect(dialog.getByText('Найдено: 1 · Выбрано: 0', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await dialog.getByRole('button', { name: 'УЗК', exact: true }).click()
  for (const result of ['годен', 'ремонт', 'вырез']) await expect(dialog.getByRole('option', { name: result, exact: true })).toHaveJSProperty('disabled', true)
  await expect(dialog.getByRole('button', { name: 'Добавить дубль', exact: true })).toBeDisabled()
  await expect(dialog.getByText(/Сначала верните стыку официальность/)).toBeVisible()
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int as n from duplicate_controls where weld_joint_id=$1', [id])).rows[0].n)).toBe(0)
  expect((await stored(id)).uzk_result).toBe('ремонт')
})
