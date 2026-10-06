import { rpcName } from '../rpc'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

test.afterEach(() => cleanupLineProgramProjects(['E2E impact']))

test('карточка: запрет очистки виден сразу; влияние на линию только по нажатию и без записи', async ({ page }) => {
  const id = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query("insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ('E2E impact','IMPACT','CARD-IMPACT','II','A',100,10) returning id")
    await db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,category,group_name,weld_control_percent,pvk_control_percent,has_vik,stamp_1_k,officiality,has_pvk,pvk_request,pvk_result,pvk_conclusion)
      select $1,'E2E impact','IMPACT','CARD-IMPACT','F989'||n,date '2026-09-01','СШ','II','A',100,10,'да','IMPACT-A','действующий','да','PVK-1','годен','PVK-CONCLUSION' from generate_series(1,2) n`, [line.id])
    return line.id
  })
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const id = new URL(request.url()).pathname.split('/_serverFn/')[1]
    if (id) try { calls.push(rpcName(request.url())) } catch { /* production ID */ }
  })
  await page.goto('/journal')
  await page.getByRole('button', { name: 'F9891', exact: true }).locator('xpath=ancestor::tr').getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  await expect(editor.getByText(/Программа линии: базовый 100%/)).toBeVisible()
  await editor.getByRole('button', { name: 'Назначение контроля', exact: true }).click()
  const pvk = editor.getByText('Назначение ПВК', { exact: true }).locator('..')
  await expect(pvk.getByRole('button', { name: 'Пусто', exact: true })).toBeDisabled()
  await expect(pvk.getByRole('button', { name: 'Отменен', exact: true })).toBeEnabled()
  const rk = editor.getByText('Назначение РК', { exact: true }).locator('..')
  await rk.getByRole('button', { name: 'Да', exact: true }).click()
  const impact = editor.getByRole('button', { name: 'Влияние изменений на линию' })
  await expect(impact).toBeVisible()
  expect(calls.filter(call => call.startsWith('getWeldLineProgramImpact_'))).toHaveLength(0)
  await impact.click()
  await expect(editor.getByRole('status')).toContainText('К назначению: 2 → 1')
  await expect(editor.getByRole('status')).toContainText('Изменение закрывает недобор')
  expect(calls.filter(call => call.startsWith('getWeldLineProgramImpact_'))).toHaveLength(1)
  await rk.getByRole('button', { name: 'Дополнительный', exact: true }).click()
  await expect(editor.getByText(/пересчитайте влияние/)).toBeVisible()
  expect(calls.filter(call => call.startsWith('getWeldLineProgramImpact_'))).toHaveLength(1)
  await withE2eDatabase(async db => {
    const result = await db.query('select has_rk,pvk_result,pvk_conclusion from weld_joints where line_program_id=$1', [id])
    expect(result.rows.every(row => row.has_rk === null && row.pvk_result === 'годен' && row.pvk_conclusion === 'PVK-CONCLUSION')).toBe(true)
  })
  expect(errors).toEqual([])
})
