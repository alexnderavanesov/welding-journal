import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

test.afterEach(async () => {
  await cleanupLineProgramProjects(['E2E compact-next'])
  await withE2eDatabase(db => db.query("delete from welder_stamps where naks_stamp in ('DENSE-FIO-A','DENSE-FIO-C')"))
})

async function seed(name: string, count: number) {
  return withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ('E2E compact-next','DENSE',$1,'II','A',100,10) returning id`, [name])
    await db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,category,group_name,weld_control_percent,pvk_control_percent,has_vik,has_rk,has_pvk,vik_result,rk_result,pvk_result,stamp_1_k,officiality,revision_actuality)
      select $1,'E2E compact-next','DENSE',$2,'F'||n,date '2026-09-01','С17','II','A',100,10,'да','да','да','годен','годен','годен',case when n<=$3/2 then 'DENSE-A' else 'DENSE-B' end,'действующий','актуальная' from generate_series(1,$3::int) n`, [line.id, name, count])
    return line.id
  })
}

test('компактная завершённая линия: все стыки, клейма, поиск, пагинация и назначения без повторной загрузки', async ({ page }) => {
  const name='DENSE-FINISHED'
  await seed(name, 120)
  const calls: string[]=[], errors: string[]=[]
  page.on('request', request => { if(request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error=>errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(name)
  const card=page.getByTestId('line-program-card')
  // Search is debounced; the full suite has other lines on the initial page.
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('data-program-finished','true')
  await expect(card.getByText('✓ Линия завершена')).toBeVisible()
  await expect.poll(() => card.getByTestId('line-card-metrics').getByRole('progressbar').evaluateAll(bars => {
    const [common, pvk] = bars.map(bar => bar.getBoundingClientRect())
    return Math.abs(common.y - pvk.y) < 1 && Math.abs(common.width - pvk.width) < 1 && common.width <= 153
  })).toBe(true)
  const count = card.getByRole('button', { name: 'Учитываемых соединений 120', exact: true })
  expect(await count.evaluate(element => {
    const label = element.querySelector('[data-metric-label]')!.getBoundingClientRect()
    const value = element.querySelector('[data-metric-value]')!.getBoundingClientRect()
    return value.top < label.bottom && label.top < value.bottom
  })).toBe(true)
  await card.getByRole('button',{name:`Расчёт линии ${name}`,exact:true}).click()
  await expect(card.getByRole('button',{name:'По клеймам',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(card.locator('[data-testid="line-program-readonly-joint"]:visible')).toHaveCount(0)
  expect(calls.filter(x=>x.startsWith('getLineProgramJointPage_'))).toHaveLength(0)
  const filters=card.getByTestId('program-line-filters')
  await expect(filters.getByRole('textbox')).toHaveCount(0)
  for (const name of ['Расчёт линии', 'Назначения линии']) {
    const action = filters.getByRole('button', { name, exact: true })
    await expect(action).toHaveClass(/rounded-lg/)
    expect((await action.boundingBox())!.height).toBe(32)
    await expect(action).toHaveCSS('font-size', '13px')
  }
  await expect(filters.getByRole('button', { name: 'Назначения линии', exact: true })).toHaveClass(/bg-sky-50/)
  await expect(filters.locator('[data-program-filter="good"]')).toContainText('Годен120')
  await filters.locator('[data-program-filter="good"]').click()
  await expect(filters.getByRole('button',{name:'Все стыки линии',exact:true})).toHaveAttribute('aria-pressed','true')
  const visible=()=>card.locator('[data-testid="line-program-readonly-joint"]:visible')
  await expect(visible()).toHaveCount(50)
  expect((await visible().first().boundingBox())!.height).toBeLessThanOrEqual(44)
  const scroll = card.locator('[data-testid="program-joint-scroll"]:visible')
  await scroll.evaluate(element => { element.scrollTop = 500 })
  const head = await scroll.locator('thead').boundingBox(), bounds = await scroll.boundingBox()
  expect(Math.abs(head!.y - bounds!.y)).toBeLessThanOrEqual(2)
  await expect(card.getByTestId('program-scope-actions')).toBeVisible()
  await scroll.evaluate(element => { element.scrollTop = 0 })
  await filters.locator('[data-program-filter="good"]').click()
  await expect(visible()).toHaveCount(50)
  await expect(filters.getByRole('textbox')).toHaveCount(0)
  await card.getByTestId('program-scope-actions').getByRole('button',{name:/^Назначения/}).click()
  const searchedModal = page.getByRole('dialog',{name:`Назначения · ${name}`})
  await searchedModal.getByLabel('Поиск стыков в назначениях').fill('F120')
  await expect(searchedModal.getByTestId('line-program-joint')).toHaveCount(1)
  await searchedModal.getByRole('button',{name:'Вернуться к просмотру'}).click()
  await expect(visible()).toHaveCount(50)
  await filters.getByRole('button',{name:'По клеймам',exact:true}).click()
  await card.getByRole('button',{name:'Клеймо DENSE-B',exact:true}).click()
  await expect(visible()).toHaveCount(50)
  await expect(visible().first()).toHaveAttribute('data-joint','F61')
  await card.getByTestId('program-scope-actions').getByRole('button',{name:/^Назначения/}).click()
  const modal=page.getByRole('dialog',{name:`Назначения · ${name}`})
  await expect(modal.locator('[data-program-filter="good"]')).toContainText('Годен60')
  await expect(modal.getByTestId('line-program-joint')).toHaveCount(50)
  // A reserved previous-value line prevents controls from jumping on the first edit.
  expect((await modal.getByTestId('line-program-joint').first().boundingBox())!.height).toBeLessThanOrEqual(64)
  await page.screenshot({path:'outputs/line-program-compact-assignments.png'})
  await modal.getByRole('button',{name:'Вернуться к просмотру'}).click()
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'))})
  await page.screenshot({path:'outputs/line-program-compact-finished.png',fullPage:true})
  for(const prefix of ['getLineProgramSection_','getLineProgramCalculation_','getLineProgramJointPage_']) expect(calls.filter(x=>x.startsWith(prefix))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('назначения: без ВИК, три клейма, стабильные строки и общие тонкие границы выделения', async ({ page }) => {
  const name = 'DENSE-ASSIGNMENT-LAYOUT', id = await seed(name, 4)
  await withE2eDatabase(db => db.query(`update weld_joints set has_rk=null,rk_result=null,pvk_result=null,
    stamp_1_k='ABC12345',stamp_1_z='Q8245678',stamp_1_o='XYZ45678'
    where line_program_id=$1`, [id]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(name)
  const card = page.getByTestId('line-program-card')
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  await card.getByRole('button', { name: 'Назначения линии', exact: true }).click()
  const modal = page.getByRole('dialog', { name: `Назначения · ${name}` })
  const rows = modal.getByTestId('line-program-joint')
  await expect(rows).toHaveCount(4)
  await expect(modal.getByRole('columnheader')).toHaveText(['', 'Стык', 'РК', 'УЗК', 'ПВК', 'Послойный ПВК', 'Результат'])
  await expect(modal.getByRole('button', { name: 'ВИК', exact: true })).toHaveCount(0)
  await expect(modal.getByRole('combobox', { name: / · ВИК$/ })).toHaveCount(0)
  await expect(modal.getByText('ВИК обязателен', { exact: true })).toHaveCount(0)
  const geometry = () => rows.evaluateAll(elements => elements.map(row => {
    const rect = row.getBoundingClientRect()
    // Offscreen controls may be scrolled into view by the browser on narrow screens.
    const scroll = row.closest('[data-testid="assignment-dialog-body"]')!.scrollTop
    return { top: rect.top + scroll, height: rect.height, fields: [...row.querySelectorAll('select')].map(select => select.getBoundingClientRect().top + scroll) }
  }))
  const stable = async (before: Awaited<ReturnType<typeof geometry>>) => {
    const after = await geometry()
    for (let i = 0; i < before.length; i++) {
      expect(Math.abs(after[i].top - before[i].top)).toBeLessThan(0.5)
      expect(after[i].height).toBe(before[i].height)
      expect(after[i].fields).toEqual(before[i].fields)
    }
  }
  for (const width of [1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const before = await geometry()
    await modal.getByRole('combobox', { name: 'F1 · РК', exact: true }).selectOption('да')
    await stable(before)
    await modal.getByRole('combobox', { name: 'F2 · УЗК', exact: true }).selectOption('дополнительный')
    await stable(before)
    // Select adjacent rows, then a disjoint pair. No outlines overlap the shared border.
    for (const joint of ['F1', 'F2', 'F3']) await modal.getByRole('checkbox', { name: `Выбрать ${joint}`, exact: true }).check()
    await stable(before)
    await expect(modal.getByTestId('assignment-table-header')).toHaveCSS('box-shadow', 'none')
    for (const row of await rows.all()) {
      await expect(row).toHaveCSS('outline-style', 'none')
      expect(await row.locator('td').evaluateAll(cells => cells.every(cell => getComputedStyle(cell).borderTopWidth === '1px' && getComputedStyle(cell).borderBottomWidth === '1px'))).toBe(true)
    }
    await expect(modal.getByRole('table', { name: 'Стыки и назначения всех методов' })).toHaveCSS('border-collapse', 'collapse')
    for (const row of (await rows.all()).slice(0, 3)) {
      await expect(row.locator('td').first()).toHaveCSS('border-left-color', 'rgb(125, 211, 252)')
      await expect(row.locator('td').last()).toHaveCSS('border-right-color', 'rgb(125, 211, 252)')
      await expect(row.locator('td').nth(2)).toHaveCSS('border-bottom-color', 'rgb(125, 211, 252)')
    }
    await modal.getByRole('checkbox', { name: 'Выбрать F2', exact: true }).uncheck()
    await stable(before)
    await expect(rows.nth(1).locator('td').nth(2)).toHaveCSS('border-bottom-color', 'rgb(125, 211, 252)')
    for (const stamp of ['ABC12345', 'Q8245678', 'XYZ45678']) await expect(rows.first().getByTestId('program-joint-metadata').getByText(stamp, { exact: true })).toBeVisible()
    expect(await rows.first().getByTestId('program-joint-metadata').evaluate(element => {
      const cell = element.closest('td')!.getBoundingClientRect()
      return [...element.querySelectorAll('span')].every(span => { const rect = span.getBoundingClientRect(); return rect.left >= cell.left && rect.right <= cell.right })
    })).toBe(true)
    expect(await modal.getByRole('columnheader').evaluateAll(headers => headers.every(header => getComputedStyle(header).textAlign === 'left'))).toBe(true)
    const methodWidths = await modal.getByRole('columnheader').evaluateAll(headers => headers.slice(2, 6).map(header => header.getBoundingClientRect().width))
    expect(Math.max(...methodWidths) - Math.min(...methodWidths)).toBeLessThan(0.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width === 1600) await modal.screenshot({ path: 'outputs/line-program-assignment-polish.png' })
    await modal.getByRole('combobox', { name: 'F1 · РК', exact: true }).selectOption('')
    await modal.getByRole('combobox', { name: 'F2 · УЗК', exact: true }).selectOption('')
    for (const joint of ['F1', 'F3']) await modal.getByRole('checkbox', { name: `Выбрать ${joint}`, exact: true }).uncheck()
    await stable(before)
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await rows.first().locator('summary').click()
  await expect(rows.first().getByText('ВИК: годен')).toBeVisible()
  await expect(modal.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).not.toBeChecked()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  for (const prefix of ['getLineProgramSection_', 'getLineProgramCalculation_', 'getLineProgramJointPage_']) expect(calls.filter(call => call.startsWith(prefix))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('область действий: клеймо помещается целиком и не перекрывается стрелкой', async ({ page }) => {
  const name = 'DENSE-SCOPE-LABEL', id = await seed(name, 4)
  const stamps = ['D501', 'D501-ABC12345']
  await withE2eDatabase(db => db.query("update weld_joints set stamp_1_k=case when stamp_1_k='DENSE-A' then $2 else $3 end where line_program_id=$1", [id, ...stamps]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(name)
  const card = page.getByTestId('line-program-card')
  await card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  for (const stamp of stamps) await card.getByRole('button', { name: `Клеймо ${stamp}`, exact: true }).click()
  const actions = card.getByTestId('program-scope-actions')
  const scope = actions.getByRole('combobox', { name: 'Область действий' })
  for (const width of [1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390 && await page.getByRole('button', { name: 'Скрыть меню', exact: true }).count()) {
      await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
    }
    for (const value of ['all:', ...stamps.map(stamp => `stamp:${stamp.toLowerCase()}`)]) {
      await scope.selectOption(value)
      const metrics = await scope.evaluate(element => {
        const select = element as HTMLSelectElement, style = getComputedStyle(select)
        const context = document.createElement('canvas').getContext('2d')!
        context.font = style.font
        return { rightPadding: parseFloat(style.paddingRight),
          available: select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          textWidth: context.measureText(select.selectedOptions[0].text).width }
      })
      expect(metrics.rightPadding).toBeGreaterThanOrEqual(28)
      expect(metrics.available).toBeGreaterThanOrEqual(metrics.textWidth)
      const label = value === 'all:' ? 'линии' : `клейма ${stamps.find(stamp => value === `stamp:${stamp.toLowerCase()}`)}`
      await expect(actions.getByRole('button', { name: `Назначения ${label}`, exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await scope.selectOption('stamp:d501')
  await card.getByTestId('program-line-filters').screenshot({ path: 'outputs/line-program-scope-label.png' })
  for (const prefix of ['getLineProgramSection_', 'getLineProgramCalculation_', 'getLineProgramJointPage_']) expect(calls.filter(call => call.startsWith(prefix))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('плоская иерархия: подчёркнутые виды, широкие результаты и явная область действий без повторных блоков', async ({ page }) => {
  const name = 'DENSE-HIERARCHY', id = await seed(name, 6)
  await withE2eDatabase(db => db.query("update weld_joints set rk_result='ремонт',pvk_result=null,has_uzk='да' where line_program_id=$1 and joint='F2'", [id]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(name)
  const card = page.getByTestId('line-program-card')
  const totals = page.getByRole('button', { name: 'Расчёт итогов раздела', exact: true })
  await expect(page.locator('[data-line-program-report-actions]')).toContainText('Расчёт итогов')
  expect(Math.abs((await totals.boundingBox())!.y - (await page.getByRole('button', { name: 'Показать', exact: true }).boundingBox())!.y)).toBeLessThan(1)
  await card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  const groups = card.getByRole('button', { name: 'По клеймам', exact: true })
  const all = card.getByRole('button', { name: 'Все стыки линии', exact: true })
  await expect(groups).toHaveClass(/border-b-2.*border-sky-600/)
  await all.click()
  await expect(all).toHaveClass(/border-b-2.*border-sky-600/)
  await expect(groups).toHaveClass(/border-transparent/)
  await expect(all).toHaveCSS('border-bottom-width', '2px')
  await expect(all).toHaveCSS('border-bottom-color', 'rgb(2, 132, 199)')
  await expect(groups).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)')
  await expect.poll(() => card.getByTestId('program-line-filters').evaluate(element => {
    const views = element.querySelector('[aria-label="Вид стыков линии"]')!.getBoundingClientRect()
    const filters = element.querySelector('[aria-label="Фильтр стыков"]')!.getBoundingClientRect()
    const actions = element.querySelector('[data-testid="program-scope-actions"]')!.getBoundingClientRect()
    const centers = [views, filters, actions].map(rect => rect.y + rect.height / 2)
    return views.right < filters.left && filters.right < actions.left && Math.max(...centers) - Math.min(...centers) < 1 && element.clientHeight <= 52
  })).toBe(true)
  await expect(card.getByTestId('line-program-summary')).toHaveCount(0)
  await expect(card.getByTestId('program-workspace-heading')).toHaveCount(0)
  await expect(card.getByText(/Записей в выборке:/)).toHaveCount(0)
  await expect(card.getByRole('table', { name: 'Расчёт по клеймам' })).toBeHidden()
  const table = card.getByRole('table', { name: 'Назначения и результаты' })
  await expect(table.getByTestId('line-program-readonly-joint')).toHaveCount(6)
  const widths = await table.getByRole('columnheader').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width))
  // The wider joint identity reserves room for both exclusion badges; results remain the largest column.
  expect(widths[0]).toBeGreaterThanOrEqual(320)
  expect(widths[3]).toBeGreaterThan(Math.max(...widths.slice(0, 3)))
  expect(widths[3] / widths.reduce((sum, width) => sum + width, 0)).toBeGreaterThanOrEqual(0.4)
  const rejected = table.getByTestId('line-program-readonly-joint').filter({ hasText: 'F2' })
  expect(await rejected.locator('td').last().getByRole('button').evaluateAll(buttons => new Set(buttons.map(button => button.getBoundingClientRect().y)).size)).toBe(1)
  expect((await rejected.boundingBox())!.height).toBeLessThanOrEqual(40)
  await page.screenshot({ path: 'outputs/line-program-hierarchy-all.png', fullPage: true })
  await groups.click()
  for (const stamp of ['DENSE-A', 'DENSE-B']) await card.getByRole('button', { name: `Клеймо ${stamp}`, exact: true }).click()
  const actions = card.getByTestId('program-scope-actions')
  await actions.getByRole('combobox', { name: 'Область действий' }).selectOption('stamp:dense-a')
  await actions.getByRole('button', { name: 'Назначения клейма DENSE-A', exact: true }).click()
  const modal = page.getByRole('dialog', { name: `Назначения · ${name}` })
  await expect(modal.getByTestId('line-program-joint')).toHaveCount(3)
  await modal.getByRole('combobox', { name: 'F1 · УЗК', exact: true }).selectOption('дополнительный')
  await modal.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await expect(actions.getByRole('button', { name: /Назначения клейма DENSE-A.*черновик: 1/ })).toBeVisible()
  await all.click()
  await actions.getByRole('button', { name: /Назначения линии/ }).click()
  await expect(modal.getByTestId('line-program-joint')).toHaveCount(6)
  await expect(modal.getByRole('combobox', { name: 'F1 · УЗК', exact: true })).toHaveValue('дополнительный')
  await modal.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  for (const width of [1000, 390, 1600]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390 && await page.getByRole('button', { name: 'Скрыть меню', exact: true }).count()) {
      await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(actions.getByRole('button', { name: /Назначения линии/ })).toBeVisible()
  }
  await groups.click()
  await expect(groups).toHaveCSS('border-bottom-color', 'rgb(2, 132, 199)')
  await expect(all).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)')
  await expect(card.getByRole('button', { name: 'Клеймо DENSE-A', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByRole('button', { name: 'Клеймо DENSE-B', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await page.screenshot({ path: 'outputs/line-program-hierarchy-groups.png', fullPage: true })
  for (const prefix of ['getLineProgramSection_', 'getLineProgramCalculation_', 'getLineProgramJointPage_']) expect(calls.filter(call => call.startsWith(prefix))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('вложенность клейма: отступ и направляющая, независимые группы и сохранённая история без лишних запросов', async ({ page }) => {
  const name = 'DENSE-NESTING', id = await seed(name, 8)
  await withE2eDatabase(db => db.query("update weld_joints set rk_result='ремонт' where line_program_id=$1 and joint='F2'", [id]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(name)
  const card = page.getByTestId('line-program-card')
  await card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  const stamp = (code: string) => card.locator(`[data-testid="line-program-stamp"][data-stamp="${code}"]`)
  const body = (code: string) => card.locator(`[data-testid="stamp-joints-container"][data-stamp="${code}"]`)
  const baseHeight = (await stamp('DENSE-A').boundingBox())!.height
  for (const code of ['DENSE-A', 'DENSE-B']) {
    await expect(stamp(code)).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await stamp(code).getByRole('button', { name: `Клеймо ${code}`, exact: true }).click()
    await expect(body(code).getByTestId('line-program-readonly-joint')).toHaveCount(4)
  }
  await page.mouse.move(0, 0)
  for (const width of [1840, 1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390 && await page.getByRole('button', { name: 'Скрыть меню', exact: true }).count()) {
      await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
    }
    for (const code of ['DENSE-A', 'DENSE-B']) {
      await expect(stamp(code)).toHaveCSS('background-color', 'rgb(241, 245, 249)')
      expect(Math.abs((await stamp(code).boundingBox())!.height - baseHeight)).toBeLessThan(1)
      await expect(body(code).getByTestId('program-stamp-guide')).toHaveAttribute('aria-hidden', 'true')
      await expect(body(code).locator(':scope > td')).toHaveCSS('border-bottom-color', 'rgb(203, 213, 225)')
      await expect.poll(() => body(code).evaluate(element => {
        const group = element.getBoundingClientRect()
        const table = element.querySelector('table[aria-label="Назначения и результаты"]')!.getBoundingClientRect()
        const branch = element.querySelector('[data-testid="program-stamp-branch"]')!.getBoundingClientRect()
        const guide = element.querySelector('[data-testid="program-stamp-guide"]')!.getBoundingClientRect()
        return Math.abs(table.left - group.left - 24) < 1 && Math.abs(guide.left - group.left - 20) < 1 &&
          guide.width === 1 && Math.abs(guide.height - branch.height) < 1 && Math.abs(table.top - branch.top) < 1
      })).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1840, height: 1000 })
  const good = body('DENSE-A').getByTestId('line-program-readonly-joint').filter({ has: page.getByRole('button', { name: 'F1', exact: true }) })
  const rejected = body('DENSE-A').getByTestId('line-program-readonly-joint').filter({ has: page.getByRole('button', { name: 'F2', exact: true }) })
  await expect(good).toHaveAttribute('data-final-status', 'годен')
  await expect(rejected).toHaveAttribute('data-final-status', 'не годен')
  const goodColor = await good.evaluate(element => getComputedStyle(element).backgroundColor)
  const rejectedColor = await rejected.evaluate(element => getComputedStyle(element).backgroundColor)
  expect(goodColor).not.toBe(rejectedColor)
  const guide = body('DENSE-A').getByTestId('program-stamp-guide')
  const shortGuide = (await guide.boundingBox())!.height
  await good.getByRole('button', { name: 'F1', exact: true }).click()
  await page.mouse.move(0, 0)
  await expect(body('DENSE-A').getByLabel('История контроля F1', { exact: true })).toBeVisible()
  await expect.poll(async () => (await guide.boundingBox())!.height).toBeGreaterThan(shortGuide)
  await expect(good).toHaveCSS('background-color', goodColor)
  await expect(rejected).toHaveCSS('background-color', rejectedColor)
  await stamp('DENSE-B').getByRole('button', { name: 'Клеймо DENSE-B', exact: true }).click()
  await page.mouse.move(0, 0)
  await expect(body('DENSE-B')).toBeHidden()
  await expect(stamp('DENSE-B')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(body('DENSE-A').getByLabel('История контроля F1', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const all = card.getByTestId('line-program-all-joints')
  await expect(all.getByTestId('line-program-readonly-joint')).toHaveCount(8)
  await expect(all.getByTestId('program-stamp-branch')).toHaveCount(0)
  await card.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await expect(body('DENSE-A').getByLabel('История контроля F1', { exact: true })).toBeVisible()
  await expect(body('DENSE-B')).toBeHidden()
  await card.screenshot({ path: 'outputs/line-program-nested-stamps.png' })
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  for (const prefix of ['getLineProgramSection_', 'getLineProgramCalculation_', 'getLineProgramJointPage_']) expect(calls.filter(call => call.startsWith(prefix))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('плашки не увеличивают строку, НК до ТО перед основным контролем, компактные действия и более широкие шкалы', async ({ page }) => {
  const name = 'DENSE-ROW-BADGES', id = await seed(name, 6)
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set has_rk=null,has_pvk=null,rk_result=null,pvk_result=null,
      officiality=case when joint in ('F2','F4') then 'неофициальный' else officiality end,
      revision_actuality=case when joint in ('F3','F4') then 'не актуален' else revision_actuality end,
      joint=case when joint='F4' then 'S63W1R1' else joint end where line_program_id=$1`, [id])
    await db.query(`insert into pre_heat_treatment_controls (weld_joint_id,method,result,conclusion_name,conclusion_date)
      select id,'ВИК','вырез','ROW-PRE','2026-09-01' from weld_joints where line_program_id=$1 and joint='F5'`, [id])
    await db.query(`insert into duplicate_controls (weld_joint_id,method,result,conclusion)
      select id,'РК','вырез','ROW-DUP' from weld_joints where line_program_id=$1 and joint='F6'`, [id])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(name)
  const card = page.getByTestId('line-program-card')
  await card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  await card.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const rows = card.getByTestId('line-program-readonly-joint')
  await expect(rows).toHaveCount(6)
  for (const width of [1840, 1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390 && await page.getByRole('button', { name: 'Скрыть меню', exact: true }).count()) {
      await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
    }
    await expect.poll(() => rows.evaluateAll(elements => {
      const heights = elements.map(element => element.getBoundingClientRect().height)
      return Math.max(...heights) - Math.min(...heights)
    })).toBeLessThan(1)
    expect(await rows.locator('td:first-child').evaluateAll(cells => cells.every(cell => {
      const identity = cell.firstElementChild!, bounds = identity.getBoundingClientRect()
      return cell.scrollWidth <= cell.clientWidth && [...identity.children].every(child => {
        const box = child.getBoundingClientRect()
        return box.top >= bounds.top && box.bottom <= bounds.bottom && box.height <= 24
      })
    }))).toBe(true)
    expect(await rows.getByRole('button', { name: 'S63W1R1', exact: true }).locator('span').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const pre = rows.filter({ hasText: 'F5' }).locator('td').last()
    await expect(pre.getByRole('button').first()).toHaveText('НК до ТО: ВИК вырез')
    await expect(rows.filter({ hasText: 'F5' }).locator('td').first()).not.toContainText('НК до ТО')
    await expect(rows.filter({ hasText: 'F6' }).locator('td').last().getByRole('button').last()).toHaveText('Дубли: РК вырез')
    for (const action of ['Расчёт линии', 'Назначения линии']) await expect(card.getByRole('button', { name: action, exact: true })).toHaveCSS('min-height', '32px')
    if (width === 1840) {
      await expect.poll(() => card.getByTestId('line-card-metrics').getByRole('progressbar').evaluateAll(bars => bars.every(bar => bar.getBoundingClientRect().width > 136 && bar.getBoundingClientRect().width <= 152))).toBe(true)
      await page.screenshot({ path: 'outputs/line-program-inline-badges.png', fullPage: true })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await rows.filter({ hasText: 'F5' }).getByRole('button', { name: 'НК до ТО: ВИК вырез' }).click()
  await expect(card.getByRole('button', { name: 'ROW-PRE', exact: true })).toBeVisible()
  for (const prefix of ['getLineProgramSection_', 'getLineProgramCalculation_', 'getLineProgramJointPage_']) expect(calls.filter(call => call.startsWith(prefix))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('пометка завершения справа от процента не увеличивает высоту заголовка линии', async ({ page }) => {
  const prefix = 'DENSE-HEIGHT-', done = prefix + 'DONE', wait = prefix + 'WAIT'
  await seed(done, 4)
  const waitId = await seed(wait, 4)
  await withE2eDatabase(db => db.query('update weld_joints set rk_result=null where line_program_id=$1', [waitId]))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(prefix)
  const cards = page.getByTestId('line-program-card')
  const completed = cards.filter({ has: page.getByTestId('line-name').filter({ hasText: done }) })
  const incomplete = cards.filter({ has: page.getByTestId('line-name').filter({ hasText: wait }) })
  await expect(cards).toHaveCount(2)
  await expect(completed).toHaveAttribute('data-program-finished', 'true')
  await expect(incomplete).toHaveAttribute('data-program-finished', 'false')
  for (const width of [1840, 1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390 && await page.getByRole('button', { name: 'Скрыть меню', exact: true }).count()) {
      await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
    }
    await expect.poll(() => completed.getByTestId('line-program-header').evaluate(element => {
      const name = element.querySelector('[data-testid="line-name"]')!
      const percent = name.nextElementSibling!.getBoundingClientRect()
      const status = element.querySelector('[data-testid="program-finished-label"]')!.getBoundingClientRect()
      const description = element.querySelector('[data-testid="line-description"]')!.getBoundingClientRect()
      return status.left > percent.right && Math.abs(status.y + status.height / 2 - percent.y - percent.height / 2) < 1 && description.top > status.bottom
    })).toBe(true)
    await expect.poll(async () => Math.abs((await completed.getByTestId('line-program-header').boundingBox())!.height - (await incomplete.getByTestId('line-program-header').boundingBox())!.height)).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(completed.getByTestId('program-finished-label')).toBeVisible()
    await page.screenshot({ path: `outputs/line-program-equal-headers-${width}.png`, fullPage: true })
  }
  await completed.getByRole('button', { name: `Расчёт линии ${done}`, exact: true }).click()
  await expect(completed.getByRole('button', { name: 'Все стыки линии', exact: true })).toBeVisible()
  expect(calls.filter(call => call.startsWith('getLineProgramSection_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramCalculation_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(0)
  expect(errors).toEqual([])
})

test('одно- и двухстрочное описание оставляют одинаковую базовую высоту заголовка линии', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const prefix = 'DENSE-BASE-'
  const short = await seed(prefix + 'SHORT', 2)
  await seed(prefix + 'LONG', 2)
  await withE2eDatabase(async db => {
    await db.query('update line_programs set weld_control_percent=50,pvk_control_percent=50 where id=$1', [short])
    await db.query('update weld_joints set weld_control_percent=50,pvk_control_percent=50 where line_program_id=$1', [short])
  })
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(prefix)
  const cards = page.getByTestId('line-program-card')
  await expect(cards).toHaveCount(2)
  for (const width of [1840, 1600]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => cards.evaluateAll(elements => {
      const lines = elements.map(element => ({
        header: element.querySelector('[data-testid="line-program-header"]')!.getBoundingClientRect(),
        name: element.querySelector('[data-testid="line-name"]')!.getBoundingClientRect(),
        text: element.querySelector('[data-testid="line-description"]')!.getBoundingClientRect(),
      }))
      return lines.every(line => line.header.height === 72) &&
        Math.abs(lines[0].name.y - lines[0].header.y - lines[1].name.y + lines[1].header.y) < 1 &&
        Math.abs(lines[0].text.height - lines[1].text.height) === 16
    })).toBe(true)
  }
  const shortCard = cards.filter({ has: page.getByRole('button', { name: `Расчёт линии ${prefix}SHORT`, exact: true }) })
  await shortCard.getByRole('button', { name: `Расчёт линии ${prefix}SHORT`, exact: true }).click()
  await expect(shortCard.getByTestId('line-program-header')).toHaveCSS('height', '72px')
  await expect(shortCard.getByRole('button', { name: 'По клеймам', exact: true })).toBeVisible()
  await page.screenshot({ path: 'outputs/line-program-uniform-header-base.png', fullPage: true })
  expect(calls.filter(call => call.startsWith('getLineProgramSection_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(0)
  expect(errors).toEqual([])
})

test('ФИО под клеймом: одинаковая высота при разных именах и одинаковых расчётных пометках, без новых загрузок', async ({ page }) => {
  const name = 'DENSE-FIO', id = await seed(name, 6)
  const longName = 'Александров-Константинопольский Александр Александрович'
  await withE2eDatabase(async db => {
    // Isolate name length: different excess badges still affect the existing result column.
    await db.query('update line_programs set pvk_control_percent=100 where id=$1', [id])
    await db.query("update weld_joints set pvk_control_percent=100,stamp_1_k=case when joint='F1' then 'DENSE-FIO-C' when stamp_1_k='DENSE-A' then 'DENSE-FIO-A' else 'DENSE-FIO-B' end where line_program_id=$1", [id])
    await db.query('insert into welder_stamps(naks_stamp,welder_name) values($1,$2),($3,$4)', ['DENSE-FIO-A', longName, 'DENSE-FIO-C', 'Ли Ян'])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(name)
  const card = page.getByTestId('line-program-card')
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  const rows = card.getByTestId('line-program-stamp')
  await expect(rows).toHaveCount(3)
  for (const [stamp, fullName] of [['DENSE-FIO-A', longName], ['DENSE-FIO-B', 'ФИО не указано'], ['DENSE-FIO-C', 'Ли Ян']]) {
    const label = rows.filter({ has: page.getByRole('button', { name: `Клеймо ${stamp}`, exact: true }) }).getByTestId('line-program-welder-name')
    await expect(label).toHaveText(fullName)
    await expect(label).toHaveAttribute('title', fullName)
    await expect(label).toBeVisible()
  }
  for (const width of [1840, 1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390 && await page.getByRole('button', { name: 'Скрыть меню', exact: true }).count()) {
      await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
    }
    await expect.poll(() => rows.evaluateAll(elements => {
      const rects = elements.map(row => row.getBoundingClientRect())
      return elements.every(row => {
        const name = row.querySelector('[data-testid="line-program-welder-name"]')!
        const label = name.getBoundingClientRect()
        const code = row.querySelector('button[aria-label^="Клеймо "]')!.getBoundingClientRect()
        return label.top >= code.bottom && label.height === 16 && getComputedStyle(name).textOverflow === 'ellipsis'
      }) && rects.every(rect => Math.abs(rect.height - rects[0].height) < 1)
    })).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width === 1840) await card.screenshot({ path: 'outputs/line-program-welder-names.png' })
  }
  await card.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await expect(card.locator('[data-testid="line-program-readonly-joint"]:visible')).toHaveCount(6)
  await card.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await expect(rows.first().getByTestId('line-program-welder-name')).toBeVisible()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  expect(calls.filter(call => call.startsWith('getLineProgramSection_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramCalculation_'))).toHaveLength(1)
  expect(calls.filter(call => call.startsWith('getLineProgramJointPage_'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('расчёт отдельно от результатов: одинаковые строки клейм с долгом, закрытием, лишним и сокращением', async ({ page }) => {
  const name = 'DENSE-CALC-COLUMN', id = await seed(name, 18)
  await withE2eDatabase(async db => {
    await db.query('update line_programs set weld_control_percent=30 where id=$1', [id])
    await db.query(`update weld_joints set weld_control_percent=30,rk_result=null,pvk_result=null,
      stamp_1_k=case when substring(joint from 2)::int<=6 then 'A' when substring(joint from 2)::int<=12 then 'B' else 'C' end,
      has_rk=case when substring(joint from 2)::int<=8 then 'да' end,
      has_pvk=case when substring(joint from 2)::int<=7 then 'да' end where line_program_id=$1`, [id])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(name)
  const card = page.getByTestId('line-program-card')
  await card.getByRole('button', { name: `Расчёт линии ${name}`, exact: true }).click()
  const table = card.getByRole('table', { name: 'Расчёт по клеймам', exact: true })
  await expect(table.locator('thead').first().getByRole('columnheader')).toHaveText(['Клеймо', 'Соединений', 'Состояние', 'Зачтено / нужно', 'Назначения', 'К назначению', 'Расчёт', 'Результаты'])
  const rows = card.getByTestId('line-program-stamp')
  const a = rows.filter({ has: page.getByRole('button', { name: 'Клеймо A', exact: true }) })
  const b = rows.filter({ has: page.getByRole('button', { name: 'Клеймо B', exact: true }) })
  const c = rows.filter({ has: page.getByRole('button', { name: 'Клеймо C', exact: true }) })
  const calculation = a.getByTestId('program-stamp-calculation')
  await expect(calculation.getByRole('button', { name: 'Расчёт закрыт', exact: true })).toHaveText('Закрыт')
  await expect(calculation.getByRole('button', { name: /^Лишнее:/ })).toBeVisible()
  await expect(calculation.getByRole('button', { name: /^Возможное сокращение:/ })).toBeVisible()
  await expect(b.getByTestId('program-stamp-calculation').getByRole('button')).toHaveCount(1)
  await expect(c.getByTestId('program-stamp-calculation')).toHaveText('—')
  await expect(c.getByTestId('program-assignment-demand')).toContainText('3')
  for (const width of [1840, 1600, 1280, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width === 390 && await page.getByRole('button', { name: 'Скрыть меню', exact: true }).count()) {
      await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
      await expect(page.locator('[data-app-sidebar]')).toHaveCSS('width', '64px')
    }
    await expect.poll(() => rows.evaluateAll(elements => {
      const bounds = elements.map(element => element.getBoundingClientRect())
      return bounds.every(rect => rect.height >= 56 && rect.height <= 60 && Math.abs(rect.height - bounds[0].height) < 1) &&
        elements.every(row => [...row.querySelectorAll('td')].every(cell => cell.scrollWidth <= cell.clientWidth))
    })).toBe(true)
    await expect.poll(() => calculation.evaluate(element => {
      const closedButton = element.querySelector('[data-program-slice="covered"]')!
      const excessButton = element.querySelector('[data-program-slice="excess"]')!
      const closed = closedButton.getBoundingClientRect()
      const excess = excessButton.getBoundingClientRect()
      const reduction = element.querySelector('[data-program-slice="reduction"]')!.getBoundingClientRect()
      const textBounds = (button: Element) => {
        const range = document.createRange(); range.selectNodeContents(button)
        return range.getBoundingClientRect()
      }
      const firstText = textBounds(closedButton), secondText = textBounds(excessButton)
      return {
        buttonsAligned: Math.abs(closed.y - excess.y) < 1 && reduction.top >= closed.bottom,
        textAligned: Math.abs(firstText.y - secondText.y) < 0.5 && Math.abs(firstText.bottom - secondText.bottom) < 0.5,
        fontSizes: [closedButton, excessButton].map(button => getComputedStyle(button).fontSize),
        lineHeights: [closedButton, excessButton].map(button => getComputedStyle(button).lineHeight),
      }
    })).toEqual({ buttonsAligned: true, textAligned: true, fontSizes: ['13px', '13px'], lineHeights: ['20px', '20px'] })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1840, height: 1000 })
  await card.screenshot({ path: 'outputs/line-program-stamp-calculation-column.png' })
  for (const slice of ['covered', 'excess', 'reduction', 'results']) {
    await a.locator(`[data-program-slice="${slice}"]`).last().click()
    const body = card.locator('[data-testid="stamp-joints-container"][data-stamp="A"]')
    await expect(body).toBeVisible()
    await expect(body.locator(':scope > td')).toHaveAttribute('colspan', '8')
    await expect(body.getByRole('table', { name: 'Назначения и результаты', exact: true })).toBeVisible()
  }
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  for (const prefix of ['getLineProgramSection_', 'getLineProgramCalculation_', 'getLineProgramJointPage_']) expect(calls.filter(call => call.startsWith(prefix))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('компактные фильтры отделяют ошибки и исключённую историю; не теряют черновик в назначениях',async({page})=>{
  const name='DENSE-MIXED',id=await seed(name,10)
  await withE2eDatabase(db=>db.query(`update weld_joints set
    rk_result=case when joint='F2' then 'ремонт' when joint in ('F3','F7','F8','F9','F10') then null else 'годен' end,
    has_rk=case when joint='F4' then null else 'да' end,
    revision_actuality=case when joint='F5' then 'не актуален' else 'актуальная' end,
    officiality=case when joint='F6' then 'неофициальный' else 'действующий' end where line_program_id=$1`,[id]))
  await page.goto('/line-program');await page.getByLabel('Поиск программы линий').fill(name)
  const card=page.getByTestId('line-program-card')
  await card.getByRole('button',{name:`Расчёт линии ${name}`,exact:true}).click()
  const filters=card.getByTestId('program-line-filters')
  await filters.getByRole('button',{name:'Все стыки линии',exact:true}).click()
  const visible=()=>card.locator('[data-testid="line-program-readonly-joint"]:visible')
  for(const [filter,count] of [['all',10],['good',1],['incomplete',5],['rejected',1],['error',1]] as const){await filters.locator(`[data-program-filter="${filter}"]`).click();await expect(visible()).toHaveCount(count)}
  await filters.locator('[data-program-filter="all"]').click()
  await expect(card.getByText('Неактуальный',{exact:true})).toBeVisible()
  await expect(card.getByText('Неофициальный',{exact:true})).toBeVisible()
  await card.getByTestId('program-scope-actions').getByRole('button',{name:/^Назначения/}).click()
  const modal=page.getByRole('dialog',{name:`Назначения · ${name}`})
  await modal.getByRole('combobox',{name:'F3 · УЗК',exact:true}).selectOption('дополнительный')
  await modal.locator('[data-program-filter="good"]').click();await expect(modal.getByTestId('line-program-joint')).toHaveCount(1)
  await modal.locator('[data-program-filter="all"]').click();await expect(modal.getByRole('combobox',{name:'F3 · УЗК',exact:true})).toHaveValue('дополнительный')
  await expect(modal.getByText('было: —')).toBeVisible()
  await expect(modal.getByRole('combobox',{name:'F5 · РК',exact:true})).toBeDisabled()
  for(const width of [1600,1000,390]){await page.setViewportSize({width,height:1100});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)}
})
