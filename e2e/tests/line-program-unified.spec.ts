import { rpcName } from '../rpc'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { calculateLineProgram } from '../../src/lib/line-program-calculation'
import { programExcessEntries } from '../../src/lib/line-program-workspace'

test.afterEach(() => cleanupLineProgramProjects(['E2E unified']))

async function seed(name: string, percent: number, count: number) {
  return withE2eDatabase(async db => {
    await db.query("delete from weld_joints where project_title='E2E unified' and line=$1", [name])
    await db.query("delete from line_programs where project_title='E2E unified' and line=$1", [name])
    const { rows: [line] } = await db.query(`insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ('E2E unified','UNI',$1,'II','A',$2,10) returning id`, [name, percent])
    await db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,category,group_name,weld_control_percent,pvk_control_percent,has_vik,stamp_1_k,stamp_1_k_fact,officiality,revision_actuality,welding_method,material_group,d1,d2,t1,t2,wdi,isometry,spool,vik_control_basis,rk_control_basis,uzk_control_basis,pvk_control_basis)
      select $1,'E2E unified','UNI',$2,'F'||n,case when $3=100 and n=1 then null else date '2026-09-01' end,case when n=2 then 'У17' else 'СШ' end,'II','A',$3,10,'да',case when $3=100 and n=1 then null else 'UNIFIED-A' end,case when $3=100 and n=1 then null else 'UNIFIED-A' end,'действующий','актуальная','РД','M01',108,108,4,4,0.42,'ISO-UNI','S1','проект','проект','проект','проект' from generate_series(1,$4::int) n`, [line.id, name, percent, count])
    const existing = await db.query("select 1 from welder_stamps where naks_stamp='UNIFIED-A'")
    if (!existing.rows.length) await db.query(`insert into welder_stamps (naks_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits)
      values ('UNIFIED-A','E2E unified','РД','M01','1','1000','1','100','2026-01-01','2026-12-31','[{"id":"unified","weldType":"РД","materialGroups":"M01","diameterFrom":"1","diameterTo":"1000","thicknessFrom":"1","thicknessTo":"100","validFrom":"2026-01-01","validTo":"2026-12-31","archived":false}]')`)
    return line.id as number
  })
}
async function openLine(page: Page, name: string) {
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(name)
  await expect(program.getByTestId('line-program-card')).toHaveCount(1)
  await program.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  return program
}

async function openAssignments(page: Page) {
  await page.getByTestId('line-program').getByRole('button', { name: /^Назначения/ }).last().click()
  return page.getByRole('dialog', { name: /^Назначения ·/ })
}

test('семь UX-уточнений: соединения и записи, этапы, видимая потребность и доступные действия', async ({ page }) => {
  const name = 'UNIFIED-INTERFACE-CLARITY', id = await seed(name, 12, 5)
  await withE2eDatabase(db => db.query(`update weld_joints set
    weld_date=case when joint in ('F1','F2') then null else date '2026-09-05' end,
    stamp_1_k=case when joint in ('F1','F2') then null else 'UNIFIED-A' end,
    vik_result=case when joint='F3' then 'ожидает НК' when joint='F5' then 'годен' end,
    vik_request=case when joint='F4' then 'V-4' end,
    revision_actuality=case when joint='F5' then 'не актуален' else 'актуальная' end
    where line_program_id=$1`, [id]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  const program = await openLine(page, name), card = program.getByTestId('line-program-card')
  await expect(card).toHaveClass(/border-amber-300/)
  await expect(card.getByRole('button', { name: 'Учитываемых соединений 4', exact: true })).toBeVisible()
  await expect(card.getByTestId('line-missing-breakdown')).toHaveText('РК/УЗК: 1 · ПВК: 1')
  const summary = card.getByTestId('line-program-stamp')
  await summary.getByTestId('stamp-control-state-compact').locator('summary').click()
  const stages = summary.getByLabel('Этапы незавершённых соединений')
  await expect(stages).toHaveText('Ожидают заявку1Ожидают контроль1')
  await card.getByTestId('line-program-unassigned').getByTestId('stamp-control-state-compact').locator('summary').click()
  await expect(card.getByTestId('line-program-unassigned').getByLabel('Этапы незавершённых соединений')).toHaveText('До сварки2')
  await expect(summary.getByTestId('stamp-control-state')).toContainText('Не завершено: 2')
  await expect(summary.getByTestId('program-demand-breakdown')).toBeVisible()
  await expect(card.getByRole('table', { name: 'Расчёт по клеймам', exact: true }).locator('thead').first().getByRole('columnheader')).toHaveText(['Клеймо', 'Соединений', 'Состояние', 'Зачтено / нужно', 'Назначения', 'К назначению', 'Расчёт', 'Результаты'])
  await expect(summary.getByTestId('program-assignment-demand').getByTestId('program-demand-breakdown')).toBeVisible()
  await expect(summary.locator('td').last().getByTestId('program-demand-breakdown')).toHaveCount(0)
  await card.getByRole('button', { name: 'Учитываемых соединений 4', exact: true }).click()
  const heading = card.getByTestId('program-scope-actions')
  await expect(card.getByTestId('program-workspace-heading')).toHaveCount(0)
  await expect(heading).not.toContainText(name)
  await expect(heading.getByRole('button', { name: /^Назначения/ })).toHaveClass(/bg-sky-50/)
  await expect(heading.getByRole('button', { name: /^Расчёт/ })).toHaveClass(/bg-white/)
  await expect(card.getByTestId('line-program-readonly-joint')).toHaveCount(5)
  await expect(card.getByText('Неактуальный', { exact: true })).toBeVisible()
  for (const width of [1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    if (width === 390 && await page.getByRole('button', { name: 'Скрыть меню', exact: true }).count()) { await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click(); await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px') }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await card.locator('button:visible').evaluateAll(buttons => buttons.filter(button => {
      const rect = button.getBoundingClientRect()
      return rect.width < 24 || rect.height < 24 || button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight
    }).map(button => ({ text: button.textContent, width: button.clientWidth, scrollWidth: button.scrollWidth, height: button.clientHeight, scrollHeight: button.scrollHeight })))).toEqual([])
    await page.screenshot({ path: `outputs/line-program-interface-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1600, height: 1100 })
  await heading.getByRole('button', { name: /^Расчёт/ }).click()
  await page.getByRole('button', { name: 'Закрыть расчёт', exact: true }).press('Escape')
  await expect(heading.getByRole('button', { name: /^Расчёт/ })).toBeFocused()
  const editor = await openAssignments(page)
  await expect(editor.getByRole('combobox', { name: 'F5 · РК', exact: true })).toBeDisabled()
  await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  const count = (prefix: string) => calls.filter(name => name.startsWith(prefix)).length
  expect(count('getLineProgramSection_')).toBe(1)
  expect(count('getLineProgramCalculation_')).toBe(1)
  expect(count('getLineProgramJointPage_')).toBe(1)
  expect(count('getLineProgramExplanation_')).toBe(0)
  expect(errors).toEqual([])
})

