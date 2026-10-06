import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { programApprovalKey } from '../../src/lib/program-control-approval'
import { rpcName } from '../rpc'

test.afterEach(() => cleanupLineProgramProjects(['E2E exception objects']))

test('согласование переживает 30→50 и 100→50; исключение показывает новое имя и исчезает с объектом', async ({ page }) => {
  const seeded = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query("insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ('E2E exception objects','APPROVED','APPROVED-LINE','II','A',30,10) returning id")
    const { rows: [joint] } = await db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,category,group_name,weld_control_percent,pvk_control_percent,has_vik,stamp_1_k,has_rk,has_uzk,rk_result,rk_conclusion,uzk_result,uzk_conclusion)
      values ($1,'E2E exception objects','APPROVED','APPROVED-LINE','F934','2026-09-01','С17','II','A',30,10,'да','APPROVED-K','да','да','годен','KEEP-RK','годен','KEEP-UZK') returning id`, [line.id])
    const key = programApprovalKey({ id: joint.id, hasRk: 'да', hasUzk: 'да' }, 'common', true)
    await db.query("insert into dispatcher_accepted_warnings (key,kind,title,context,weld_joint_id) values ($1,'line-program-control','Согласован лишний контроль','Проект: E2E exception objects · Линия: APPROVED-LINE · РК - УЗК',$2)", [key, joint.id])
    return { lineId: line.id, jointId: joint.id, key }
  })
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/percentage-lines')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill('APPROVED-LINE')
  const card = program.getByTestId('line-program-card')
  await expect(card).toHaveCount(1)
  for (const percent of [50, 100, 50]) {
    await program.getByRole('button', { name: 'Настроить', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Настройка линии', exact: true })
    await editor.getByLabel('Базовый % контроля', { exact: true }).fill(String(percent))
    await editor.getByRole('button', { name: 'Сохранить программу' }).click()
    await expect(editor).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Лишнее 0', exact: true })).toBeVisible()
  }
  await program.getByRole('button', { name: 'Настроить', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Настройка линии', exact: true })
  await editor.getByLabel('Линия', { exact: true }).fill('RENAMED-APPROVED')
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await page.getByRole('button', { name: 'Изменить всю линию', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Принятые исключения', exact: true }).click()
  await expect(page.getByText('Линия: RENAMED-APPROVED', { exact: true })).toBeVisible()
  await expect(page.getByText('Стык: F934', { exact: true })).toBeVisible()
  expect(calls.filter(name => name.startsWith('listDispatcherAcceptedWarnings'))).toHaveLength(1)
  await page.getByLabel('Поиск принятых исключений').fill('RENAMED-APPROVED')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await withE2eDatabase(async db => {
    expect((await db.query('select key from dispatcher_accepted_warnings where weld_joint_id=$1', [seeded.jointId])).rows).toEqual([{ key: seeded.key }])
    expect((await db.query('select rk_conclusion,uzk_conclusion from weld_joints where id=$1', [seeded.jointId])).rows).toEqual([{ rk_conclusion: 'KEEP-RK', uzk_conclusion: 'KEEP-UZK' }])
    // The lifecycle is enforced by object FKs, independent of the deletion entry point.
    await db.query('delete from weld_joints where id=$1', [seeded.jointId])
  })
  await page.getByRole('button', { name: 'Обновить принятые исключения', exact: true }).click()
  await expect(page.getByText('Найдено: 0', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
