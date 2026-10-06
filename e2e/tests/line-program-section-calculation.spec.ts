import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E section calculation'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('верхний итог: 5 + 7, все страницы, ПКМ и Ещё, адаптивность и только выбранная линия загружает детали', async ({ page }) => {
  await withE2eDatabase(async db => {
    await db.query(`insert into line_programs (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent)
      select $1, 'SEC', 'TOTAL-' || lpad(n::text, 2, '0'), 'II', 'A', 10, 0 from generate_series(1,61) n`, [project])
    await db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      category,group_name,weld_control_percent,pvk_control_percent,has_vik,has_pvk,stamp_1_k,officiality,revision_actuality,
      welding_method,material_group,d1,d2,t1,t2,wdi,isometry,spool,vik_control_basis,rk_control_basis,pvk_control_basis)
      select l.id, l.project_title, l.subtitle_code, l.line, 'F'||n, date '2026-09-01', 'СШ', 'II','A',10,0,'да',
      case when l.line='TOTAL-01' and n=1 then 'дополнительный' end, 'SECTION-A','действующий','актуальная',
      'РД','M01',108,108,4,4,0.42,'ISO-SEC','S1','проект','проект','проект'
      from line_programs l cross join lateral generate_series(1,case when l.line='TOTAL-01' then 50 else 70 end) n
      where l.project_title=$1 and l.line in ('TOTAL-01','TOTAL-61')`, [project])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  const program = page.getByTestId('line-program'), totals = program.getByLabel('Итоги раздела')
  await program.getByLabel('Поиск программы линий').fill(project)
  await expect(totals.getByRole('button', { name: 'Линий 61', exact: true })).toBeVisible()
  const needed = totals.getByRole('button', { name: 'К назначению 12', exact: true })
  await needed.click()
  await expect(program.getByTestId('line-program-card')).toHaveCount(2)
  await needed.click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Расчёт', exact: true }).click()
  const aggregate = page.getByRole('dialog', { name: 'Расчёт · итоги раздела', exact: true })
  await expect(aggregate.getByLabel('Показатель общего расчёта')).toHaveValue('missing')
  await expect(aggregate.getByTestId('section-calculation-total')).toHaveText('К назначению12РК - УЗК: 12 · ПВК: 0')
  await expect(aggregate.getByTestId('section-calculation-line')).toHaveCount(50)
  await expect(aggregate.getByTestId('section-calculation-line').first()).toContainText('5РК - УЗК: 5 · ПВК: 0')
  const close = aggregate.getByRole('button', { name: 'Закрыть общий расчёт' })
  await close.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(aggregate.getByRole('button', { name: 'Вернуться к линиям' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await aggregate.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await aggregate.getByTestId('section-calculation-line').evaluateAll(rows => rows.every(el => el.scrollWidth <= el.clientWidth))).toBe(true)
    await page.screenshot({ path: `outputs/section-calculation-${width}.png` })
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await aggregate.getByRole('button', { name: 'Страница 2', exact: true }).click()
  await expect(aggregate.getByTestId('section-calculation-line')).toHaveCount(11)
  await expect(aggregate.getByTestId('section-calculation-line').last()).toContainText('7РК - УЗК: 7 · ПВК: 0')
  await close.click()
  await expect(needed).toBeFocused()
  await totals.getByRole('button', { name: 'Ещё показатели контроля' }).click()
  await page.getByRole('dialog', { name: 'Другие показатели контроля' }).getByRole('button', { name: 'Дополнительные стыки: 1' }).click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Расчёт', exact: true }).click()
  await expect(aggregate.getByLabel('Показатель общего расчёта')).toHaveValue('additional')
  await expect(aggregate.getByTestId('section-calculation-total')).toHaveText('Дополнительные стыки1')
  await close.click()
  await needed.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Расчёт', exact: true }).click()
  await aggregate.getByRole('button', { name: 'Страница 2', exact: true }).click()
  const count = (prefix: string) => calls.filter(name => name.startsWith(prefix)).length
  expect(count('getLineProgramSection_')).toBe(1)
  expect(count('getLineProgramCalculation_')).toBe(0)
  expect(count('getLineProgramExplanation_')).toBe(0)
  expect(count('getLineProgramJointPage_')).toBe(0)
  await aggregate.getByRole('button', { name: 'Подробнее · TOTAL-61', exact: true }).click()
  const detail = page.getByRole('dialog', { name: 'Расчёт · TOTAL-61', exact: true })
  await expect(detail.getByTestId('demand-common')).toContainText('Расчётная норма 7')
  await expect(detail.getByRole('region', { name: 'Подробности расчёта' })).toContainText('К назначению')
  await expect.poll(() => count('getLineProgramExplanation_')).toBe(1)
  expect(count('getLineProgramCalculation_')).toBe(1)
  expect(count('getLineProgramJointPage_')).toBe(0)
  expect(errors).toEqual([])
})