test('зелёная рамка только у завершённой линии, без влияния исключённых записей и дополнительных запросов', async ({ page }) => {
  const prefix = 'UNIFIED-FINISHED-'
  for (const [suffix, count] of [['DONE', 3], ['WAIT', 1], ['REJECT', 1], ['ERROR', 1], ['EMPTY', 0], ['MISSING', 1], ['UNKNOWN', 1]] as const) await seed(prefix + suffix, 12, count)
  await withE2eDatabase(async db => {
    await db.query("update weld_joints set has_rk='да',has_pvk='да',vik_result='годен',rk_result='годен',pvk_result='годен' where line like $1", [prefix + '%'])
    await db.query("update weld_joints set officiality='неофициальный',vik_result='ремонт' where line=$1 and joint='F2'", [prefix + 'DONE'])
    await db.query("update weld_joints set revision_actuality='не актуален',has_rk=null where line=$1 and joint='F3'", [prefix + 'DONE'])
    await db.query("update weld_joints set rk_result=null where line=$1", [prefix + 'WAIT'])
    await db.query("update weld_joints set vik_result='ремонт',rk_result=null,pvk_result=null where line=$1", [prefix + 'REJECT'])
    await db.query("update weld_joints set has_rk=null where line=$1", [prefix + 'ERROR'])
    await db.query("update weld_joints set has_rk=null,rk_result=null,has_pvk=null,pvk_result=null where line=$1", [prefix + 'MISSING'])
    await db.query("update line_programs set weld_control_percent=null,pvk_control_percent=null where line=$1", [prefix + 'UNKNOWN'])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(prefix)
  await expect(program.getByTestId('line-program-card')).toHaveCount(7)
  const card = (suffix: string) => program.locator(`[data-testid="line-program-card"][data-line="${prefix + suffix}"]`)
  await expect(card('DONE')).toHaveClass(/border-emerald-300/)
  await expect(card('DONE')).toHaveAttribute('data-program-finished', 'true')
  await expect(card('DONE')).toHaveCSS('border-color', 'rgb(110, 231, 183)')
  for (const suffix of ['WAIT', 'REJECT', 'ERROR', 'EMPTY', 'MISSING', 'UNKNOWN']) {
    await expect(card(suffix)).not.toHaveClass(/border-emerald-/)
    await expect(card(suffix)).toHaveAttribute('data-program-finished', 'false')
  }
  await expect(card('WAIT').getByRole('button', { name: 'К назначению 0', exact: true })).toBeVisible()
  await expect(card('REJECT').getByRole('button', { name: 'К назначению 0', exact: true })).toBeVisible()
  expect(calls.filter(name => name.startsWith('getLineProgramSection_'))).toHaveLength(1)
  expect(calls.some(name => name.startsWith('getLineProgramCalculation_') || name.startsWith('getLineProgramJointPage_'))).toBe(false)
  await page.screenshot({ path: 'outputs/line-program-finished-border.png', fullPage: true })
  await card('DONE').getByRole('button', { name: 'Учитываемых соединений 1', exact: true }).click()
  await expect(card('DONE').getByTestId('line-program-readonly-joint')).toHaveCount(3)
  await expect(card('DONE').getByText('Неофициальный', { exact: true })).toBeVisible()
  await expect(card('DONE').getByText('Неактуальный', { exact: true })).toBeVisible()
  await expect(card('DONE')).toHaveClass(/border-emerald-300/)
  for (const result of [null, 'годен']) {
    await withE2eDatabase(db => db.query("update weld_joints set rk_result=$1 where line=$2 and joint='F1'", [result, prefix + 'DONE']))
    await page.reload()
    await program.getByLabel('Поиск программы линий').fill(prefix)
    await expect(card('DONE')).toHaveAttribute('data-program-finished', String(result === 'годен'))
    if (result) await expect(card('DONE')).toHaveClass(/border-emerald-300/)
    else await expect(card('DONE')).toHaveClass(/border-slate-200/)
  }
  expect(calls.filter(name => name.startsWith('getLineProgramCalculation_'))).toHaveLength(1)
  expect(calls.filter(name => name.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('цвета назначений и мягкая подсветка итогового состояния в списке и окне назначений', async ({ page }) => {
  const name = 'UNIFIED-COLOR-STATES', id = await seed(name, 12, 6)
  await withE2eDatabase(db => db.query(`update weld_joints set
    vik_result=case when joint='F2' then 'ремонт' when joint!='F6' then 'годен' end,
    has_rk=case when joint='F3' then 'да' when joint='F4' then 'отменен' end,
    rk_result=case when joint='F4' then 'вырез' end,
    revision_actuality=case when joint='F5' then 'не актуален' else 'актуальная' end
    where line_program_id=$1`, [id]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  const program = await openLine(page, name), card = program.getByTestId('line-program-card')
  await card.getByRole('button', { name: 'Учитываемых соединений 5', exact: true }).click()
  const joint = (name: string) => card.locator(`[data-testid="line-program-readonly-joint"][data-joint="${name}"]`)
  for (const name of ['F1', 'F5']) await expect(joint(name)).toHaveClass(/bg-emerald-50\/70/)
  for (const name of ['F2', 'F4']) await expect(joint(name)).toHaveClass(/bg-rose-50\/70/)
  for (const name of ['F3', 'F6']) await expect(joint(name)).not.toHaveClass(/bg-(emerald|rose)-/)
  await expect(joint('F3').getByText('РК: да', { exact: true })).toHaveCSS('color', 'rgb(4, 120, 87)')
  await expect(joint('F4').getByText('РК: отменен', { exact: true })).toHaveCSS('color', 'rgb(190, 18, 60)')
  await expect(joint('F5').getByText('Неактуальный', { exact: true })).toBeVisible()
  const checkTint = async (row: Locator, good: boolean) => {
    const rgb = await row.evaluate(el => getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.map(Number))
    expect(rgb[3] ?? 1).toBeGreaterThan(0)
    expect(good ? rgb[1] > rgb[0] : rgb[0] > rgb[1]).toBe(true)
  }
  await joint('F2').getByRole('button', { name: 'F2', exact: true }).click()
  await joint('F2').hover()
  await checkTint(joint('F2'), false)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'outputs/line-program-colors-list.png', fullPage: true })
  const editor = await openAssignments(page)
  const editRow = (name: string) => editor.getByRole('checkbox', { name: `Выбрать ${name}`, exact: true }).locator('xpath=ancestor::tr')
  for (const [name, good] of [['F1', true], ['F2', false], ['F4', false], ['F5', true]] as const) {
    await checkTint(editRow(name), good)
    await expect(editRow(name)).toHaveClass(good ? /bg-emerald-50\/70/ : /bg-rose-50\/70/)
  }
  await expect(editRow('F3')).not.toHaveClass(/bg-(emerald|rose)-/)
  await expect(editRow('F5').getByText('Неактуальный', { exact: true })).toBeVisible()
  await expect(editor.getByRole('combobox', { name: 'F5 · РК', exact: true })).toBeDisabled()
  await editor.getByRole('checkbox', { name: 'Выбрать F2', exact: true }).check()
  await expect(editRow('F2')).toHaveAttribute('data-highlighted', 'true')
  await checkTint(editRow('F2'), false)
  await editor.getByRole('combobox', { name: 'F1 · РК', exact: true }).selectOption('да')
  await expect(editRow('F1')).toHaveAttribute('data-final-status', 'годен')
  await checkTint(editRow('F1'), true)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'outputs/line-program-colors-assignments.png' })
  expect(calls.filter(name => name.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(calls.filter(name => name.startsWith('getLineProgramCalculation_'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('спокойная иерархия: расчёт в модальном окне, разбивка и стыки независимы, без скрытых запросов', async ({ page }) => {
  const name = 'UNIFIED-VISUAL-HIERARCHY', id = await seed(name, 10, 5)
  await withE2eDatabase(db => db.query("update weld_joints set has_pvk=case when joint='F1' then 'да' end where line_program_id=$1", [id]))
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const program = await openLine(page, name)
  const summary = null, stamp = program.getByTestId('line-program-stamp')
  const headings = program.getByRole('table', { name: 'Расчёт по клеймам' }).locator('thead').first().getByRole('columnheader')
  await expect(headings).toHaveText(['Клеймо', 'Соединений', 'Состояние', 'Зачтено / нужно', 'Назначения', 'К назначению', 'Расчёт', 'Результаты'])
  await expect(program.getByTestId('line-program-summary')).toHaveCount(0)
  await expect(stamp).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await stamp.getByTestId('stamp-control-state-compact').locator('summary').click()
  const controls = stamp.getByTestId('stamp-control-state')
  for (const label of ['Годен:', 'Не годен:']) {
    const badge = controls.getByText(label, { exact: true }).locator('..')
    await expect(badge).toHaveText(label + ' 0')
    await expect(badge).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  }
  const waiting = controls.getByText('Не завершено:', { exact: true }).locator('..')
  await expect(waiting).toHaveText('Не завершено: 5')
  await expect(waiting).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(program.getByText(/расчётная норма/)).toHaveCount(0)
  await expect(stamp.getByRole('button', { name: 'Результаты', exact: true })).toBeVisible()
  const callsBeforeDetails = calls.length
  for (const row of [summary, stamp]) {
    await (row === summary ? program.getByRole('button', { name: 'Расчёт линии', exact: true }) : row.getByRole('button', { name: /^Расчёт ·/ })).click()
    const calculation = page.getByRole('dialog', { name: `Расчёт · ${name}` })
    await expect(calculation.getByTestId('demand-common')).toContainText('Расчётная норма 1')
    await expect(calculation.getByLabel('Клеймо в расчёте')).toHaveValue(row === summary ? '' : 'UNIFIED-A')
    await calculation.getByRole('button', { name: 'Закрыть расчёт' }).click()
    const breakdown = stamp.getByTestId('program-demand-breakdown')
    await expect(breakdown.getByRole('button', { name: 'РК - УЗК: 1', exact: true })).toBeVisible()
    await expect(breakdown.getByText('ПВК: 0', { exact: true })).toBeVisible()
    await expect(breakdown.getByRole('button', { name: 'ПВК: 0', exact: true })).toHaveCount(0)
  }
  await expect(program.getByTestId('program-inline-calculation')).toHaveCount(0)
  expect(calls.length).toBe(callsBeforeDetails)
  await expect(program.getByTestId('program-workspace-heading')).toHaveCount(0)
  const trigger = stamp.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true })
  await trigger.click()
  const heading = program.getByTestId('program-scope-actions')
  await expect(program.getByTestId('program-workspace-heading')).toHaveCount(0)
  await expect(program.getByTestId('program-joint-workspace')).not.toHaveClass(/\bborder\b/)
  await expect(program.getByTestId('line-program-readonly-joint')).toHaveCount(5)
  // Clicking the stamp leaves the pointer over its intentionally retained hover highlight.
  await page.mouse.move(0, 0)
  await expect(stamp).toHaveCSS('background-color', 'rgb(241, 245, 249)')
  for (const width of [1000, 1800]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const collapsed of [false, true]) {
      const toggle = page.getByRole('button', { name: collapsed ? 'Скрыть меню' : 'Раскрыть меню', exact: true })
      if (await toggle.count()) await toggle.click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', collapsed ? '64px' : width < 1024 ? '192px' : '256px')
      expect(await headings.evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth).map(el => ({ text: el.textContent, width: el.clientWidth, scrollWidth: el.scrollWidth })))).toEqual([])
      expect(await headings.filter({ hasText: 'Соединений' }).evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element)
        return range.getClientRects().length
      })).toBe(1)
      expect(await controls.evaluate(element => {
        const bounds = element.closest('td')!.getBoundingClientRect()
        return [...element.querySelectorAll('*')].every(child => child.getBoundingClientRect().right <= bounds.right)
      })).toBe(true)
      for (const row of [stamp]) {
        expect(await row.evaluate(el => [...el.querySelectorAll('button')].every(button => button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight))).toBe(true)
        expect((await row.getByRole('button', { name: 'К назначению: 1', exact: true }).boundingBox())!.height).toBeLessThanOrEqual(48)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `outputs/line-program-details-${width}-${collapsed ? 'compact' : 'full'}.png` })
    }
  }
  await stamp.getByRole('button', { name: /^Расчёт ·/ }).click()
  await page.getByRole('button', { name: 'Закрыть расчёт' }).click()
  await expect(heading).toBeVisible()
  await expect(program.getByTestId('program-inline-calculation')).toHaveCount(0)
  await expect(stamp.getByTestId('program-demand-breakdown')).toBeVisible()
  const count = calls.length
  await trigger.click(); await trigger.click()
  await expect(heading).toBeVisible()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  expect(calls.length).toBe(count)
  await heading.getByRole('button', { name: /^Назначения/ }).click()
  await expect(page.getByRole('dialog', { name: `Назначения · ${name}` })).toBeVisible()
  expect(errors).toEqual([])
})

test('ПКМ показателей открывает их подробный расчёт, обычный клик сохраняет переход к стыкам', async ({ page }) => {
  const name = 'UNIFIED-METRIC-CALCULATION', id = await seed(name, 10, 5)
  await withE2eDatabase(db => db.query("update weld_joints set has_rk=case when joint in ('F1','F2','F3') then 'да' end, rk_result=case when joint='F3' then 'годен' end where line_program_id=$1", [id]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  const program = await openLine(page, name), stamp = program.getByTestId('line-program-stamp')
  const reads = () => calls.filter(name => name.startsWith('getLineProgramExplanation_')).length
  for (const [slice, label] of [['assigned', 'Назначенные стыки'], ['excess', 'Лишний контроль'], ['reduction', 'Безопасное сокращение']] as const) {
    const metric = stamp.locator(`[data-program-slice="${slice}"]`).first()
    await metric.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const before = reads()
    await metric.click({ button: 'right' })
    const menu = page.getByTestId('context-action-menu')
    await expect(menu).toContainText('Клеймо UNIFIED-A')
    expect(reads()).toBe(before)
    await menu.getByRole('button', { name: 'Расчёт', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Расчёт · ${name}` })
    await expect(dialog.getByLabel('Клеймо в расчёте')).toHaveValue('UNIFIED-A')
    await expect(dialog.getByLabel('Состав расчёта РК/УЗК')).toHaveValue(slice)
    await expect(dialog.getByRole('region', { name: 'Подробности расчёта' })).toContainText(label)
    await expect(dialog.getByRole('button', { name: 'Показать стыки в рабочей таблице' })).toBeVisible()
    expect(reads()).toBe(before + 1)
    if (slice === 'excess') await expect(dialog.getByRole('region', { name: 'Подробности расчёта' })).toContainText('обычное назначение сверх нормы')
    if (slice === 'reduction') await expect(dialog.getByRole('region', { name: 'Подробности расчёта' })).toContainText('Можно снять «Да»')
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    expect(reads()).toBe(before + 1)
    await dialog.screenshot({ path: `outputs/line-program-calculation-${slice}.png` })
    await dialog.getByRole('button', { name: 'Закрыть расчёт' }).click()
    await expect(program.getByTestId('program-workspace-heading')).toHaveCount(0)
  }
  await stamp.locator('[data-program-slice="assigned"]').first().click()
  await expect(program.getByTestId('line-program-readonly-joint')).toHaveCount(3)
  expect(reads()).toBe(3)
  expect(errors).toEqual([])
})

test('ПКМ в меню «Ещё»: дополнительный ПВК открывается мышью и с клавиатуры без повторного запроса', async ({ page }) => {
  const name = 'UNIFIED-MORE-CALCULATION', id = await seed(name, 10, 2)
  await withE2eDatabase(db => db.query("update weld_joints set has_pvk='дополнительный' where line_program_id=$1 and joint='F1'", [id]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  const program = await openLine(page, name)
  for (const keyboard of [false, true]) {
    await program.getByTestId('line-program-header').getByRole('button', { name: 'Ещё показатели контроля' }).click()
    const metric = page.getByRole('dialog', { name: 'Другие показатели контроля' }).getByRole('button', { name: 'Дополнительные стыки: 1' })
    if (keyboard) await metric.press('Shift+F10'); else await metric.click({ button: 'right' })
    await page.getByTestId('context-action-menu').getByRole('button', { name: 'Расчёт', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Расчёт · ${name}` })
    await expect(dialog.getByLabel('Клеймо в расчёте')).toHaveValue('')
    await expect(dialog.getByRole('group', { name: 'Метод подробного расчёта' }).getByRole('button', { name: 'ПВК' })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByLabel('Состав расчёта ПВК')).toHaveValue('additional')
    await expect(dialog.getByRole('button', { name: 'Показать стык F1 в журнале' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Закрыть расчёт' }).click()
  }
  expect(calls.filter(name => name.startsWith('getLineProgramExplanation_'))).toHaveLength(1)
  expect(calls.filter(name => name.startsWith('getLineProgramJointPage_'))).toHaveLength(0)
  expect(errors).toEqual([])
})

test('переключатели расчёта: единое оформление, длинные названия, узкое окно и клавиатура', async ({ page }) => {
  const name = 'UNIFIED-CALCULATION-CONTROLS'
  await seed(name, 10, 3)
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const program = await openLine(page, name)
  await program.getByRole('button', { name: 'Расчёт линии', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Расчёт · ${name}` })
  const scope = dialog.getByLabel('Клеймо в расчёте')
  await expect(scope).toHaveCSS('height', '40px')
  await scope.selectOption('UNIFIED-A')
  await dialog.getByTestId('demand-common').getByRole('button', { name: 'Из назначенных — с «доп» 0' }).click()
  const details = dialog.getByRole('region', { name: 'Подробности расчёта' })
  const methods = details.getByRole('group', { name: 'Метод подробного расчёта' })
  await expect(details.getByRole('button', { name: 'Показать стыки в рабочей таблице' })).toBeVisible()
  for (const width of [1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const select = details.getByLabel('Состав расчёта РК/УЗК')
    await expect(select).toHaveValue('additional')
    await expect(select).toHaveCSS('appearance', 'none')
    await expect(select).toHaveCSS('background-image', 'none')
    await expect(select).toHaveCSS('padding-right', '40px')
    await expect(select).toHaveCSS('height', '40px')
    await expect(methods).toHaveCSS('height', '40px')
    expect(await dialog.getByTestId('line-calculation-dialog-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await select.evaluate(el => {
      const rect = el.getBoundingClientRect(), arrow = el.parentElement!.querySelector('svg')!.getBoundingClientRect()
      return arrow.left >= rect.right - 40 && arrow.right < rect.right && arrow.top > rect.top && arrow.bottom < rect.bottom
    })).toBe(true)
    await scope.scrollIntoViewIfNeeded()
    await dialog.screenshot({ path: `outputs/calculation-scope-${width}.png` })
    await details.screenshot({ path: `outputs/calculation-controls-${width}.png` })
  }
  const pvk = methods.getByRole('button', { name: 'ПВК' })
  await pvk.focus(); await pvk.press('Space')
  await expect(pvk).toHaveAttribute('aria-pressed', 'true')
  await expect(details.getByLabel('Состав расчёта ПВК')).toHaveValue('additional')
  await expect(details.getByRole('button', { name: 'Показать стыки в рабочей таблице' })).toBeVisible()
  const reads = () => calls.filter(name => name.startsWith('getLineProgramExplanation_')).length
  expect(reads()).toBe(2)
  await pvk.press('Space')
  expect(reads()).toBe(2)
  await methods.getByRole('button', { name: 'РК - УЗК' }).click()
  await details.getByLabel('Состав расчёта РК/УЗК').selectOption('excluded')
  await expect(details.getByRole('button', { name: 'Открыть все стыки группы' })).toBeVisible()
  expect(reads()).toBe(3)
  await scope.selectOption('')
  await expect(details).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Закрыть расчёт' }).press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])
})

test('ПКМ линии и клейма: точная область, черновик, независимое раскрытие и ограниченные запросы', async ({ page }) => {
  const name = 'UNIFIED-SCOPE-MENU', id = await seed(name, 30, 4)
  await withE2eDatabase(db => db.query("update weld_joints set stamp_1_k='UNIFIED-B',stamp_1_k_fact='UNIFIED-B' where line_program_id=$1 and joint='F4'", [id]))
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const fn = new URL(request.url()).pathname.split('/_serverFn/')[1]
    if (fn) try { calls.push(rpcName(request.url())) } catch {}
  })
  const count = (name: string) => calls.filter(call => call.startsWith(name + '_')).length
  const rightClick = async (target: Locator) => {
    // A person scrolls a row into view before right-clicking it. Let the queued
    // scroll event finish too: scrolling intentionally dismisses context menus.
    await target.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await target.click({ button: 'right' })
    await expect(page.getByTestId('context-action-menu')).toBeVisible()
  }
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(name)
  const header = program.getByTestId('line-program-header'), menu = page.getByTestId('context-action-menu')
  await expect(header).toHaveCount(1)
  await rightClick(program.getByRole('button', { name: 'Клейм в линиях 2', exact: true }))
  await expect(menu.getByText('Программа линий', { exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Назначения', exact: true })).toHaveCount(0)
  await menu.getByRole('button', { name: 'Все линии раздела', exact: true }).click()
  await rightClick(header.getByRole('button', { name: `Расчёт линии ${name}` }))
  await expect(menu.getByText(`Линия ${name}`, { exact: true })).toBeVisible()
  await expect(header.getByRole('button', { name: `Расчёт линии ${name}` })).toHaveAttribute('aria-expanded', 'false')
  expect(count('getLineProgramCalculation')).toBe(0)
  expect(count('getLineProgramJointPage')).toBe(0)
  await page.keyboard.press('Escape')
  await expect(header.getByRole('button', { name: `Расчёт линии ${name}` })).toBeFocused()
  await page.keyboard.press('Shift+F10')
  await menu.getByRole('button', { name: 'Расчёт', exact: true }).click()
  await expect(page.getByRole('dialog', { name: `Расчёт · ${name}` })).toBeVisible()
  await expect(page.getByLabel('Клеймо в расчёте')).toHaveValue('')
  expect(count('getLineProgramJointPage')).toBe(0)
  await page.getByRole('button', { name: 'Закрыть расчёт' }).click()
  const stamp = program.getByTestId('line-program-stamp').filter({ has: page.getByRole('button', { name: 'Клеймо UNIFIED-B', exact: true }) })
  await rightClick(stamp)
  await expect(menu.getByText('Клеймо UNIFIED-B', { exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Настроить линию' })).toHaveCount(0)
  await menu.getByRole('button', { name: 'Назначения', exact: true }).click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${name}` })
  const closeEditor = async () => {
    await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
    // The dialog restores page scroll over two animation frames; let that finish
    // before testing a new right-click on a row that needs scrolling into view.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
  }
  await expect(editor.getByLabel('Стыки в окне назначений')).toHaveValue('stamp:UNIFIED-B')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(1)
  await editor.getByLabel('Выбрать F4', { exact: true }).check()
  await editor.getByLabel('F4 · РК', { exact: true }).selectOption('да')
  await closeEditor()
  await rightClick(header)
  await menu.getByRole('button', { name: 'Назначения', exact: true }).click()
  await expect(editor.getByLabel('Стыки в окне назначений')).toHaveValue('')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(4)
  await expect(editor.getByLabel('F4 · РК', { exact: true })).toHaveValue('да')
  await expect(editor.getByLabel('Выбрать F4', { exact: true })).toBeChecked()
  await closeEditor()
  await program.getByRole('button', { name: 'По клеймам', exact: true }).click()
  const first = program.getByTestId('line-program-stamp').filter({ has: page.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true }) })
  await rightClick(first)
  await menu.getByRole('button', { name: 'Назначения', exact: true }).click()
  await expect(editor.getByLabel('Стыки в окне назначений')).toHaveValue('stamp:UNIFIED-A')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(3)
  await expect(editor.getByRole('button', { name: 'Сбросить выбор' })).toBeDisabled()
  await closeEditor()
  await rightClick(stamp)
  await menu.getByRole('button', { name: 'Свернуть', exact: true }).click()
  await expect(first.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(stamp.getByRole('button', { name: 'Клеймо UNIFIED-B', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await rightClick(first)
  await menu.getByRole('button', { name: 'Показать стыки', exact: true }).click()
  await expect(page.getByRole('menu').getByRole('button', { name: 'Кандидаты на снятие' })).toBeVisible()
  await page.screenshot({ path: '/private/tmp/line-program-scope-menu.png' })
  await page.getByRole('menu').getByRole('button', { name: 'К назначению', exact: true }).click()
  await expect(program.locator('[data-scope="stamp:unified-a"]')).toBeVisible()
  expect(count('getLineProgramSection')).toBe(1)
  expect(count('getLineProgramCalculation')).toBe(1)
  expect(count('getLineProgramJointPage')).toBe(1)
  expect(count('previewLineProgramControl')).toBe(0)
  expect(count('applyLineProgramControl')).toBe(0)
  expect(errors).toEqual([])
  const saved = await withE2eDatabase(db => db.query('select has_rk from weld_joints where line_program_id=$1', [id]))
  expect(saved.rows.every(row => !row.has_rk)).toBe(true)
})

test('возможное сокращение: счётчик равен рамкам; заявки всех этапов защищены, отмена сохраняет факты', async ({ page }) => {
  const name = 'UNIFIED-REDUCTION-HISTORY'
  const id = await seed(name, 25, 4)
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set has_rk='да',
      rk_request=case when joint in ('F2','F4') then 'RK-'||joint end,
      rk_request_date=case when joint in ('F2','F4') then date '2026-09-02' end,
      rk_result=case when joint='F4' then 'годен' when joint='F2' then 'ожидает НК' end,
      rk_conclusion=case when joint='F4' then 'CONCLUSION-F4' end,
      rk_conclusion_date=case when joint='F4' then date '2026-09-03' end where line_program_id=$1`, [id])
    await db.query(`insert into pre_heat_treatment_controls (weld_joint_id,method,request_name,request_date)
      select id,'РК','BEFORE-F3',date '2026-09-02' from weld_joints where line_program_id=$1 and joint='F3'`, [id])
  })
  const program = await openLine(page, name), card = program.getByTestId('line-program-card')
  await expect(card.getByRole('button', { name: 'Лишнее 3', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Возможное сокращение 1', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Возможное сокращение 1', exact: true }).click()
  await expect(program.getByTestId('line-program-readonly-joint')).toHaveCount(1)
  await expect(program.locator('[data-removal-candidate="true"]')).toHaveCount(1)
  await expect(program.getByRole('button', { name: 'Назначение F1 · РК: да', exact: true })).toHaveAttribute('data-removal-candidate', 'true')
  const editor = await openAssignments(page)
  await editor.getByLabel('Стыки в окне назначений').selectOption('')
  for (const joint of ['F2', 'F3', 'F4']) await expect(editor.getByRole('combobox', { name: `${joint} · РК`, exact: true }).locator('option[value=""]')).toBeDisabled()
  await expect(editor.locator('[data-removal-candidate="true"]')).toHaveCount(1)
  await page.screenshot({ path: 'outputs/line-program-possible-reduction.png' })
  await editor.getByRole('combobox', { name: 'F1 · РК', exact: true }).selectOption('')
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  await expect(card.getByRole('button', { name: /^Возможное сокращение/ })).toHaveCount(0)
  await editor.getByRole('combobox', { name: 'F4 · РК', exact: true }).selectOption('отменен')
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  const agreement = editor.getByRole('checkbox', { name: /Подтверждаю назначение сверх нормы/ })
  await expect(editor.getByLabel('Проверка изменений')).toBeVisible()
  if (await agreement.count()) await agreement.check()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(page.getByText('Отменить назначения?', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться', exact: true }).click()
  await withE2eDatabase(async db => expect((await db.query("select has_rk from weld_joints where line_program_id=$1 and joint='F4'", [id])).rows[0].has_rk).toBe('да'))
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await page.getByRole('button', { name: 'Подтвердить отмену', exact: true }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  await editor.getByLabel('Результат F4').locator('xpath=ancestor::details[1]').locator('summary').click()
  await expect(editor.getByLabel('Результат F4').getByText('РК: годен · назначение отменено')).toBeVisible()
  await withE2eDatabase(async db => expect((await db.query("select has_rk,rk_request,rk_result,rk_conclusion from weld_joints where line_program_id=$1 and joint='F4'", [id])).rows[0]).toEqual({ has_rk: 'отменен', rk_request: 'RK-F4', rk_result: 'годен', rk_conclusion: 'CONCLUSION-F4' }))
})

test('мягкая красная строка только у клейм с требованием 100% по браку', async ({ page }) => {
  const cases = [
    { name: 'UNIFIED-REJECTION-MIXED', percent: 30, both: false },
    { name: 'UNIFIED-REJECTION-ALL', percent: 30, both: true },
    { name: 'UNIFIED-REJECTION-NORMAL-100', percent: 100, both: true },
  ]
  for (const item of cases) {
    const id = await seed(item.name, item.percent, 10)
    await withE2eDatabase(db => db.query(`update weld_joints set
      weld_date=date '2026-09-01',
      stamp_1_k=case when substring(joint from 2)::int <= 5 then 'UNIFIED-A' else 'UNIFIED-B' end,
      rk_result=case when substring(joint from 2)::int in (1,2,3,4) or ($2 and substring(joint from 2)::int in (6,7,8,9)) then 'ремонт' else null end
      where line_program_id=$1`, [id, item.both]))
  }
  await page.setViewportSize({ width: 1600, height: 1100 })
  const errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const id = new URL(request.url()).pathname.split('/_serverFn/')[1]
    if (id) requests.push(rpcName(request.url()))
  })
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  for (const item of cases) {
    await program.getByLabel('Поиск программы линий').fill(item.name)
    const card = program.getByTestId('line-program-card')
    await expect(card).toHaveCount(1)
    await expect(card).toHaveAttribute('data-line', item.name)
    await expect(program.getByRole('button', { name: /Потенциал сокращения/ })).toHaveCount(0)
    await card.getByRole('button', { name: `Расчёт линии ${item.name}`, exact: true }).click()
    await expect(card.getByTestId('line-program-summary')).toHaveCount(0)
    const a = card.locator('[data-testid="line-program-stamp"][data-stamp="UNIFIED-A"]')
    const b = card.locator('[data-testid="line-program-stamp"][data-stamp="UNIFIED-B"]')
    await expect(a).toBeVisible()
    for (const [row, highlight] of [[a, item.percent < 100], [b, item.both && item.percent < 100]] as const) {
      if (highlight) {
        await expect(row).toHaveAttribute('data-full-control-by-rejection', 'true')
        await expect(row).toHaveCSS('background-color', 'rgba(255, 241, 242, 0.3)')
        await expect(row.getByText('100% по браку', { exact: true })).toBeVisible()
      } else {
        await expect(row).not.toHaveAttribute('data-full-control-by-rejection')
        await expect(row.getByText('100% по браку', { exact: true })).toHaveCount(0)
      }
    }
    await a.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true }).click()
    await page.mouse.move(0, 0)
    await expect(card.locator('[data-testid="stamp-joints-container"][data-stamp="UNIFIED-A"]').getByTestId('program-stamp-guide')).toBeVisible()
    await expect(a).toHaveCSS('background-color', item.percent < 100 ? 'rgba(255, 241, 242, 0.3)' : 'rgb(241, 245, 249)')
    if (item.name.endsWith('-ALL')) await card.screenshot({ path: 'outputs/line-program-rejection-highlights.png' })
  }
  expect(requests.filter(url => url.includes('getLineProgramSection'))).toHaveLength(1)
  expect(requests.filter(url => url.includes('getLineProgramCalculation'))).toHaveLength(3)
  expect(errors).toEqual([])
})

test('компактные заголовки: общие колонки, читаемые шкалы и стабильное место сокращения', async ({ page }) => {
  const prefix = 'UNIFIED-BALANCED-'
  await seed(prefix + 'A', 30, 5)
  await seed(prefix + 'B', 100, 5)
  await seed(prefix + 'C', 100, 5)
  await withE2eDatabase(db => db.query("update weld_joints set has_rk=case when joint='F5' then 'дополнительный' else 'да' end where line=$1", [prefix + 'A']))
  await withE2eDatabase(db => db.query("update weld_joints set weld_date='2026-09-01',stamp_1_k='UNIFIED-A',has_rk='да',has_pvk='да',vik_result='годен',rk_result='годен',pvk_result='годен' where line=$1", [prefix + 'C']))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(prefix)
  const cards = program.getByTestId('line-program-card')
  await expect(cards).toHaveCount(3)
  await expect(cards.first().getByRole('button', { name: /^Возможное сокращение/ })).toBeVisible()
  await expect(cards.last().getByRole('button', { name: /^Возможное сокращение/ })).toHaveCount(0)
  await expect(cards.first().getByRole('button', { name: 'Ещё показатели контроля' })).toBeVisible()
  await expect(cards.last().getByRole('button', { name: 'Ещё показатели контроля' })).toHaveCount(0)
  await expect(cards.last().getByTestId('program-finished-label')).toBeVisible()
  for (const width of [900, 1000, 1280, 1400, 1600, 2760]) {
    await page.setViewportSize({ width, height: 1000 })
    // Capture all cards in one frame; sidebar transitions must settle first.
    await expect.poll(() => cards.evaluateAll(elements => elements.map(card => {
      const metrics = card.querySelector('[data-testid="line-card-metrics"]')!
      const bounds = metrics.getBoundingClientRect()
      const items = [...metrics.querySelectorAll('[data-line-metric]')]
      const rects = items.map(item => item.getBoundingClientRect())
      const labels = [...metrics.querySelectorAll('[data-metric-label]')].map(label => label.getBoundingClientRect())
      const bars = [...metrics.querySelectorAll('[role="progressbar"]')].map(bar => bar.getBoundingClientRect())
      const line = card.querySelector('button[aria-label^="Расчёт линии"]')!.getBoundingClientRect()
      const description = card.querySelector('[data-testid="line-description"]')!
      const frame = getComputedStyle(card, '::after')
      return {
        layout: getComputedStyle(metrics).display,
        firstLineAligned: getComputedStyle(metrics).gridTemplateColumns.split(' ').length !== 8 || Math.max(...labels.map(label => label.y)) - Math.min(...labels.map(label => label.y)) < 1,
        noOverlap: rects.every((rect, i) => rects.slice(i + 1).every(other => rect.right <= other.left || other.right <= rect.left || rect.bottom <= other.top || other.bottom <= rect.top)),
        quotaValuesFit: [...metrics.querySelectorAll('[data-quota-value]')].every(value => value.scrollWidth <= value.clientWidth),
        labelsFit: labels.every((label, i) => label.left >= rects[i].left && label.right <= rects[i].right)
          && items.every(item => item.scrollWidth <= item.clientWidth),
        readableBars: bars.length === 2 && bars.every(bar => bar.height === 4 && bar.width >= 120) && Math.abs(bars[0].width - bars[1].width) < 1,
        thinBorder: getComputedStyle(card).borderTopWidth === '1px',
        intactFrame: frame.position === 'absolute' && frame.top === '-1px' && frame.left === '-1px' && frame.borderColor === getComputedStyle(card).borderColor && frame.borderRadius === getComputedStyle(card).borderRadius && frame.pointerEvents === 'none' && Number(frame.zIndex) > 20,
        fullDescription: description.scrollWidth <= description.clientWidth && description.scrollHeight <= description.clientHeight && getComputedStyle(description).textOverflow !== 'ellipsis',
        fits: metrics.scrollWidth <= metrics.clientWidth && bounds.right <= window.innerWidth,
        balancedTitle: window.innerWidth < 1280 || line.width >= 288,
      }
    }))).toMatchObject([
      { layout: 'grid', firstLineAligned: true, noOverlap: true, quotaValuesFit: true, labelsFit: true, readableBars: true, thinBorder: true, intactFrame: true, fullDescription: true, fits: true, balancedTitle: true },
      { layout: 'grid', firstLineAligned: true, noOverlap: true, quotaValuesFit: true, labelsFit: true, readableBars: true, thinBorder: true, intactFrame: true, fullDescription: true, fits: true, balancedTitle: true },
      { layout: 'grid', firstLineAligned: true, noOverlap: true, quotaValuesFit: true, labelsFit: true, readableBars: true, thinBorder: true, intactFrame: true, fullDescription: true, fits: true, balancedTitle: true },
    ])
    // Optional reduction / More must not move any shared metric or its bar.
    await expect.poll(() => cards.evaluateAll(elements => {
      const positions = elements.map(card => [...card.querySelectorAll('[data-line-metric]')].slice(0, 6).map(item => {
        const rect = item.getBoundingClientRect()
        return { x: rect.x, width: rect.width }
      }))
      return positions.slice(1).every(row => positions[0].every((position, index) => Math.abs(position.x - row[index].x) < 1 && Math.abs(position.width - row[index].width) < 1))
    })).toBe(true)
    await page.screenshot({ path: `outputs/line-program-balanced-${width}.png` })
  }
  expect(errors).toEqual([])
})

test('ширина заголовка не оставляет пустую колонку при открытом и закрытом меню', async ({ page }) => {
  const prefix = 'UNIFIED-SIDEBAR-'
  await seed(prefix + 'A', 30, 5)
  await seed(prefix + 'B — длинное название линии, которое должно сокращаться без сдвига показателей', 100, 5)
  await withE2eDatabase(db => db.query("update weld_joints set has_rk=case when joint='F5' then 'дополнительный' else 'да' end where line=$1", [prefix + 'A']))
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(prefix)
  const cards = program.getByTestId('line-program-card')
  await expect(cards).toHaveCount(2)
  for (const width of [1600, 1866, 2048, 2760]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const collapsed of [false, true]) {
      const toggle = page.getByRole('button', { name: collapsed ? 'Скрыть меню' : 'Раскрыть меню', exact: true })
      if (await toggle.count()) await toggle.click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', collapsed ? '64px' : '256px')
      await expect.poll(() => cards.evaluateAll(elements => elements.map(card => {
        const header = card.querySelector('[data-testid="line-program-header"]')!.getBoundingClientRect()
        const title = card.querySelector('button[aria-label^="Расчёт линии"]')!.getBoundingClientRect()
        const metrics = card.querySelector('[data-testid="line-card-metrics"]')!
        const bounds = metrics.getBoundingClientRect()
        const bars = [...metrics.querySelectorAll('[role="progressbar"]')].map(bar => bar.getBoundingClientRect())
        return {
          titleHasRoom: Math.abs(title.width - 288) < 1 && bounds.width >= 916,
          compactLayout: getComputedStyle(metrics).display === 'grid' && bounds.height <= 90,
          adjacent: Math.abs(bounds.left - title.right - 8) < 1,
          // The always-visible method breakdown is wider; quota values must stay readable.
          quotaValuesFit: [...metrics.querySelectorAll('[data-quota-value]')].every(value => value.scrollWidth <= value.clientWidth),
          readableBars: bars.every(bar => bar.width >= 120 && bar.width <= 152.5 && bar.height === 4) && Math.abs(bars[0].width - bars[1].width) < 1,
          noOverflow: metrics.scrollWidth <= metrics.clientWidth && bounds.right <= header.right,
        }
      }))).toEqual(Array.from({ length: 2 }, () => ({ titleHasRoom: true, compactLayout: true, adjacent: true, quotaValuesFit: true, readableBars: true, noOverflow: true })))
      await expect(cards.first().getByRole('button', { name: 'Ещё показатели контроля' })).toBeVisible()
      await expect(cards.last().getByRole('button', { name: 'Настроить', exact: true })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (width === 1866) await program.screenshot({ path: `outputs/line-program-sidebar-${collapsed ? 'collapsed' : 'expanded'}.png` })
    }
  }
  expect(calls.filter(call => call.startsWith('getLineProgramSection_'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('единый блок общего НК и ПВК, простой остаток и выровненные строки методов', async ({ page }) => {
  const name = 'UNIFIED-COUNT-UNITS'
  await seed(name, 100, 7)
  await withE2eDatabase(async db => {
    await db.query('update line_programs set pvk_control_percent=100 where line=$1', [name])
    await db.query("update weld_joints set pvk_control_percent=100,weld_date='2026-09-01',stamp_1_k='UNIFIED-A',has_rk=case when joint in ('F1','F2','F3') then 'да' end,has_pvk=case when joint in ('F1','F2','F3','F4','F5') then 'да' end where line=$1", [name])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch {} })
  const program = await openLine(page, name), totals = program.getByLabel('Итоги раздела'), card = program.getByTestId('line-program-card')
  await expect(program.getByTestId('program-counts-explanation')).toHaveCount(0)
  for (const width of [1000, 1600]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const parent of [totals, card]) {
      const compact = parent === card
      const typography = await parent.evaluate(el => ({
        labels: [...el.querySelectorAll('[data-metric-label], [data-metric-detail]')].map(node => getComputedStyle(node).fontSize),
        values: [...el.querySelectorAll('[data-metric-value]:not([data-quota-value])')].map(node => getComputedStyle(node).fontSize),
        quotas: [...el.querySelectorAll('[data-quota-value]')].map(node => getComputedStyle(node).fontSize),
      }))
      expect([...new Set(typography.labels)]).toEqual([compact ? '12px' : '14px'])
      expect([...new Set(typography.values)]).toEqual([compact ? '14px' : '18px'])
      expect([...new Set(typography.quotas)]).toEqual([compact ? '14px' : '16px'])
      const weights = await parent.evaluate(el => ({
        labels: [...el.querySelectorAll('[data-metric-label]')].map(node => getComputedStyle(node).fontWeight),
        values: [...el.querySelectorAll('[data-metric-value]:not([data-quota-value])')].map(node => getComputedStyle(node).fontWeight),
        quotas: [...el.querySelectorAll('[data-quota-value]')].map(node => getComputedStyle(node).fontWeight),
        quotaColors: [...el.querySelectorAll('[data-quota-value]')].map(node => getComputedStyle(node).color),
      }))
      expect([...new Set(weights.labels)]).toEqual(['400'])
      expect([...new Set(weights.values)]).toEqual([compact ? '400' : '500'])
      expect([...new Set(weights.quotas)]).toEqual(['400'])
      expect([...new Set(weights.quotaColors)]).toEqual([compact ? 'rgb(51, 65, 85)' : 'rgb(71, 85, 105)'])
      const quota = parent.getByTestId('program-quota-summary')
      const common = quota.getByRole('button', { name: 'РК - УЗК · зачтено / нужно 3 / 7', exact: true })
      const pvk = quota.getByRole('button', { name: 'ПВК · зачтено / нужно 5 / 7', exact: true })
      await expect(common).toBeVisible(); await expect(pvk).toBeVisible()
      expect(await common.getAttribute('class')).toBe(await pvk.getAttribute('class'))
      await expect(common).toHaveCSS('text-decoration-line', 'none')
      await expect(pvk).toHaveCSS('text-decoration-line', 'none')
      // Sample both rows in the same frame after responsive/sidebar transitions settle.
      await expect.poll(() => quota.evaluate((el, compact) => {
        const buttons = el.querySelectorAll('button')
        const labels = [...buttons].map(button => button.firstElementChild!.getBoundingClientRect())
        const counts = [...buttons].map(button => button.querySelector('[data-quota-value]')!.getBoundingClientRect())
        return compact ? Math.abs(labels[0].y - labels[1].y) + Math.abs(counts[0].y - counts[1].y) : Math.abs(labels[0].x - labels[1].x) + Math.abs(counts[0].right - counts[1].right)
      }, compact)).toBeLessThan(1)
      const remaining = parent.getByRole('button', { name: 'К назначению 6', exact: true })
      if (compact) await expect(remaining).toContainText('РК/УЗК: 4 · ПВК: 2')
      else await expect(remaining).toContainText('РК - УЗК: 4 · ПВК: 2')
      await expect(remaining).not.toContainText('мест нормы')
      expect(await remaining.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true)
      if (!compact) await expect.poll(() => parent.evaluate(el => {
        const remaining = el.querySelector('[data-testid="deficit-metric"]')!.getBoundingClientRect()
        const excess = el.querySelector('[data-testid="excess-metric"]')!.getBoundingClientRect()
        return Math.abs(remaining.width - excess.width)
      })).toBeLessThan(1)
    }
    const summary = card.getByTestId('line-program-stamp')
    await expect(summary.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true })).toHaveCSS('border-width', '0px')
    await expect(summary.getByRole('button', { name: 'РК - УЗК: 3 / 7', exact: true })).toBeVisible()
    await expect(summary.getByRole('button', { name: 'РК - УЗК: назначено 3', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'По клеймам', exact: true })).toBeVisible()
    for (const kind of ['common', 'pvk']) {
      const row = summary.getByTestId('program-demand-row-' + kind)
      await expect.poll(() => row.evaluate(el => {
        const [quota, assignment] = [...el.querySelectorAll('button')].map(button => button.getBoundingClientRect())
        // Compact cells center each method pair; an assignment label may wrap at 1000 px.
        return Math.abs(quota.y + quota.height / 2 - assignment.y - assignment.height / 2)
      })).toBeLessThan(1)
      await expect(row.getByRole('button', { name: /^к назначению/ })).toHaveCount(0)
      const assignment = row.getByRole('button', { name: /назначено/ })
      expect(await assignment.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true)
    }
    await expect.poll(() => summary.evaluate(el => {
      const assignments = [...el.querySelectorAll('[data-testid^="program-demand-row-"]')].map(row => row.lastElementChild!.lastElementChild!.getBoundingClientRect())
      // Labels may wrap on narrow screens; their left edges and each quota/count pair stay aligned.
      return Math.abs(assignments[0].x - assignments[1].x)
    })).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'outputs/line-program-summary-' + width + '.png' })
  }
  const summary = card.getByTestId('line-program-stamp')
  const breakdown = summary.getByTestId('program-demand-breakdown')
  await breakdown.getByRole('button', { name: 'ПВК: 2', exact: true }).click()
  await expect(card.getByTestId('line-program-readonly-joint')).toHaveCount(2)
  for (const joint of ['F6', 'F7']) await expect(card.getByTestId('line-program-readonly-joint').filter({ has: page.getByText(joint, { exact: true }) })).toHaveCount(1)
  await breakdown.getByRole('button', { name: 'РК - УЗК: 4', exact: true }).click()
  await expect(card.getByTestId('line-program-readonly-joint')).toHaveCount(4)
  await card.getByTestId('program-quota-summary').getByRole('button', { name: /^РК - УЗК/ }).click()
  await expect(card.getByTestId('line-program-readonly-joint').locator('visible=true')).toHaveCount(3)
  await card.getByTestId('program-quota-summary').getByRole('button', { name: /^ПВК/ }).click()
  await expect(card.getByTestId('line-program-readonly-joint').locator('visible=true')).toHaveCount(5)
  await card.getByRole('button', { name: 'К назначению 6', exact: true }).click()
  const joints = card.getByTestId('line-program-readonly-joint').locator('visible=true')
  await expect(joints).toHaveCount(4)
  for (const joint of ['F4', 'F5', 'F6', 'F7']) await expect(joints.filter({ has: page.getByText(joint, { exact: true }) })).toHaveCount(1)
  await card.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await expect(card.getByTestId('line-program-stamp').getByTestId('program-assignment-demand').getByRole('button', { name: 'К назначению: 6', exact: true })).toHaveText('6')
  await expect(card.getByTestId('line-program-stamp')).not.toContainText('мест нормы')
  await expect(card.getByRole('columnheader', { name: 'Зачтено / нужно', exact: true })).toBeVisible()
  await totals.getByRole('button', { name: /^РК - УЗК/ }).click()
  await expect(program.getByRole('group', { name: 'РК - УЗК · линий: 1', exact: true })).toBeVisible()
  await totals.getByRole('button', { name: /^ПВК/ }).click()
  await expect(program.getByRole('group', { name: 'ПВК · линий: 1', exact: true })).toBeVisible()
  const toolbar = program.getByTestId('line-program-toolbar')
  for (const width of [1000, 1600]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(toolbar.getByTestId('line-program-filter')).toBeVisible()
    await expect.poll(() => toolbar.evaluate(el => {
      const filter = el.querySelector('[data-testid="line-program-filter"]')!.getBoundingClientRect()
      const search = el.querySelector('input')!.getBoundingClientRect()
      return filter.right < search.left && Math.abs(filter.y - search.y) < 1 && search.width >= 150
    })).toBe(true)
    await expect.poll(() => totals.evaluate(el => {
      const groups = [...el.children].map(child => child.getBoundingClientRect())
      const bounds = el.getBoundingClientRect()
      return Math.abs(Math.min(...groups.map(group => group.x)) - bounds.x) < 1 && Math.abs(Math.max(...groups.map(group => group.right)) - bounds.right) < 1
    })).toBe(true)
    expect(await totals.evaluate(el => [...el.querySelectorAll('button')].every(button => getComputedStyle(button).textDecorationLine === 'none'))).toBe(true)
    await page.screenshot({ path: 'outputs/line-program-filter-' + width + '.png' })
  }
  await program.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  await expect(program.getByTestId('line-program-filter')).toHaveCount(0)
  await expect(program.getByLabel('Поиск программы линий')).toHaveValue(name)
  expect(calls.filter(call => call.startsWith('getLineProgramSection_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramCalculation_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('доп закрывает норму: видимый состав, лишнее да и ручное снятие без потери результатов', async ({ page }) => {
  const name = 'UNIFIED-ADDITIONAL'
  await seed(name, 50, 4)
  await withE2eDatabase(async db => {
    await db.query('update line_programs set pvk_control_percent=50 where line=$1', [name])
    await db.query("update weld_joints set pvk_control_percent=50,has_rk=case when joint in ('F1','F2') then 'да' end,has_pvk=case when joint in ('F1','F2') then 'да' end,vik_result='годен',vik_conclusion='ADDITIONAL-VIK',vik_conclusion_date='2026-09-02' where line=$1", [name])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch {} })
  const program = await openLine(page, name), card = program.getByTestId('line-program-card')
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const editor = await openAssignments(page)
  for (const method of ['РК', 'ПВК']) await editor.getByRole('combobox', { name: 'F3 · ' + method, exact: true }).selectOption('дополнительный')
  for (const kind of ['common', 'pvk']) {
    const guidance = editor.getByTestId('assignment-guidance-' + kind)
    await expect(guidance).toContainText('Назначено: 3К назначению: 0')
    await expect(guidance).toContainText('Назначено стыков: 3 = только «да» 2 + только «доп» 1 + совместно 0')
    await expect(guidance).toContainText('Текущая норма: 2 · Обычных «да» сверх нормы: 1')
  }
  await expect(card.getByRole('button', { name: 'Лишнее 0', exact: true })).toBeVisible()
  for (const method of ['РК', 'ПВК']) {
    await expect(editor.getByRole('combobox', { name: 'F2 · ' + method, exact: true })).toHaveAttribute('data-removal-candidate', 'true')
    await expect(editor.getByRole('combobox', { name: 'F3 · ' + method, exact: true })).not.toHaveAttribute('data-removal-candidate', 'true')
  }
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(editor.getByRole('button', { name: 'Сохранить назначения' })).toBeDisabled()
  await editor.getByRole('checkbox', { name: /Подтверждаю назначение сверх нормы/ }).check()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  for (const method of ['РК', 'ПВК']) {
    await expect(editor.getByRole('combobox', { name: 'F2 · ' + method, exact: true })).toHaveAttribute('data-removal-candidate', 'true')
    await expect(editor.getByRole('combobox', { name: 'F3 · ' + method, exact: true })).not.toHaveAttribute('data-removal-candidate', 'true')
  }
  for (const width of [1000, 1800]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await editor.getByTestId('assignment-dialog-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  await page.screenshot({ path: 'outputs/line-program-additional-accounting.png' })
  await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await expect(card.getByRole('button', { name: 'Лишнее 2', exact: true })).toBeVisible()
  await program.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await expect(program.getByTestId('line-program-stamp')).toContainText('назначено 3')
  await program.getByTestId('program-scope-actions').getByRole('button', { name: /^Расчёт/ }).click()
  const calculation = page.getByRole('dialog', { name: 'Расчёт · ' + name })
  for (const kind of ['common', 'pvk']) {
    await expect(calculation.getByTestId('demand-' + kind)).toContainText('Всего в зачёте: 3 = только «да» 2 + только «доп» 1 + совместно 0')
    await expect(calculation.getByTestId('demand-' + kind)).toContainText('В пределах текущей нормы: 2 / 2. Превышение зачёта: 1.')
  }
  await calculation.getByRole('button', { name: 'Закрыть расчёт' }).click()
  await program.getByTestId('line-program-stamp').getByRole('button', { name: 'РК - УЗК: назначено 3', exact: true }).click()
  await expect(program.getByTestId('line-program-readonly-joint').locator('visible=true')).toHaveCount(3)
  await expect(program.getByTestId('line-program-readonly-joint').locator('visible=true').last()).toContainText('F3')
  await openAssignments(page)
  for (const method of ['РК', 'ПВК']) await editor.getByRole('combobox', { name: 'F2 · ' + method, exact: true }).selectOption('')
  for (const kind of ['common', 'pvk']) {
    await expect(editor.getByTestId('assignment-guidance-' + kind)).toContainText('Назначено стыков: 2 = только «да» 1 + только «доп» 1 + совместно 0')
    await expect(editor.getByTestId('assignment-guidance-' + kind)).toContainText('Обычных «да» сверх нормы: 0')
  }
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await expect(card.getByRole('button', { name: 'Лишнее 0', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'К назначению 0', exact: true })).toBeVisible()
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(3) // initial + two saves; local projections add no reads
  expect(await withE2eDatabase(async db => (await db.query("select joint,has_rk,has_pvk,vik_result,vik_conclusion from weld_joints where line=$1 order by joint", [name])).rows)).toEqual([
    { joint: 'F1', has_rk: 'да', has_pvk: 'да', vik_result: 'годен', vik_conclusion: 'ADDITIONAL-VIK' },
    { joint: 'F2', has_rk: null, has_pvk: null, vik_result: 'годен', vik_conclusion: 'ADDITIONAL-VIK' },
    { joint: 'F3', has_rk: 'дополнительный', has_pvk: 'дополнительный', vik_result: 'годен', vik_conclusion: 'ADDITIONAL-VIK' },
    { joint: 'F4', has_rk: null, has_pvk: null, vik_result: 'годен', vik_conclusion: 'ADDITIONAL-VIK' },
  ])
  expect(errors).toEqual([])
})

test('результаты продолжают строки назначений: одинаковый фон, подписи этапов, без ссылок и лишней нижней границы', async ({ page }) => {
  const name = 'UNIFIED-RESULTS-STYLE'
  await seed(name, 100, 5)
  await withE2eDatabase(async db => {
    await db.query("update weld_joints set vik_result='годен',vik_conclusion='STYLE-VIK',vik_conclusion_date='2026-09-02',has_rk='да',rk_result='годен',rk_conclusion='STYLE-RK',rk_conclusion_date='2026-09-03' where line=$1", [name])
    await db.query("insert into pre_heat_treatment_controls (weld_joint_id,method,result,conclusion_name,conclusion_date) select id,'ВИК','годен','STYLE-PRE','2026-09-01' from weld_joints where line=$1 and joint='F2'", [name])
    await db.query("insert into pre_heat_treatment_controls (weld_joint_id,method,result) select id,m,'годен' from weld_joints cross join unnest(array['РК','УЗК','ПВК']) m where line=$1 and joint='F2'", [name])
    await db.query("update weld_joints set psto_required='да',psto_result='проведено',heat_treatment_diagram='STYLE-PSTO',tvmt_result='годен',tvmt_conclusion='STYLE-TVMT' where line=$1 and joint='F2'", [name])
    await db.query("insert into psto_repeat_cycles (weld_joint_id,sequence,psto_result,tvmt_result) select id,2,'проведено','годен' from weld_joints where line=$1 and joint='F2'", [name])
    await db.query("insert into duplicate_controls (weld_joint_id,method,result,conclusion) select id,'РК','годен','STYLE-DUPLICATE' from weld_joints where line=$1 and joint='F2'", [name])
  })
  const errors: string[] = [], popups: Page[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('popup', popup => popups.push(popup))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const program = await openLine(page, name)
  const editor = await openAssignments(page)
  const joints = editor.getByTestId('line-program-joint')
  await expect(joints).toHaveCount(5)
  await expect(editor.getByText('Основной этап', { exact: true })).toHaveCount(5)
  await expect(editor.getByText('НК до ТО', { exact: true })).toHaveCount(1)
  const result = editor.getByLabel('Результат F2', { exact: true })
  await result.locator('xpath=ancestor::details[1]').locator('summary').click()
  await editor.getByLabel('Результат F1').locator('xpath=ancestor::details[1]').locator('summary').click()
  await expect(result).not.toContainText(/ПСТО|ТВМТ/)
  await expect(result).toContainText('Дубли контроля')
  await editor.getByLabel('Результат F1').getByText('ВИК: годен', { exact: true }).click()
  await editor.getByLabel('Результат F1').getByText('РК: годен', { exact: true }).click()
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).not.toBeChecked()
  await expect(editor.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled()
  await expect(editor.getByLabel('Результат F1').locator('a, button')).toHaveCount(0)
  await editor.getByRole('checkbox', { name: 'Выбрать F3', exact: true }).check()
  for (const width of [1000, 1800]) {
    await page.setViewportSize({ width, height: 1000 })
    // Transparent cells share their row's normal, striped, hovered and selected backgrounds.
    for (const joint of ['F1', 'F2', 'F3']) {
      const current = joints.filter({ has: page.getByText(joint, { exact: true }) })
      const colors = await current.locator('td').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundColor))
      expect(new Set(colors).size).toBe(1)
      expect(colors[0]).toBe('rgba(0, 0, 0, 0)')
      await expect(current.locator('td').last()).toHaveCSS('border-left-width', '0px')
    }
    const headers = await editor.getByRole('columnheader').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundColor))
    expect(new Set(headers).size).toBe(1)
    const table = editor.getByRole('table', { name: 'Стыки и назначения всех методов' })
    expect(await table.evaluate(element => getComputedStyle(element.parentElement!).borderBottomWidth)).toBe('0px')
    const lastBorders = await joints.last().locator('td').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).borderBottomWidth))
    expect(lastBorders.every(width => width === '1px')).toBe(true)
    expect(await editor.getByTestId('assignment-dialog-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    // Even multi-stage NK is entirely visible; only the modal's joint list scrolls.
    expect(await result.evaluate(element => ({
      maxHeight: getComputedStyle(element).maxHeight,
      overflowY: getComputedStyle(element).overflowY,
      fits: element.scrollHeight <= element.clientHeight,
    }))).toEqual({ maxHeight: 'none', overflowY: 'visible', fits: true })
  }
  await page.screenshot({ path: 'outputs/line-program-results-integrated-20260928.png' })
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await expect(program.getByRole('button', { name: 'Все стыки линии', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await program.getByRole('button', { name: 'F2', exact: true }).click()
  const history = program.getByLabel('История контроля F2', { exact: true })
  await expect(history.getByRole('heading', { name: 'ПСТО и ТВМТ', exact: true })).toBeVisible()
  await expect(history.getByText('ПСТО · цикл 2: проведено', { exact: true })).toBeVisible()
  await expect(history.getByText('ТВМТ · цикл 2: годен', { exact: true })).toBeVisible()
  await expect(history.getByRole('button', { name: 'STYLE-PSTO', exact: true })).toBeVisible()
  await expect(history.getByRole('button', { name: 'STYLE-TVMT', exact: true })).toBeVisible()
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(popups).toEqual([])
  expect(errors).toEqual([])
})

test('назначения с компактными результатами: явное применение, пусто по правилам карточки, ПКМ и безопасный переход', async ({ page }) => {
  const name = 'UNIFIED-ACTIONS'
  await seed(name, 30, 5)
  await withE2eDatabase(async db => {
    await db.query("update weld_joints set has_rk='да', rk_result='годен', rk_request='ACTIONS-REQ-1', rk_request_date='2026-09-02', rk_conclusion='ACTIONS-RES-1', rk_conclusion_date='2026-09-03' where line=$1 and joint='F1'", [name])
    await db.query("update weld_joints set has_rk='да', rk_result='ожидает НК', rk_request='ACTIONS-PENDING', rk_request_date='2026-09-02' where line=$1 and joint='F2'", [name])
    await db.query("update weld_joints set has_rk='да', rk_result='ожидает заявку' where line=$1 and joint in ('F3','F5')", [name])
    await db.query("insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date) select id,'РК','ACTIONS-PRE','2026-09-02' from weld_joints where line=$1 and joint='F3'", [name])
    await db.query("update weld_joints set has_rk='да', rk_result='ремонт', rk_conclusion='ACTIONS-REJECT', rk_conclusion_date='2026-09-03' where line=$1 and joint='F4'", [name])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch { /* asset */ } })
  const program = await openLine(page, name)
  const sidebarLabels = await page.locator('aside button').allTextContents()
  const journalIndex = sidebarLabels.findIndex(label => label.trim() === 'Сварочный журнал')
  expect(sidebarLabels[journalIndex + 1].trim()).toBe('Программа линий')
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const editor = await openAssignments(page)
  await expect(editor.getByRole('columnheader')).toHaveText(['', 'Стык', 'РК', 'УЗК', 'ПВК', 'Послойный ПВК', 'Результат'])
  await expect(editor.getByRole('button', { name: 'Результаты', exact: true })).toHaveCount(0)
  await expect(editor.getByRole('combobox', { name: 'F1 · РК' }).locator('option[value=""]')).toBeDisabled()
  await expect(editor.getByRole('combobox', { name: 'F1 · РК' }).locator('option[value="отменен"]')).toBeEnabled()
  await expect(editor.getByRole('combobox', { name: 'F3 · РК' }).locator('option[value=""]')).toBeDisabled()
  await expect(editor.getByRole('combobox', { name: 'F2 · РК' }).locator('option[value=""]')).toBeDisabled()
  await editor.getByRole('button', { name: 'УЗК', exact: true }).click()
  await editor.getByRole('checkbox', { name: 'Выбрать F4', exact: true }).check()
  await expect(editor.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled()
  await editor.getByRole('button', { name: /^Применить к выбранным/ }).click()
  // Manual assignment follows the card: rejection removes calculated demand, not edit authority.
  await expect(editor.getByRole('combobox', { name: 'F4 · УЗК' })).toHaveValue('да')
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(editor.getByRole('button', { name: 'Сохранить назначения' })).toBeVisible()
  await editor.getByRole('button', { name: 'Сбросить выбор' }).click()
  await editor.getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Отменить изменения назначений?' }) }).getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await editor.getByRole('combobox', { name: 'F2 · РК' }).selectOption('отменен')
  await expect(editor.getByRole('note')).toContainText('сохраняются')
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(editor.getByLabel('Проверка изменений')).toBeVisible()
  const agreement = editor.getByRole('checkbox', { name: /Подтверждаю назначение сверх нормы/ })
  if (await agreement.count()) await agreement.check()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await page.getByRole('button', { name: 'Подтвердить отмену', exact: true }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  expect(await withE2eDatabase(async db => (await db.query("select has_rk, rk_request from weld_joints where line=$1 and joint='F2'", [name])).rows[0])).toEqual({ has_rk: 'отменен', rk_request: 'ACTIONS-PENDING' })
  // A new draft is kept if the operator cancels a context-menu navigation.
  await editor.getByRole('combobox', { name: 'F5 · РК' }).selectOption('')
  await editor.getByTestId('line-program-joint').filter({ hasText: 'F5' }).locator('td').nth(1).click({ button: 'right' })
  await page.getByRole('button', { name: 'Показать стык в ЛНК', exact: true }).click()
  await page.getByRole('button', { name: 'Остаться', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'F5 · РК' })).toHaveValue('')
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  const first = program.getByTestId('line-program-readonly-joint').filter({ hasText: 'F1' })
  await first.click({ button: 'right' })
  await page.getByRole('button', { name: 'Заявки и заключения', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Основной этап · РК · Заключение: ACTIONS-RES-1', exact: true })).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'outputs/line-program-context-menu-20260928.png' })
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Основной этап · РК · Заключение: ACTIONS-RES-1', exact: true }).click()
  const popup = await popupPromise
  await expect(popup.getByText('Шаблон системного документа не загружен.')).toBeVisible()
  await popup.close()
  await expect(program.getByRole('button', { name: /Назначения.*черновик: 1/ })).toBeVisible()
  await first.click({ button: 'right' })
  await page.getByRole('button', { name: 'Показать стык в ЛНК', exact: true }).click()
  await page.getByRole('button', { name: 'Уйти без сохранения', exact: true }).click()
  await expect(page).toHaveURL(/\/lnk$/)
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(2)
  expect(errors).toEqual([])
})

test('предел назначений, компактные результаты и четыре клейма без дополнительных запросов', async ({ page }) => {
  const name = 'UNIFIED-DEFICIT-RESULTS'
  await seed(name, 100, 5)
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set weld_date='2026-09-01', stamp_1_k='UNIFIED-A',
      has_rk=case when joint='F4' then null else 'да' end,
      has_pvk=case when joint in ('F1','F3','F5') then 'да' else null end,
      vik_result=case when joint='F4' then 'ремонт' else 'годен' end,
      rk_result=case when joint='F1' then 'годен' else null end,
      rk_conclusion=case when joint='F1' then 'SUMMARY-RK' else null end,
      rk_conclusion_date=case when joint='F1' then date '2026-09-03' else null end
      where line=$1`, [name])
    await db.query("update weld_joints set stamp_1_z='UNIFIED-B',stamp_1_o='UNIFIED-A',stamp_2_k='UNIFIED-C',stamp_2_z='UNIFIED-D',stamp_2_o='UNIFIED-B' where line=$1 and joint='F1'", [name])
    await db.query("update weld_joints set stamp_1_z='UNIFIED-E' where line=$1 and joint='F2'", [name])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch {} })
  const program = await openLine(page, name), card = program.getByTestId('line-program-card')
  await expect(card.getByRole('button', { name: 'К назначению 1', exact: true })).toBeVisible()
  await expect(card.getByText(/Не закрывается/)).toHaveCount(0)
  await expect(card.getByRole('progressbar', { name: 'РК - УЗК · зачтено / нужно' })).toHaveAttribute('aria-valuenow', '100')
  await expect(card.getByRole('progressbar', { name: 'ПВК · зачтено / нужно' })).toHaveAttribute('aria-valuenow', '80')
  await card.getByRole('button', { name: 'К назначению 1', exact: true }).click()
  const candidates = program.getByTestId('line-program-readonly-joint')
  await expect(candidates).toHaveCount(1)
  await expect(candidates).toContainText('F2')
  const editor = await openAssignments(page)
  await editor.getByRole('combobox', { name: 'Стыки в окне назначений' }).selectOption('')
  await expect(editor.getByTestId('assignment-guidance-common')).toContainText('К назначению: 0')
  await expect(editor.getByTestId('assignment-guidance-pvk')).toContainText('К назначению: 1')
  await expect(editor.getByRole('columnheader')).toHaveText(['', 'Стык', 'РК', 'УЗК', 'ПВК', 'Послойный ПВК', 'Результат'])
  const first = editor.getByTestId('line-program-joint').filter({ has: page.getByText('F1', { exact: true }) })
  await expect(first.getByTestId('program-joint-metadata')).toContainText('UNIFIED-A, UNIFIED-B, UNIFIED-C, UNIFIED-D')
  const result = first.getByLabel('Результат F1')
  await expect(result).toContainText('РК: годен')
  await result.locator('xpath=ancestor::details[1]').locator('summary').click()
  await result.getByText('ВИК: годен').click()
  await expect(first.getByRole('checkbox')).not.toBeChecked()
  await editor.getByRole('combobox', { name: 'F1 · РК' }).selectOption('отменен')
  await expect(result).toContainText('РК: годен')
  await expect(editor.getByLabel('Результат F4')).toContainText('ВИК: ремонт')
  await expect(editor.getByText(/Не закрывается/)).toHaveCount(0)
  const resultBox = await editor.getByRole('columnheader', { name: 'Результат', exact: true }).boundingBox()
  const layeredBox = await editor.getByRole('columnheader', { name: 'Послойный ПВК', exact: true }).boundingBox()
  expect(resultBox!.x).toBeGreaterThan(layeredBox!.x)
  expect(resultBox!.x + resultBox!.width).toBeLessThanOrEqual((await editor.boundingBox())!.x + (await editor.boundingBox())!.width)
  expect(calls.filter(name => name.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(calls.some(name => name.startsWith('loadWelderStampRegistrySnapshot_'))).toBe(false)
  await editor.getByTestId('line-program-joint').filter({ has: page.getByText('F4', { exact: true }) }).locator('td').nth(1).click({ button: 'right' })
  await page.getByRole('button', { name: 'Показать стык в ЛНК', exact: true }).click()
  await page.getByRole('button', { name: 'Остаться', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'F1 · РК' })).toHaveValue('отменен')
  await editor.getByRole('combobox', { name: 'F1 · РК' }).selectOption('да')
  await editor.getByRole('combobox', { name: 'F2 · ПВК' }).selectOption('да')
  await expect(editor.getByTestId('assignment-guidance-common')).toContainText('К назначению: 0')
  await expect(editor.getByTestId('assignment-guidance-pvk')).toContainText('К назначению: 0')
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await expect(card).toHaveClass(/border-slate-200/)
  await expect(program.getByTestId('line-card-metrics').getByRole('button', { name: 'К назначению 0', exact: true })).toBeVisible()
  // The raw quota remains available without a persistent assignment debt.
  await program.getByTestId('program-scope-actions').getByRole('button', { name: /^Расчёт/ }).click()
  const calculation = page.getByRole('dialog', { name: 'Расчёт · ' + name })
  await expect(calculation.getByTestId('demand-common')).toContainText('Расчётная норма 5')
  await expect(calculation.getByTestId('demand-common').getByRole('button', { name: 'Текущая потребность с учётом предела 4', exact: true })).toBeVisible()
  await calculation.getByRole('button', { name: 'Закрыть расчёт' }).click()
  await program.getByTestId('line-card-metrics').getByRole('button', { name: 'Учитываемых соединений 5', exact: true }).click()
  await program.getByTestId('line-program-readonly-joint').filter({ has: page.getByText('F4', { exact: true }) }).getByText('F4', { exact: true }).click()
  await expect(program.getByLabel('История контроля F4')).toContainText('ВИК: ремонт')
  await page.screenshot({ path: 'outputs/line-program-assignment-cap-20260928.png' })
  // A new eligible joint restores demand. The exhausted original stays rejected.
  await withE2eDatabase(db => db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,category,group_name,weld_control_percent,pvk_control_percent,has_vik,stamp_1_k,stamp_1_k_fact,officiality,revision_actuality,welding_method,material_group,d1,d2,t1,t2,wdi,isometry,spool,vik_control_basis,rk_control_basis,uzk_control_basis,pvk_control_basis)
    select line_program_id,project_title,subtitle_code,line,'F6',weld_date,connection_type,category,group_name,weld_control_percent,pvk_control_percent,has_vik,stamp_1_k,stamp_1_k_fact,officiality,revision_actuality,welding_method,material_group,d1,d2,t1,t2,wdi,isometry,spool,vik_control_basis,rk_control_basis,uzk_control_basis,pvk_control_basis from weld_joints where line=$1 and joint='F3'`, [name]))
  await openLine(page, name)
  await expect(card).toHaveClass(/border-amber-300/)
  await expect(card.getByRole('button', { name: 'К назначению 1', exact: true })).toBeVisible()
  const reopened = await openAssignments(page)
  await expect(reopened.getByTestId('assignment-guidance-common')).toContainText('К назначению: 1')
  await reopened.getByRole('combobox', { name: 'F6 · РК' }).selectOption('да')
  await reopened.getByRole('button', { name: 'Проверить изменения' }).click()
  await reopened.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(reopened.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  await reopened.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await expect(card).toHaveClass(/border-slate-200/)
  for (const bar of await card.getByRole('progressbar').all()) await expect(bar).toHaveAttribute('aria-valuenow', '100')
  expect(await withE2eDatabase(async db => (await db.query("select vik_result from weld_joints where line=$1 and joint='F4'", [name])).rows[0].vik_result)).toBe('ремонт')
  expect(errors).toEqual([])
})

test('панель раздела: создание и настройки только во всех линиях, выровненные итоги', async ({ page }) => {
  await seed('UNIFIED-TOOLBAR-PERCENT', 10, 1)
  await seed('UNIFIED-TOOLBAR-FULL', 100, 1)
  await withE2eDatabase(db => db.query("update line_programs set weld_control_percent=0,pvk_control_percent=0 where line='UNIFIED-TOOLBAR-PERCENT'"))
  await withE2eDatabase(db => db.query("insert into line_programs (project_title, subtitle_code, line) values ('E2E unified', 'UNI', 'UNIFIED-TOOLBAR-SETUP')"))
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch { /* built RPC ID */ } })
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  const search = program.getByLabel('Поиск программы линий')
  const create = program.getByRole('button', { name: 'Новая линия', exact: true })
  await search.fill('UNIFIED-TOOLBAR')
  await expect(program.getByTestId('line-program-card')).toHaveCount(3)
  await expect(program.getByRole('heading', { name: 'Программа линий', exact: true })).toHaveCount(0)
  await expect(program.getByText('Расчёт, назначения и результаты — в одном рабочем пространстве линии.')).toHaveCount(0)
  await expect(program.getByRole('button', { name: 'Настроить', exact: true })).toHaveCount(3)
  const totals = program.getByLabel('Итоги раздела')
  const issue = totals.getByRole('button', { name: /Нужна настройка: 1/ })
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    const createBox = (await create.boundingBox())!, searchBox = (await search.boundingBox())!
    expect(createBox.x + createBox.width).toBeLessThan(searchBox.x)
    expect(Math.abs(createBox.y - searchBox.y)).toBeLessThanOrEqual(1)
    expect((await issue.boundingBox())!.height).toBe((await totals.getByTestId('excess-metric').boundingBox())!.height)
    expect((await issue.boundingBox())!.height).toBe((await totals.getByTestId('deficit-metric').boundingBox())!.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const metrics = await program.getByTestId('line-card-metrics').evaluateAll(elements => elements.map(element => [...element.querySelectorAll('[data-line-metric]')].every(child => child.scrollWidth <= child.clientWidth && child.getBoundingClientRect().width >= 24)))
    expect(metrics).toEqual([true, true])
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.screenshot({ path: 'outputs/line-program-toolbar-20260928.png' })
  await issue.click()
  await expect(program.getByTestId('line-program-card')).toHaveCount(1)
  await expect(program.getByTestId('line-program-card')).toHaveAttribute('data-line', 'UNIFIED-TOOLBAR-SETUP')
  for (const width of [1000, 1600]) {
    await page.setViewportSize({ width, height: 1000 })
    const toolbar = program.getByTestId('line-program-toolbar')
    await expect(toolbar.getByRole('group', { name: 'Нужна настройка программы линии · линий: 1' })).toBeVisible()
    await expect.poll(() => toolbar.evaluate(el => {
      const filter = el.querySelector('[data-testid="line-program-filter"]')!.getBoundingClientRect()
      const search = el.querySelector('input')!.getBoundingClientRect()
      const count = el.querySelector('[aria-label="Линий: 1"]')!.getBoundingClientRect()
      return filter.right < search.left && Math.abs(filter.y - search.y) < 1 && search.width >= 150 && count.right < filter.right
    })).toBe(true)
    await page.screenshot({ path: 'outputs/line-program-long-filter-' + width + '.png' })
  }
  await program.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  for (const [tab, name] of [['Процентные линии', 'UNIFIED-TOOLBAR-PERCENT'], ['100%-ные линии', 'UNIFIED-TOOLBAR-FULL']] as const) {
    await program.getByRole('button', { name: tab, exact: true }).click()
    await expect(program.getByTestId('line-program-card')).toHaveCount(1)
    await expect(program.getByTestId('line-program-card')).toHaveAttribute('data-line', name)
    await expect(create).toHaveCount(0)
    await expect(program.getByRole('button', { name: 'Настроить', exact: true })).toHaveCount(0)
  }
  await program.getByRole('button', { name: 'Все линии', exact: true }).click()
  await create.click()
  await expect(page.getByRole('dialog', { name: 'Новая линия', exact: true })).toBeVisible()
  expect(calls.filter(name => name.startsWith('getLineProgramSection_'))).toHaveLength(1)
  expect(calls.filter(name => name.startsWith('getLineProgramCalculation_') || name.startsWith('getLineProgramJointPage_'))).toHaveLength(0)
  expect(errors).toEqual([])
})

test('оформление программы как у журнала: белый фон, общие края и стандартные кнопки', async ({ page }) => {
  const prefix = 'UNIFIED-WHITE-'
  await seed(prefix + 'A', 30, 5)
  await seed(prefix + 'B', 100, 5)
  await withE2eDatabase(db => db.query("update weld_joints set has_rk='да',has_pvk='да' where line=$1", [prefix + 'B']))
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/line-program')
  const program = page.getByTestId('line-program'), toolbar = program.getByTestId('line-program-toolbar')
  await program.getByLabel('Поиск программы линий').fill(prefix)
  await expect(program.getByTestId('line-program-card')).toHaveCount(2)
  for (const width of [1000, 1600]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const collapsed of [false, true]) {
      const toggle = page.getByRole('button', { name: collapsed ? 'Скрыть меню' : 'Раскрыть меню', exact: true })
      if (await toggle.count()) await toggle.click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', collapsed ? '64px' : width >= 1024 ? '256px' : '192px')
      await expect.poll(() => page.evaluate(() => {
        const selectors = ['[data-report-page-header]', '[data-testid="line-program-toolbar"]', '[aria-label="Итоги раздела"]', '[data-testid="line-program-card"]']
        const bounds = selectors.map(selector => document.querySelector(selector)!.getBoundingClientRect())
        return bounds.every(rect => Math.abs(rect.left - bounds[0].left) < 1 && Math.abs(rect.right - bounds[0].right) < 1)
      })).toBe(true)
      await expect(page.getByRole('main')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(page.locator('[data-scroll-top-boundary]')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(toolbar).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      const show = page.getByRole('button', { name: 'Показать', exact: true }), create = program.getByRole('button', { name: 'Новая линия', exact: true })
      for (const control of [show, create, program.getByLabel('Поиск программы линий')]) await expect(control).toHaveCSS('height', '40px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (width === 1600) await page.screenshot({ path: `outputs/line-program-white-${collapsed ? 'collapsed' : 'expanded'}.png` })
    }
  }
  await expect(program.getByTestId('line-program-card').first()).toHaveClass(/border-amber-300/)
  await expect(program.getByTestId('line-program-card').last()).toHaveClass(/border-slate-200/)
  await program.getByRole('button', { name: `Расчёт линии ${prefix}A`, exact: true }).click()
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await expect(program.getByTestId('line-program-all-joints')).toBeVisible()
  await page.screenshot({ path: 'outputs/line-program-white-details.png' })
  expect(calls.filter(name => name.startsWith('getLineProgramSection_'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('сводка всех клейм, послойный черновик и смена клейма без потери данных и повторных запросов', async ({ page }) => {
  const name = 'UNIFIED-SCOPES'
  await seed(name, 100, 5)
  await withE2eDatabase(async db => {
    await db.query("update line_programs set pvk_control_percent=30 where line=$1", [name])
    await db.query("update weld_joints set weld_date='2026-09-01',stamp_1_k='UNIFIED-A',stamp_1_k_fact='UNIFIED-A',pvk_control_percent=30,has_rk=case when joint in ('F2','F5') then 'да' end,has_uzk=case when joint='F3' then 'да' end,has_pvk=case when joint in ('F2','F3','F5') then 'да' end,connection_type=case when joint='F4' then 'У17' else 'СШ' end where line=$1", [name])
    await db.query("update weld_joints set stamp_1_o='UNIFIED-B' where line=$1 and joint='F1'", [name])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch { /* asset */ } })
  const program = await openLine(page, name)
  const summary = program.getByTestId('line-card-metrics')
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await expect(summary.locator('[data-line-metric]').first()).toHaveText('Клейм2')
  await expect(summary.getByRole('button', { name: 'ПВК · зачтено / нужно 2 / 3', exact: true })).toBeVisible()
  await expect(program.getByTestId('line-program-stamp')).toHaveCount(2)
  const pvkBadges = program.getByTestId('line-program-readonly-joint').filter({ has: page.getByText('ПВК: да', { exact: true }) }).getByText('ПВК: да', { exact: true })
  await expect(pvkBadges).toHaveCount(3) // Wait for the opened line's asynchronous joint query before measuring.
  const badges = await pvkBadges.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(), cell = element.closest('td')!.getBoundingClientRect(); return rect.width > 0 && rect.left >= cell.left && rect.right <= cell.right }))
  expect(badges).toHaveLength(3)
  expect(badges.every(Boolean)).toBe(true)
  await expect(program.getByText('Свернуть', { exact: true })).toHaveCount(0)
  const editor = await openAssignments(page)
  await expect(editor.getByTestId('assignment-guidance-common')).toContainText('Назначено: 3')
  await editor.getByRole('combobox', { name: 'F4 · Послойный ПВК' }).selectOption('да')
  await expect(editor.getByTestId('assignment-guidance-common')).toContainText('Назначено: 4')
  await expect(editor.getByTestId('assignment-guidance-common')).toContainText('К назначению: 1')
  await expect(editor.getByText(/С учётом несохранённых изменений/)).toBeVisible()
  await editor.getByRole('checkbox', { name: 'Выбрать F4', exact: true }).check()
  const scope = editor.getByRole('combobox', { name: 'Стыки в окне назначений' })
  await scope.selectOption('stamp:UNIFIED-B')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(1)
  await expect(editor.getByTestId('line-program-joint')).toContainText('F1')
  await expect(editor.getByRole('button', { name: 'Применить к выбранным (0)' })).toBeDisabled()
  await expect(editor.getByTestId('assignment-guidance-pvk')).toContainText('К назначению: 1')
  await scope.selectOption('')
  await expect(editor.getByRole('combobox', { name: 'F4 · Послойный ПВК' })).toHaveValue('да')
  await expect(editor.getByRole('combobox', { name: 'F4 · ПВК' })).toHaveValue('да')
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await program.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await program.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true }).click()
  await expect(program.locator('[data-scope="stamp:unified-a"]').getByTestId('line-program-readonly-joint')).toHaveCount(5)
  await program.getByTestId('line-program-stamp').filter({ hasText: 'UNIFIED-A' }).getByRole('button', { name: 'РК - УЗК: 3 / 5', exact: true }).click()
  await expect(program.locator('[data-scope="stamp:unified-a"]').getByTestId('line-program-readonly-joint')).toHaveCount(3)
  await page.screenshot({ path: 'outputs/line-program-all-stamps-20260928.png' })
  await openAssignments(page)
  await editor.getByRole('combobox', { name: 'Стыки в окне назначений' }).selectOption('')
  await expect(editor.getByRole('combobox', { name: 'F4 · Послойный ПВК' })).toHaveValue('да')
  await page.screenshot({ path: 'outputs/line-program-scope-modal-20260928.png' })
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramCalculation_'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('планирование до сварки: группа без клейма, смешанный С/У, панель действий и сохранение', async ({ page }) => {
  const name = 'UNIFIED-PRE-WELD'
  await seed(name, 30, 4)
  await withE2eDatabase(async db => {
    await db.query("update weld_joints set weld_date=null,stamp_1_k=null,stamp_1_k_fact=null where line=$1 and joint in ('F1','F2')", [name])
    await db.query("update weld_joints set weld_date=null,stamp_1_k='UNIFIED-B',stamp_1_k_fact='UNIFIED-B' where line=$1 and joint='F3'", [name])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch { /* asset */ } })
  const program = await openLine(page, name)
  const summary = program.getByTestId('line-card-metrics')
  const unstamped = program.getByTestId('line-program-unassigned')
  await expect(program.getByTestId('line-program-stamp')).toHaveCount(2)
  await expect(summary.getByRole('button', { name: 'Расчёт', exact: true })).toHaveCount(0)
  await expect(summary.getByRole('button', { name: 'РК - УЗК · зачтено / нужно 0 / 1', exact: true })).toBeVisible()
  await expect(unstamped).toContainText('Клеймо не назначено')
  expect(await unstamped.evaluate(element => element.nextElementSibling)).toBeNull()
  const aggregateColor = await unstamped.evaluate(element => getComputedStyle(element).backgroundColor)
  const stampColor = await program.getByTestId('line-program-stamp').first().evaluate(element => getComputedStyle(element).backgroundColor)
  expect(aggregateColor).not.toBe(stampColor)
  await program.getByRole('button', { name: 'Клеймо не назначено', exact: true }).click()
  await expect(program.getByTestId('line-program-readonly-joint')).toHaveCount(2)
  await expect(program.getByRole('button', { name: 'Назначения без клейма', exact: true })).toBeVisible()
  await expect(program.getByRole('button', { name: 'Расчёт без клейма', exact: true })).toBeDisabled()
  const editor = await openAssignments(page)
  const scope = editor.getByRole('combobox', { name: 'Стыки в окне назначений' })
  await expect(scope).toHaveValue('unassigned:')
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).toBeEnabled()
  await expect(editor.getByRole('combobox', { name: 'F2 · Послойный ПВК' })).toBeEnabled()
  await editor.getByRole('combobox', { name: 'F1 · РК' }).selectOption('дополнительный')
  await scope.selectOption('')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(4)
  for (const joint of ['F1','F2','F3','F4']) await editor.getByRole('checkbox', { name: 'Выбрать ' + joint, exact: true }).check()
  const toolbar = editor.getByTestId('program-method-toolbar')
  const actions = toolbar.getByRole('radiogroup', { name: 'Действие с назначениями' })
  for (const [action, color] of [['Да', 'rgb(52, 211, 153)'], ['Дополнительный', 'rgb(251, 191, 36)'], ['Отменен', 'rgb(251, 113, 133)'], ['Пусто', 'rgb(148, 163, 184)']]) {
    const radio = actions.getByRole('radio', { name: action, exact: true })
    await radio.click()
    await expect(radio).toHaveAttribute('aria-checked', 'true')
    await expect(radio).toHaveCSS('border-color', color)
  }
  await toolbar.getByRole('button', { name: 'Послойный ПВК', exact: true }).click()
  await expect(toolbar).toContainText('Пропущено С-стыков: 3')
  await expect(toolbar.getByRole('button', { name: 'ПВК', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const apply = toolbar.getByRole('button', { name: 'Применить к выбранным (1)', exact: true })
  await apply.click()
  await expect(editor.getByRole('combobox', { name: 'F2 · Послойный ПВК' })).toHaveValue('да')
  await expect(editor.getByRole('combobox', { name: 'F2 · ПВК' })).toHaveValue('да')
  await expect(editor.getByRole('combobox', { name: 'F1 · РК' })).toHaveValue('дополнительный')
  for (const joint of ['F1','F3','F4']) await expect(editor.getByRole('combobox', { name: joint + ' · ПВК' })).toHaveValue('')
  await scope.selectOption('stamp:UNIFIED-B')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(1)
  await expect(editor.getByTestId('line-program-joint')).toContainText('F3')
  await editor.getByRole('combobox', { name: 'F3 · УЗК' }).selectOption('да')
  await scope.selectOption('')
  await expect(editor.getByTestId('assignment-guidance-common')).toContainText('Назначено: 3') // F1 additional + layered F2 + normal F3
  await expect(editor.getByTestId('assignment-guidance-common')).toContainText('К назначению: 1')
  const reset = toolbar.getByRole('button', { name: 'Сбросить выбор' })
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    const resetBox = (await reset.boundingBox())!, applyBox = (await toolbar.getByRole('button', { name: /^Применить к выбранным/ }).boundingBox())!, barBox = (await toolbar.boundingBox())!
    expect(resetBox.x + resetBox.width).toBeLessThan(applyBox.x)
    expect(Math.abs(resetBox.y + resetBox.height / 2 - applyBox.y - applyBox.height / 2)).toBeLessThanOrEqual(1)
    expect(barBox.x + barBox.width - applyBox.x - applyBox.width).toBeLessThan(20)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await expect(editor.getByTestId('assignment-dialog-footer').getByRole('button', { name: /Сбросить/ })).toHaveCount(0)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.screenshot({ path: 'outputs/line-program-planning-modal-20260928.png' })
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 3')).toBeVisible()
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await expect(summary.getByRole('button', { name: 'РК - УЗК · зачтено / нужно 0 / 1', exact: true })).toBeVisible()
  await expect(unstamped).toContainText('назначено 2')
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await expect(program.locator('[data-scope="all:"]').getByTestId('line-program-readonly-joint')).toHaveCount(4)
  await expect(program.getByTestId('program-workspace-heading')).toHaveCount(0)
  await page.screenshot({ path: 'outputs/line-program-planning-groups-20260928.png' })
  const saved = await withE2eDatabase(async db => (await db.query("select joint,weld_date,stamp_1_k,has_rk,has_uzk,has_pvk,layered_control_assigned from weld_joints where line=$1 order by joint", [name])).rows)
  expect(saved[0]).toMatchObject({ weld_date: null, stamp_1_k: null, has_rk: 'дополнительный', has_pvk: null, layered_control_assigned: false })
  expect(saved[1]).toMatchObject({ weld_date: null, stamp_1_k: null, has_pvk: 'да', layered_control_assigned: true })
  expect(saved[2]).toMatchObject({ weld_date: null, stamp_1_k: 'UNIFIED-B', has_uzk: 'да', has_pvk: null })
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(2)
  expect(calls.filter(call => call.startsWith('getLineProgramCalculation_'))).toHaveLength(2)
  expect(errors).toEqual([])
})

test('несколько линий, клейм и историй открываются независимо; переход к назначению без сортировки', async ({ page }) => {
  await seed('UNIFIED-MULTI-A', 100, 4)
  await seed('UNIFIED-MULTI-B', 30, 3)
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch { /* asset */ } })
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill('UNIFIED-MULTI')
  const a = program.locator('[data-line="UNIFIED-MULTI-A"]'), b = program.locator('[data-line="UNIFIED-MULTI-B"]')
  await a.getByRole('button', { name: 'Расчёт линии UNIFIED-MULTI-A', exact: true }).click()
  await b.getByRole('button', { name: 'Расчёт линии UNIFIED-MULTI-B', exact: true }).click()
  await expect(a.getByRole('button', { name: 'Расчёт линии UNIFIED-MULTI-A', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await a.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true }).click()
  const all = a.locator('[data-scope="all:"]'), stamp = a.locator('[data-scope="stamp:unified-a"]')
  await expect(stamp).toBeVisible()
  await a.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await expect(all).toBeVisible()
  await expect(stamp).toBeHidden()
  // One thin outer frame; expanded record lists no longer add nested card borders.
  await expect(a).toHaveCSS('border-left-width', '1px')
  await expect(all.locator('section').first()).toHaveCSS('border-left-width', '0px')
  for (const name of ['F1', 'F2']) await all.getByRole('button', { name, exact: true }).click()
  await expect(all.getByLabel('История контроля F1', { exact: true })).toBeVisible()
  await expect(all.getByLabel('История контроля F2', { exact: true })).toBeVisible()
  await a.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await a.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true }).click()
  await expect(stamp).toBeHidden()
  await a.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await expect(all).toBeVisible()
  await expect(all.getByLabel('История контроля F1', { exact: true })).toBeVisible()
  await a.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await a.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true }).click()
  await a.getByRole('button', { name: 'Назначения клейма UNIFIED-A', exact: true }).click()
  const editor = page.getByRole('dialog', { name: /^Назначения ·/ })
  await editor.getByRole('combobox', { name: 'F3 · РК' }).selectOption('да')
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await a.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await all.getByTestId('line-program-readonly-joint').filter({ hasText: 'F4' }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Перейти к назначениям стыка', exact: true }).click()
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(4)
  expect(await editor.getByTestId('line-program-joint').evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id')))).toEqual(
    await withE2eDatabase(async db => (await db.query("select id::text from weld_joints where line='UNIFIED-MULTI-A' order by weld_joints.id")).rows.map(row => row.id)))
  await expect(editor.getByTestId('line-program-joint').filter({ hasText: 'F4' })).toHaveAttribute('data-highlighted', 'true')
  await expect(editor.getByRole('combobox', { name: 'F3 · РК' })).toHaveValue('да')
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await expect(all.getByLabel('История контроля F1', { exact: true })).toBeVisible()
  await expect(all.getByLabel('История контроля F2', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'outputs/line-program-multiple-blocks-20260928.png' })
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramCalculation_'))).toHaveLength(2)
  expect(errors).toEqual([])
})

test('лишнее: согласованные методы и доп отдельно, жёлтые кандидаты только без защищённой истории', async ({ page }) => {
  const name = 'UNIFIED-SURPLUS'
  const id = await seed(name, 30, 10)
  await withE2eDatabase(async db => {
    await db.query("update weld_joints set has_rk=case when joint='F4' then 'дополнительный' when joint in ('F1','F2','F3','F5','F6') then 'да' end,has_uzk=case when joint in ('F3','F5') then 'да' end,rk_result=case when joint in ('F1','F6') then 'годен' end,rk_conclusion=case when joint in ('F1','F6') then 'FACT-'||joint end where line=$1", [name])
    const source = (await db.query('select id,joint,connection_type as "connectionType",weld_date::text as "weldDate",stamp_1_k as "stamp1K",has_rk as "hasRk",has_uzk as "hasUzk",rk_result as "rkResult" from weld_joints where line=$1 order by id', [name])).rows
    const joint = source.find(row => row.joint === 'F5')
    const accepted = programExcessEntries(id, source, calculateLineProgram(source, 30, 10)).filter(entry => entry.rowId === joint.id && entry.duplicate)
    expect(accepted).toHaveLength(1)
    // Current approvals are owned by the joint; legacy key-only records belong
    // to the separately tested object-backfill workflow.
    await db.query("insert into dispatcher_accepted_warnings (key,kind,title,context,weld_joint_id) values ($1,'line-program-control','Согласованы методы','E2E',$2)", [accepted[0].key, joint.id])
  })
  const program = await openLine(page, name), card = program.getByTestId('line-program-card')
  // Six covered joints (five yes + one additional), quota three: three ordinary excess plus one unapproved duplicate.
  await expect(card.getByRole('button', { name: 'Лишнее 4', exact: true })).toBeVisible()
  for (const width of [1013, 1600]) {
    await page.setViewportSize({ width, height: 1050 })
    for (const metric of [program.getByLabel('Итоги раздела').getByTestId('excess-metric'), card.getByTestId('line-card-metrics')]) {
      const compact = await metric.getAttribute('data-testid') === 'line-card-metrics'
      expect(await metric.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true)
      expect((await metric.boundingBox())!.height).toBeLessThanOrEqual(compact ? (width < 1280 ? 160 : 100) : 80)
      if (!compact) expect(await metric.evaluate(el => {
        const excess = el.querySelector('strong')!.getBoundingClientRect()
        const reduction = el.querySelector('button[aria-label^="Возможное сокращение"] > span:last-child')!.getBoundingClientRect()
        return Math.abs(excess.right - reduction.right)
      })).toBeLessThan(1)
      const more = metric.getByRole('button', { name: 'Ещё показатели контроля' })
      if (compact) {
        await expect(more).toHaveText('Ещё')
        await expect(more).toHaveCSS('border-top-width', '1px')
      }
      await more.press('Enter')
      const details = page.getByRole('dialog', { name: 'Другие показатели контроля' })
      await expect(details.getByRole('button', { name: 'Согласовано: 1' })).toBeFocused()
      const box = (await details.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      await details.press('Escape')
      await expect(more).toBeFocused()
    }
  }
  await expect(card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true })).toHaveAttribute('aria-expanded', 'true')
  await card.getByRole('button', { name: 'Ещё показатели контроля' }).click()
  const controlDetails = page.getByRole('dialog', { name: 'Другие показатели контроля' })
  await expect(controlDetails.getByRole('button', { name: 'Согласовано: 1', exact: true })).toBeVisible()
  await expect(controlDetails.getByRole('button', { name: 'Дополнительные стыки: 1', exact: true })).toBeVisible()
  await controlDetails.press('Escape')
  // Real pointer clicks, not only Enter/synthetic clicks: both summary filters
  // and both line selections must survive focus changes inside the popover.
  for (const [choice, filter] of [['Согласовано: 1', 'Есть согласованное превышение'], ['Дополнительные стыки: 1', 'Есть дополнительные стыки']]) {
    await program.getByLabel('Итоги раздела').getByRole('button', { name: 'Ещё показатели контроля' }).click()
    await controlDetails.getByRole('button', { name: choice, exact: true }).click()
    await expect(program.getByTestId('line-program-filter')).toContainText(filter)
    await expect(controlDetails).toHaveCount(0)
    await program.getByRole('button', { name: 'Сбросить фильтр' }).click()
  }
  for (const [choice, joint] of [['Согласовано: 1', 'F5'], ['Дополнительные стыки: 1', 'F4']]) {
    await card.getByRole('button', { name: 'Ещё показатели контроля' }).click()
    await controlDetails.getByRole('button', { name: choice, exact: true }).click()
    await expect(program.getByTestId('line-program-readonly-joint')).toHaveCount(1)
    await expect(program.getByTestId('line-program-readonly-joint').getByRole('button', { name: joint, exact: true })).toBeVisible()
    await expect(controlDetails).toHaveCount(0)
  }
  await expect(program.getByTestId('line-card-metrics').getByRole('button', { name: 'Лишнее 4', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Учитываемых соединений 10', exact: true }).click()
  const f3 = program.getByTestId('line-program-readonly-joint').filter({ hasText: 'F3' })
  await expect(f3.getByRole('button', { name: 'Назначение F3 · УЗК: да', exact: true })).toHaveAttribute('data-removal-candidate', 'true')
  await expect(f3.getByRole('button', { name: 'Назначение F3 · УЗК: да', exact: true })).toHaveCSS('border-style', 'dashed')
  // Protected F6 no longer hides the removable F2 alternative: F2 RK + F3 RK/UZK.
  await expect(program.locator('[data-removal-candidate="true"]')).toHaveCount(3)
  await expect(card.getByRole('button', { name: 'Возможное сокращение 3', exact: true })).toBeVisible()
  const editor = await openAssignments(page)
  await expect(editor.getByRole('combobox', { name: 'F3 · УЗК' })).toHaveAttribute('data-removal-candidate', 'true')
  await expect(editor.getByRole('combobox', { name: 'F5 · УЗК' })).not.toHaveAttribute('data-removal-candidate', 'true')
  await expect(editor.getByRole('combobox', { name: 'F6 · РК' }).locator('option[value=""]')).toBeDisabled()
  await page.screenshot({ path: 'outputs/line-program-excess-hints-20260928.png' })
  await editor.getByRole('combobox', { name: 'F3 · УЗК' }).selectOption('')
  await expect(editor.locator('[data-removal-candidate="true"]')).toHaveCount(2)
  await expect(editor.getByRole('combobox', { name: 'F3 · РК' })).toHaveAttribute('data-removal-candidate', 'true')
  await editor.getByRole('combobox', { name: 'F3 · РК' }).selectOption('')
  await expect(editor.locator('[data-removal-candidate="true"]')).toHaveCount(1)
  await expect(editor.getByRole('combobox', { name: 'F2 · РК' })).toHaveAttribute('data-removal-candidate', 'true')
  await editor.getByRole('combobox', { name: 'F2 · РК' }).selectOption('')
  await expect(editor.locator('[data-removal-candidate="true"]')).toHaveCount(0)
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 2')).toBeVisible()
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await expect(card.getByRole('button', { name: 'Лишнее 1', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: /^Возможное сокращение/ })).toHaveCount(0)
  await expect(program.getByTestId('line-card-metrics').getByRole('button', { name: /^Возможное сокращение/ })).toHaveCount(0)
  await expect(program.getByTestId('line-card-metrics').getByRole('button', { name: 'Лишнее 1', exact: true })).toBeVisible()
})

test('просмотр отдельно от назначений: размеры окон, сохранение черновика, виды, цвета и смена раздела', async ({ page }) => {
  const name = 'UNIFIED-POLISH'
  await seed(name, 10, 6)
  await withE2eDatabase(db => db.query(`update weld_joints set
    has_rk = case when joint in ('F1','F2') then 'да' when joint='F3' then 'дополнительный' else null end,
    has_pvk = case when joint='F1' then 'да' when joint='F3' then 'дополнительный' else null end,
    rk_result = case when joint='F1' then 'годен' else null end,
    rk_conclusion = case when joint='F1' then 'РК-2026-123' else null end
    where line=$1`, [name]))
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch { /* built RPC ID */ } })
  await page.goto('/percentage-lines?source=bookmark#program')
  await expect(page).toHaveURL(/\/line-program\?source=bookmark#program$/)
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(name)
  const card = program.getByTestId('line-program-card')
  await expect(card).toHaveCount(1)
  await expect(card).toHaveClass(/border-slate-200/)
  const excess = card.getByTestId('line-card-metrics')
  // Additional F3 closes both quotas: RK now has two excess yes, PVK has one.
  await expect(excess.getByRole('button', { name: 'Лишнее 3', exact: true })).toBeVisible()
  await excess.getByRole('button', { name: 'Ещё показатели контроля' }).click()
  await expect(page.getByRole('dialog', { name: 'Другие показатели контроля' }).getByRole('button', { name: 'Дополнительные стыки: 1' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Другие показатели контроля' }).press('Escape')
  const remainingBox = await card.getByRole('button', { name: 'К назначению 0', exact: true }).boundingBox()
  const excessBox = await excess.getByRole('button', { name: 'Лишнее 3', exact: true }).boundingBox()
  expect(excessBox!.height).toBeLessThanOrEqual(40)
  expect(remainingBox!.height).toBeLessThanOrEqual(48)
  expect(Math.abs(excessBox!.y - remainingBox!.y)).toBeLessThanOrEqual(1)
  await card.getByRole('button', { name: `Расчёт линии ${name}` }).click()
  for (const group of [card.getByTestId('line-program-stamp')]) {
    await expect(group.getByRole('button', { name: 'Расчёт закрыт', exact: true, includeHidden: true })).toHaveCSS('color', 'rgb(6, 95, 70)')
    await expect(group.getByRole('button', { name: 'Лишнее: 3', exact: true, includeHidden: true })).toHaveCSS('font-weight', '600')
  }
  const stamp = card.getByRole('button', { name: 'Клеймо UNIFIED-A', exact: true })
  await stamp.scrollIntoViewIfNeeded()
  const stampY = (await stamp.boundingBox())!.y
  const scrollY = await page.evaluate(() => window.scrollY)
  await stamp.click()
  await expect(card.getByTestId('line-program-readonly-joint')).toHaveCount(6)
  // Wait past both former requestAnimationFrame callbacks: choosing a stamp must not scroll the page.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  expect((await stamp.boundingBox())!.y).toBe(stampY)
  await stamp.click()
  await expect(stamp).toHaveAttribute('aria-expanded', 'false')
  await expect(card.getByRole('table', { name: 'Назначения и результаты' })).toBeHidden()
  await stamp.click()
  await expect(stamp).toHaveAttribute('aria-expanded', 'true')
  expect(await card.getByTestId('stamp-joints-container').evaluate(element => element.previousElementSibling?.getAttribute('data-stamp'))).toBe('UNIFIED-A')
  await expect(card.getByRole('button', { name: 'Назначения клейма UNIFIED-A', exact: true })).toBeVisible()
  const table = card.getByRole('table', { name: 'Назначения и результаты' })
  await expect(table.getByRole('checkbox')).toHaveCount(0)
  await expect(card.getByTestId('program-method-toolbar')).toHaveCount(0)
  await expect(card.getByRole('combobox', { name: 'Вид таблицы стыков' })).toHaveCount(0)
  await expect(table.getByRole('columnheader')).toHaveCount(4)
  await table.getByRole('button', { name: 'F1', exact: true }).click()
  await expect(table.getByRole('button', { name: 'РК-2026-123', exact: true })).toBeVisible()
  await table.getByRole('button', { name: 'F1', exact: true }).click()
  const editor = await openAssignments(page)
  await expect(editor.getByRole('combobox', { name: 'Вид таблицы стыков' })).toHaveCount(0)
  await expect(editor.getByText('Выберите методы, затем отметьте стыки. Изменения применятся после проверки и сохранения.')).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Ещё', exact: true })).toHaveCount(0)
  const search = editor.getByRole('textbox', { name: 'Поиск стыков в назначениях' })
  await expect(editor.getByTestId('assignment-dialog-header').getByRole('textbox', { name: 'Поиск стыков в назначениях' })).toBeVisible()
  await expect(editor.getByTestId('program-method-toolbar').getByRole('textbox')).toHaveCount(0)
  await search.fill('F2')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(1)
  const candidates = editor.getByRole('button', { name: 'Выделить кандидатов на снятие' })
  await expect(candidates).toHaveCount(1)
  await expect(candidates).toHaveText('Кандидаты на снятие: 1 · Выделить')
  await candidates.click()
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F2', exact: true })).toBeChecked()
  await expect(editor.getByRole('combobox', { name: 'F2 · РК', exact: true })).toHaveValue('да')
  await expect(editor.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled()
  await editor.getByRole('button', { name: 'Сбросить выбор' }).click()
  await search.fill('UNIFIED-A')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(6)
  await search.fill('РК да')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(2)
  await search.fill('missing joint')
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(0)
  await expect(candidates).toHaveCount(0)
  await editor.getByRole('button', { name: 'Очистить поиск стыков' }).click()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(editor.getByTestId('line-program-joint')).toHaveCount(6)
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    expect((await editor.boundingBox())!.width).toBe(Math.min(1480, width - 32))
    const header = editor.getByTestId('assignment-dialog-header')
    expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect.poll(() => header.evaluate(element => {
      const search = element.querySelector('input')!.getBoundingClientRect()
      const scope = element.querySelector('select')!.getBoundingClientRect()
      const filters = element.querySelector('[data-testid="assignment-dialog-filters"]')!
      const close = element.querySelector('button[aria-label="Закрыть назначения"]')!
      return Math.abs(search.y - scope.y) < 1 && Math.abs(search.height - scope.height) < 1
        && search.right < scope.left && !filters.contains(close)
        && filters.scrollWidth <= filters.clientWidth
    })).toBe(true)
    if (width === 1600) {
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(120)
      const searchBox = (await search.boundingBox())!, scopeBox = (await editor.getByLabel('Стыки в окне назначений').boundingBox())!
      expect(searchBox.x + searchBox.width).toBeLessThan(scopeBox.x)
    }
    expect(await editor.getByTestId('assignment-dialog-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const footer = editor.getByTestId('assignment-dialog-footer')
    const check = await footer.getByRole('button', { name: 'Проверить изменения' }).boundingBox()
    const back = await footer.getByRole('button', { name: 'Вернуться к просмотру' }).boundingBox()
    expect(check!.y).toBe(back!.y)
    expect((await footer.boundingBox())!.height).toBeLessThan(80)
    for (const method of ['РК', 'УЗК', 'ПВК', 'Послойный ПВК']) {
      const button = editor.getByRole('button', { name: method, exact: true })
      await button.scrollIntoViewIfNeeded()
      const before = await button.boundingBox()
      const toolbarBefore = await editor.getByTestId('program-method-toolbar').boundingBox()
      await button.click()
      expect((await button.boundingBox())?.width).toBe(before?.width)
      expect((await button.boundingBox())?.height).toBe(before?.height)
      expect((await editor.getByTestId('program-method-toolbar').boundingBox())?.height).toBe(toolbarBefore?.height)
      expect(await button.locator('svg').count()).toBe(0)
      await button.click()
    }
    await editor.getByRole('button', { name: 'РК', exact: true }).click()
    const geometry = () => editor.getByTestId('line-program-joint').evaluateAll(rows => rows.map(row => ({ height: row.getBoundingClientRect().height, cells: Array.from(row.children).map(cell => { const box = cell.getBoundingClientRect(); return [box.x, box.y, box.width] }) })))
    const before = await geometry(), panelBefore = await editor.boundingBox()
    for (const joint of ['F3', 'F4']) {
      const checkbox = editor.getByRole('checkbox', { name: `Выбрать ${joint}`, exact: true })
      await checkbox.check()
      expect(await geometry()).toEqual(before)
      expect(await editor.boundingBox()).toEqual(panelBefore)
      await expect(checkbox).toBeFocused()
    }
    await editor.getByRole('checkbox', { name: 'Выбрать все доступные стыки' }).check()
    expect(await geometry()).toEqual(before)
    await editor.getByRole('checkbox', { name: 'Выбрать все доступные стыки' }).uncheck()
    expect(await geometry()).toEqual(before)
    await editor.getByRole('button', { name: 'РК', exact: true }).click()
  }
  await editor.getByRole('button', { name: 'РК', exact: true }).click()
  await editor.getByRole('checkbox', { name: 'Выбрать F4', exact: true }).check()
  await editor.getByRole('button', { name: /^Применить к выбранным/ }).click()
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F4', exact: true })).toBeChecked()
  await expect(editor.getByTestId('line-program-joint').filter({ hasText: 'F4' })).toContainText('было: —')
  await expect(editor.getByText('было: —')).toHaveCSS('font-weight', '600')
  await expect(editor.getByText(/подробнее при наведении/)).toHaveCount(0)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.screenshot({ path: 'outputs/line-program-assignment-modal-20260928.png' })
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await expect(editor).toBeHidden()
  await expect(card.getByRole('button', { name: /Назначения.*черновик: 1/ })).toBeFocused()
  await expect(table.getByTestId('line-program-readonly-joint').filter({ hasText: 'F4' })).not.toContainText('РК: да')
  await expect(card.getByRole('checkbox')).toHaveCount(0)
  await card.getByTestId('program-scope-actions').getByRole('button', { name: /^Расчёт/ }).click()
  const calculation = page.getByRole('dialog', { name: `Расчёт · ${name}` })
  for (const width of [1600, 1000, 600, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    expect((await calculation.boundingBox())!.width).toBeGreaterThan(Math.min(1100, width - 40))
    expect(await calculation.getByTestId('line-calculation-dialog-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openAssignments(page)
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F4', exact: true })).toBeChecked()
  await expect(editor.getByTestId('line-program-joint').filter({ hasText: 'F4' })).toContainText('было: —')
  await editor.getByRole('button', { name: 'Закрыть назначения' }).press('Tab')
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  expect(calls.filter(name => name.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(calls.filter(name => name.startsWith('previewLineProgramControl_') || name.startsWith('applyLineProgramControl_'))).toHaveLength(0)
  await page.screenshot({ path: 'outputs/line-program-readonly-20260928.png' })
  await program.getByRole('button', { name: 'Процентные линии', exact: true }).click()
  for (const [percent, targetTab, otherTab] of [[100, '100%-ные линии', 'Процентные линии'], [10, 'Процентные линии', '100%-ные линии']] as const) {
    await expect(card.getByRole('button', { name: 'Настроить', exact: true })).toHaveCount(0)
    await program.getByRole('button', { name: 'Все линии', exact: true }).click()
    await card.getByRole('button', { name: 'Настроить', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Настройка линии' })
    await settings.getByLabel('Базовый % контроля', { exact: true }).fill(String(percent))
    await settings.getByRole('button', { name: 'Сохранить программу', exact: true }).click()
    await expect(settings).toBeHidden()
    await expect(program.getByRole('button', { name: 'Все линии', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await program.getByRole('button', { name: otherTab, exact: true }).click()
    await expect(card).toHaveCount(0)
    await program.getByRole('button', { name: targetTab, exact: true }).click()
    await expect(card).toHaveCount(1)
  }
  expect(errors).toEqual([])
})

test('краткий просмотр: история по строке, этапы и колонки, ссылки без потери места', async ({ page }) => {
  const name = 'UNIFIED-HISTORY'
  await seed(name, 30, 3)
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set has_rk='отменен', has_uzk='дополнительный', has_pvk='да',
      rk_request='HISTORY-RK-REQ', rk_request_date='2026-09-10', rk_result='годен', rk_conclusion='HISTORY-RK-RES', rk_conclusion_date='2026-09-11', lnk_defect_description='ДНО',
      psto_request='HISTORY-PSTO-REQ', psto_request_date='2026-09-03', psto_date='2026-09-04', psto_result='проведено', heat_treatment_diagram='HISTORY-PSTO-RES',
      tvmt_request='HISTORY-TVMT-REQ', tvmt_request_date='2026-09-05', tvmt_result='годен', tvmt_conclusion='HISTORY-TVMT-RES', tvmt_conclusion_date='2026-09-06'
      where line=$1 and joint='F1'`, [name])
    await db.query(`insert into pre_heat_treatment_controls (weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      select id,'РК','HISTORY-PRE-REQ','2026-09-01','годен','HISTORY-PRE-RES','2026-09-02','ДНО' from weld_joints where line=$1 and joint='F1'`, [name])
    const { rows: [doc] } = await db.query("insert into generated_documents(type,title,file_name,mime_type) values ('layeredPvkEdges','HISTORY-LAYERED','history.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') returning id")
    await db.query("insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,id from weld_joints where line=$2 and joint='F2'", [doc.id, name])
  })
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch { /* built RPC ID */ } })
  const program = await openLine(page, name)
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const first = program.getByTestId('line-program-readonly-joint').filter({ hasText: 'F1' })
  await expect(first.getByText('РК: отменен')).toHaveCSS('color', 'rgb(190, 18, 60)')
  await expect(first.getByText('УЗК: доп')).toHaveCSS('color', 'rgb(3, 105, 161)')
  await expect(first.getByText('ПВК: да')).toHaveCSS('color', 'rgb(4, 120, 87)')
  await expect(first.getByRole('button', { name: /В журнал|НК до ТО/ })).toHaveCount(0)
  for (const status of ['РК: отменен', 'УЗК: доп', 'ПВК: да']) {
    const button = first.getByRole('button', { name: `Назначение F1 · ${status}`, exact: true })
    await button.scrollIntoViewIfNeeded()
    const position = await page.evaluate(() => window.scrollY)
    await button.click()
    const modal = page.getByRole('dialog', { name: `Назначения · ${name}` })
    await expect(modal.getByRole('button', { name: 'Применить к выбранным (0)' })).toBeDisabled()
    await expect(modal.getByRole('combobox', { name: `F1 · ${status.split(':')[0]}` })).toHaveClass(/ring-2/)
    await expect(modal.getByLabel('Подсказка по назначениям')).toBeVisible()
    await modal.getByRole('button', { name: 'Закрыть назначения' }).click()
    await expect(button).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(position)
  }
  const emptyAssignment = program.getByRole('button', { name: 'Назначение F3: нет назначений' })
  await emptyAssignment.click()
  const emptyModal = page.getByRole('dialog', { name: `Назначения · ${name}` })
  await expect(emptyModal.getByTestId('line-program-joint').first()).toContainText('F1')
  await expect(emptyModal.getByTestId('line-program-joint').filter({ hasText: 'F3' })).toHaveAttribute('data-highlighted', 'true')
  await expect(emptyModal.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled()
  await emptyModal.getByRole('button', { name: 'Закрыть назначения' }).click()
  await first.locator('time').click()
  const history = program.getByLabel('История контроля F1', { exact: true })
  await expect(history).toBeVisible()
  await expect(history.getByText('Стык F1', { exact: true })).toBeVisible()
  await expect(history.getByText('11.09.2026', { exact: true })).toBeVisible()
  await expect(history.getByText('2026-09-11', { exact: true })).toHaveCount(0)
  for (const row of await history.getByTestId('control-history-row').all()) await expect(row).toHaveClass(/bg-emerald-50/)
  await expect(history.getByRole('heading')).toHaveText(['НК до ТО', 'ПСТО и ТВМТ', 'Основной этап', 'Основания назначений'])
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    const columns = await history.getByTestId('control-history-row').evaluateAll(rows => rows.map(row => Array.from(row.children).map(cell => cell.getBoundingClientRect().x)))
    expect(columns.length).toBe(4) // pre-heat RK, PSTO, TVMT and primary RK
    for (const positions of columns) expect(positions).toEqual(columns[0])
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await first.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'outputs/line-program-compact-history-20260928.png' })
  const document = history.getByRole('button', { name: 'HISTORY-RK-RES', exact: true })
  await document.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  const popupPromise = page.waitForEvent('popup')
  await document.click()
  const popup = await popupPromise
  // This disposable database intentionally has no templates: show the normal document-preview explanation.
  await expect(popup.getByText('Шаблон системного документа не загружен.')).toBeVisible()
  await popup.close()
  await expect(history).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await first.locator('time').click()
  await expect(history).toHaveCount(0)
  await program.getByRole('button', { name: 'F2', exact: true }).click()
  await expect(program.getByRole('button', { name: 'HISTORY-LAYERED', exact: true })).toBeVisible()
  expect(calls.filter(name => name.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(calls.filter(name => name.startsWith('applyLineProgramControl_') || name.startsWith('previewLineProgramControl_'))).toHaveLength(0)
  expect(errors).toEqual([])
})

test('100%: страницы стыков, планирование до сварки, ПВК10 по клеймам и сохранение черновика', async ({ page }) => {
  await seed('UNIFIED-FULL', 100, 120)
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const id = new URL(request.url()).pathname.split('/_serverFn/')[1]; if (id) try { calls.push(rpcName(request.url())) } catch { /* built RPC ID */ } })
  const program = await openLine(page, 'UNIFIED-FULL')
  await expect(program.getByTestId('line-program-readonly-joint')).toHaveCount(0)
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await expect(program.getByTestId('line-program-readonly-joint')).toHaveCount(50)
  await expect(program.locator('[data-testid="line-program-readonly-joint"][data-joint="F1"]')).toContainText('ожидает сварку')
  await expect(program.getByRole('navigation', { name: 'Страницы стыков списка' })).toHaveCount(1)
  await program.getByTestId('program-scope-actions').getByRole('button', { name: /^Расчёт/ }).click()
  const calculation = page.getByRole('dialog', { name: 'Расчёт · UNIFIED-FULL' })
  await expect(calculation).toContainText('ПВК — отдельно 10%')
  await calculation.getByLabel('Клеймо в расчёте').selectOption('UNIFIED-A')
  await expect(calculation.getByTestId('demand-pvk')).toContainText('Расчётная норма 12')
  // The selected stamp owns 119 joints; the remaining unstamped joint belongs only to the line's 120.
  await expect(calculation.getByTestId('demand-common')).toContainText('Расчётная норма 119')
  await calculation.getByRole('button', { name: 'Вернуться к стыкам' }).click()
  const editor = await openAssignments(page)
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).toBeEnabled()
  await expect(editor.getByTestId('line-program-joint').first()).toContainText('ожидает сварку')
  await expect(editor.getByTestId('line-program-joint').nth(1)).toContainText('01.09.2026')
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    const body = editor.getByTestId('assignment-dialog-body'), header = editor.getByTestId('assignment-table-header')
    const top = (await header.boundingBox())!.y
    await body.evaluate(element => { element.scrollTop = 700 })
    await expect.poll(async () => Math.abs((await header.boundingBox())!.y - top)).toBeLessThanOrEqual(1)
    expect(await header.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + 10)) })).toBe(true)
    await body.evaluate(element => { element.scrollTop = 0 })
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await editor.getByRole('button', { name: 'РК', exact: true }).click()
  await editor.getByTestId('line-program-joint').first().locator('td').nth(1).click({ position: { x: 10, y: 30 } })
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).toBeChecked()
  await editor.getByRole('button', { name: /^Применить к выбранным/ }).click()
  await expect(editor.getByTestId('line-program-joint').first()).toContainText('было: —')
  await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await program.getByRole('button', { name: 'Расчёт линии UNIFIED-FULL' }).click()
  await program.getByRole('button', { name: 'Расчёт линии UNIFIED-FULL' }).click()
  await openAssignments(page)
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).toBeChecked()
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(editor.getByRole('button', { name: 'Сохранить назначения' })).toBeVisible()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  expect(await withE2eDatabase(async db => (await db.query("select has_rk,weld_date,stamp_1_k from weld_joints where line='UNIFIED-FULL' and joint='F1'")).rows[0])).toEqual({ has_rk: 'да', weld_date: null, stamp_1_k: null })
  await expect(editor.getByRole('columnheader', { name: 'Результаты', exact: true })).toHaveCount(0)
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.screenshot({ path: 'outputs/line-program-unified-full.png' })
  expect(calls.filter(name => name?.startsWith('getLineProgramJointPage_')).length).toBeLessThanOrEqual(2)
  expect(errors).toEqual([])
})

