import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { programApprovalKey } from '../../src/lib/program-control-approval'

const project = 'E2E inactive joints'
test.afterEach(() => cleanupLineProgramProjects([project]))

for (const percent of [10, 100]) test(`неофициальные и неактуальные: пометки и нулевой вклад в показатели при ${percent}%`, async ({ page }) => {
  const name = `INACTIVE-${percent}`
  await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'INACTIVE',$2,'II','A',$3,$3) returning id`, [project, name, percent])
    const { rows } = await db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      category,group_name,weld_control_percent,pvk_control_percent,has_vik,has_rk,has_uzk,has_pvk,stamp_1_k,officiality,revision_actuality,
      welding_method,material_group,d1,d2,t1,t2,wdi,isometry,spool,vik_control_basis,rk_control_basis,uzk_control_basis,pvk_control_basis)
      select $1,$2,'INACTIVE',$3,'F'||n,date '2026-09-05','У19','II','A',$4,$4,'да','дополнительный','да','дополнительный','D501',
      case when n in (2,4) then 'неофициальный' else 'действующий' end,
      case when n in (3,4) then 'не актуален' else 'актуальная' end,
      'РД','M01',108,108,4,4,0.42,'ISO-INACTIVE','S1','проект','проект','проект','проект'
      from generate_series(1,4) n returning id,has_rk as "hasRk",has_uzk as "hasUzk"`, [line.id, project, name, percent])
    for (const row of rows) await db.query(`insert into dispatcher_accepted_warnings (key,kind,title,context,weld_joint_id)
      values ($1,'line-program-control','Согласованы методы','E2E',$2)`, [programApprovalKey(row, 'common', true), row.id])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  const program = page.getByTestId('line-program'), totals = program.getByLabel('Итоги раздела')
  await program.getByLabel('Поиск программы линий').fill(name)
  const card = program.getByTestId('line-program-card')
  await expect(card).toHaveCount(1)
  await expect(totals.getByRole('button', { name: 'Учитываемых соединений 1', exact: true })).toBeVisible()
  await totals.getByRole('button', { name: 'Ещё показатели контроля' }).click()
  const more = page.getByRole('dialog', { name: 'Другие показатели контроля' })
  await expect(more.getByRole('button', { name: 'Дополнительные стыки: 1', exact: true })).toBeVisible()
  await expect(more.getByRole('button', { name: 'Согласовано: 1', exact: true })).toBeVisible()
  await more.press('Escape')
  await card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  const all = program.getByRole('button', { name: 'Все стыки линии', exact: true })
  if (await all.getAttribute('aria-expanded') !== 'true') await all.click()
  const joints = program.getByTestId('line-program-readonly-joint')
  await expect(joints).toHaveCount(4)
  await expect(joints.nth(0).getByTestId('program-joint-exclusions')).toHaveCount(0)
  await expect(joints.nth(1).getByTestId('program-joint-exclusions')).toHaveText('Неофициальный')
  await expect(joints.nth(2).getByTestId('program-joint-exclusions')).toHaveText('Неактуальный')
  await expect(joints.nth(3).getByTestId('program-joint-exclusions')).toHaveText('НеофициальныйНеактуальный')
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await joints.locator('td:first-child').evaluateAll(cells => cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true)
    await joints.nth(3).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `outputs/line-program-inactive-${percent}-${width}.png` })
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  for (const label of ['Дополнительные стыки: 1', 'Согласовано: 1']) {
    await card.getByRole('button', { name: 'Ещё показатели контроля' }).click()
    await more.getByRole('button', { name: label, exact: true }).click()
    await expect(joints).toHaveCount(1)
    await expect(joints.first()).toHaveAttribute('data-joint', 'F1')
  }
  await card.getByRole('button', { name: 'Учитываемых соединений 1', exact: true }).click()
  await expect(joints).toHaveCount(4)
  await program.getByRole('button', { name: /^Назначения/ }).last().click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${name}`, exact: true })
  await expect(editor.getByTestId('program-joint-exclusions')).toHaveCount(3)
  for (const joint of ['F2', 'F3', 'F4']) await expect(editor.getByRole('combobox', { name: `${joint} · РК`, exact: true })).toBeDisabled()
  await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await joints.nth(1).getByRole('button', { name: 'F2', exact: true }).click()
  await expect(joints.nth(1).getByRole('button', { name: 'F2', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  const count = (prefix: string) => calls.filter(name => name.startsWith(prefix)).length
  expect(count('getLineProgramSection_')).toBe(1)
  expect(count('getLineProgramCalculation_')).toBe(1)
  expect(count('getLineProgramJointPage_')).toBe(1)
  expect(count('getLineProgramExplanation_')).toBe(0)
  expect(errors).toEqual([])
  expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int as n from dispatcher_accepted_warnings a
    join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1`, [project])).rows[0].n)).toBe(4)
})