test('процентная линия: несколько методов, явное согласие сверх нормы, замена без потери результата, stale preview', async ({ page }) => {
  const id = await seed('UNIFIED-PERCENT', 10, 20)
  const program = await openLine(page, 'UNIFIED-PERCENT')
  await expect(program.getByRole('table', { name: 'Расчёт по клеймам' }).getByRole('columnheader')).toHaveCount(8)
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const editor = await openAssignments(page)
  for (const method of ['РК', 'УЗК', 'ПВК']) await editor.getByRole('button', { name: method, exact: true }).click()
  for (const joint of ['F1', 'F3', 'F4']) await editor.getByRole('checkbox', { name: `Выбрать ${joint}`, exact: true }).check()
  await editor.getByRole('button', { name: /^Применить к выбранным/ }).click()
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  const save = editor.getByRole('button', { name: 'Сохранить назначения' })
  await expect(save).toBeDisabled()
  await editor.getByRole('checkbox', { name: /Подтверждаю назначение сверх нормы/ }).check()
  await save.click()
  await expect(editor.getByText('Назначения сохранены · стыков: 3')).toBeVisible()
  // Approval is attached to the joint object, not encoded line names/percentages.
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int as n from dispatcher_accepted_warnings a join weld_joints w on w.id=a.weld_joint_id where a.kind=$1 and w.line_program_id=$2', ['line-program-control', id])).rows[0].n)).toBeGreaterThan(0)
  await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await program.getByTestId('line-program-card').getByRole('button', { name: 'Ещё показатели контроля' }).click()
  await expect(page.getByRole('dialog', { name: 'Другие показатели контроля' }).getByRole('button', { name: /^Согласовано:/ })).toBeVisible()
  await page.getByRole('dialog', { name: 'Другие показатели контроля' }).press('Escape')
  await expect(program.getByTestId('line-program-readonly-joint').first()).toContainText('РК: да')
  await openAssignments(page)
  await editor.getByRole('combobox', { name: 'F1 · РК', exact: true }).selectOption('дополнительный')
  await expect(editor.getByTestId('line-program-joint').first()).toContainText('было: да')
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(save).toBeVisible()
  await withE2eDatabase(db => db.query("update weld_joints set updated_at=now() where line='UNIFIED-PERCENT' and joint='F20'"))
  const confirmation = editor.getByRole('checkbox', { name: /Подтверждаю назначение сверх нормы/ })
  if (await confirmation.count()) await confirmation.check()
  await save.click()
  await expect(editor.getByRole('alert')).toContainText('Расчёт или выбор изменился')
  expect(await withE2eDatabase(async db => (await db.query("select has_rk from weld_joints where line='UNIFIED-PERCENT' and joint='F1'")).rows[0].has_rk)).toBe('да')
  await page.screenshot({ path: 'outputs/line-program-unified-percent.png' })
})
