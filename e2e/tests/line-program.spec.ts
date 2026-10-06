import { rpcName } from '../rpc'
import { programApprovalKey } from '../../src/lib/program-control-approval'
import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

test.afterEach(() => cleanupLineProgramProjects(['E2E программа', 'E2E layout', 'E2E compact']))
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'

test('доп учитывается в SQL, сохранённых задачах и dispatcherTasks без роста запросов', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-line-program-additional.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  expect(JSON.parse(stdout.trim())).toEqual({ phases: 4, lineReadQueries: 6, persistedAndVirtual: true, cancelledResultDuplicate: true, unweldedFullLineDuplicate: true })
})

test('сохранённая история НК до ТО: включено → выключено → включено в расчёте, SQL-индексе и dispatcherTasks', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-line-program-pre-heat-policy.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  expect(JSON.parse(stdout.trim())).toEqual({ phases: 3, lineReadQueries: 6, persistedAndVirtual: true, historyUnchanged: true })
})

test('реестр создаёт линию до стыков, хранит дробные проценты и различает неизвестное и ноль', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('main').getByRole('button', { name: 'Программа линий', exact: true }).click()
  const program = page.getByTestId('line-program')
  await expect(program).toBeVisible()
  await program.getByRole('button', { name: 'Новая линия', exact: true }).click()
  const editor = page.getByRole('dialog')
  await expect(editor).toBeVisible()
  expect((await editor.boundingBox())!.width).toBeLessThanOrEqual(560)
  await editor.getByLabel('Проект', { exact: true }).fill('E2E программа')
  await editor.getByLabel('Шифр', { exact: true }).fill('LP')
  await editor.getByLabel('Линия', { exact: true }).fill('PRECREATED')
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await expect(editor).toHaveCount(0)
  await program.getByLabel('Поиск программы линий').fill('PRECREATED')
  await expect(program.getByTestId('line-program-card')).toHaveCount(1)
  await expect(program.getByTestId('line-program-card')).toContainText('СП-02: не настроены категория, группа, базовый процент, процент ПВК.')
  await program.getByTestId('line-program-card').filter({ has: page.getByRole('button', { name: /PRECREATED/ }) }).getByRole('button', { name: 'Настроить', exact: true }).click()
  await editor.getByLabel('Категория', { exact: true }).fill('II')
  await editor.getByLabel('Группа', { exact: true }).fill('A')
  await editor.getByLabel('Базовый % контроля', { exact: true }).fill('0.5')
  const pvk = editor.getByLabel('% ПВК', { exact: true })
  const syncPvk = editor.getByRole('button', { name: 'ПВК как базовый', exact: true })
  await expect(pvk).toHaveValue('0.5')
  await expect(syncPvk).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.getByRole('region', { name: 'Сведения о линии' }).getByLabel('Линия', { exact: true })).toHaveValue('PRECREATED')
  await expect(editor.getByRole('textbox', { name: 'Линия', exact: true })).toBeEditable()
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 1000, height: 720 }]) {
    await page.setViewportSize(viewport)
    const originalBox = (await editor.boundingBox())!
    await pvk.fill('0')
    await expect(syncPvk).toHaveAttribute('aria-pressed', 'false')
    await expect(pvk).toBeFocused()
    expect(await editor.boundingBox()).toEqual(originalBox)
    await syncPvk.click()
    await expect(pvk).toHaveValue('0.5')
    expect(await editor.boundingBox()).toEqual(originalBox)
    await expect(editor.getByRole('button', { name: 'Сохранить программу' })).toBeInViewport()
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await editor.getByLabel('% ПВК', { exact: true }).fill('0')
  await editor.screenshot({ path: 'outputs/line-program-editor-20260927.png' })
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await expect(editor).toHaveCount(0)
  await program.getByRole('button', { name: 'Процентные линии', exact: true }).click()
  await expect(program.getByRole('button', { name: /PRECREATED/ })).toBeVisible()
  expect(await withE2eDatabase(async (client) => (await client.query("select weld_control_percent::float as base, pvk_control_percent::float as pvk from line_programs where line = 'PRECREATED'")).rows)).toEqual([{ base: 0.5, pvk: 0 }])
})

test('поиск клейма сохраняет полную группу и не открывает расчёт второго клейма по родителю ремонта', async ({ page }) => {
  await withE2eDatabase(async (client) => {
    const { rows: [line] } = await client.query("insert into line_programs (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent) values ('E2E программа', 'LP', 'REPAIRS', 'II', 'A', 30, 10) returning id")
    await client.query(`insert into weld_joints (line_program_id, project_title, subtitle_code, line, joint, weld_date, connection_type, category, group_name, weld_control_percent, pvk_control_percent, has_vik, stamp_1_k, rk_result)
      select $1, 'E2E программа', 'LP', 'REPAIRS', case when n=1 then 'F501' when n=2 then 'F501R1' when n=3 then 'F501R2' else 'F' || (500+n)::text end,
      '2026-09-01', 'СШ', 'II', 'A', 30, 10, 'да', case when n in (2,3) then 'REPAIR-B' else 'ROOT-A' end,
      case when n <= 3 then 'ремонт' end from generate_series(1,20) n`, [line.id])
    // The fixture represents completed RK, not a legacy result without any assignment.
    await client.query("update weld_joints set has_rk='да' where line_program_id=$1 and rk_result is not null", [line.id])
  })
  await page.goto('/percentage-lines')
  const program = page.getByTestId('line-program')
  await program.getByRole('button', { name: 'Процентные линии', exact: true }).click()
  await program.getByLabel('Поиск программы линий').fill('REPAIR-B')
  await expect(program.getByTestId('line-program-card')).toHaveCount(1)
  await program.getByRole('button', { name: /REPAIRS/ }).click()
  await expect(program.locator('[data-stamp="ROOT-A"]')).toContainText('Не годен: 1')
  await expect(program.locator('[data-stamp="ROOT-A"] td').nth(1)).toHaveText('18')
  await expect(program.locator('[data-stamp="REPAIR-B"]')).toHaveCount(0)
  await expect(program.getByTestId('line-program-card').getByRole('button', { name: 'Учитываемых соединений 18', exact: true })).toBeVisible()
  await expect(program.getByText('Срез', { exact: true })).toHaveCount(0)
})

test('единая таблица: отмена пары и послойный контроль не подделывают результаты', async ({ page }) => {
  await seedQuickLine()
  const approval = await withE2eDatabase(async client => {
    const { rows: [row] } = await client.query("update weld_joints set has_rk='да', has_uzk='да' where line='QUICK-LINE' and joint='F701' returning id")
    const key = programApprovalKey({ id: row.id, hasRk: 'да', hasUzk: 'да' }, 'common', true)
    await client.query("insert into dispatcher_accepted_warnings (key,kind,weld_joint_id) values ($1,'line-program-control',$2)", [key, row.id])
    return key
  })
  await page.goto('/percentage-lines')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill('QUICK-LINE')
  await program.getByRole('button', { name: 'Расчёт линии QUICK-LINE' }).click()
  await program.getByRole('button', { name: 'Клеймо QUICK-A', exact: true }).click()
  await program.getByTestId('program-scope-actions').getByRole('button', { name: /^Расчёт/ }).click()
  const calculation = page.getByRole('dialog', { name: 'Расчёт · QUICK-LINE' })
  await expect(calculation.getByTestId('demand-common')).toContainText('Расчётная норма 6: по проценту 6 + из-за брака 0')
  await expect(calculation.getByTestId('demand-pvk')).toContainText('Расчётная норма 2: по проценту 2 + из-за брака 0')
  await calculation.getByRole('button', { name: 'Закрыть расчёт' }).click()
  await program.getByRole('button', { name: /^Назначения/ }).click()
  const editor = page.getByRole('dialog', { name: 'Назначения · QUICK-LINE' })
  for (const method of ['РК', 'УЗК']) await editor.getByRole('button', { name: method, exact: true }).click()
  await editor.getByRole('radio', { name: 'Отменен', exact: true }).click()
  await editor.getByRole('checkbox', { name: 'Выбрать F701', exact: true }).check()
  await confirmQuickAction(page)
  expect((await quickRows())[0]).toMatchObject({ has_rk: 'отменен', has_uzk: 'отменен', layered_control_assigned: false })
  expect(await withE2eDatabase(async client => (await client.query('select key from dispatcher_accepted_warnings where key=$1', [approval])).rows)).toEqual([])
  for (const result of [(await quickRows())[0].rk_result, (await quickRows())[0].uzk_result]) expect(['годен', 'ремонт', 'вырез']).not.toContain(result)
  for (const method of ['РК', 'УЗК']) await editor.getByRole('button', { name: method, exact: true }).click()
  await editor.getByRole('button', { name: 'Послойный ПВК', exact: true }).click()
  await expect(editor.getByRole('radio', { name: 'Да', exact: true })).toBeChecked()
  await expect(editor.getByRole('button', { name: 'ПВК', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F703', exact: true })).toBeEnabled()
  await editor.getByRole('checkbox', { name: 'Выбрать F702', exact: true }).check()
  await confirmQuickAction(page)
  expect((await quickRows())[1]).toMatchObject({ has_pvk: 'да', layered_control_assigned: true, pvk_result: 'ожидает заявку' })
  expect(await withE2eDatabase(async client => (await client.query("select count(*)::integer as total from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id where w.line='QUICK-LINE' and d.type like 'layered%'")).rows[0].total)).toBe(0)
})

async function confirmQuickAction(page: Page) {
  const editor = page.getByRole('dialog', { name: 'Назначения · QUICK-LINE' })
  await editor.getByRole('button', { name: /^Применить к выбранным/ }).click()
  await editor.getByRole('button', { name: 'Проверить изменения' }).click()
  const acknowledgement = editor.getByRole('checkbox', { name: /Подтверждаю назначение сверх нормы/ })
  await expect(editor.getByRole('button', { name: 'Сохранить назначения' })).toBeVisible()
  if (await acknowledgement.count()) await acknowledgement.check()
  await editor.getByRole('button', { name: 'Сохранить назначения' }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
}

test('карточки не переносят название, страницы компактны, редактор отдельный, стрелка внутри отчёта', async ({ page }) => {
  const longName = '330-FG-05-000 (Тех.решение) — проверка длинного названия линии без переноса'
  await withE2eDatabase(async (client) => {
    await client.query(`insert into line_programs (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent)
      select 'E2E layout', 'LAYOUT', case when n=1 then $1 else 'LAYOUT-' || lpad(n::text, 2, '0') end, 'II', 'A', 10, 10 from generate_series(1,35) n`, [longName])
  })
  await page.goto('/percentage-lines')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill('LAYOUT')
  await expect(program.getByText('1–30 из 35 линий', { exact: true })).toBeVisible()
  await expect(program.getByTestId('line-program-card')).toHaveCount(30)
  const name = program.getByTestId('line-name').filter({ hasText: longName })
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(name).toHaveCSS('white-space', 'nowrap')
    await expect(name).toHaveAttribute('title', longName)
    expect(await name.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(25)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await expect(program.getByText('ПВК 10%', { exact: true })).toHaveCount(0)
  await program.getByRole('button', { name: 'Страница 2', exact: true }).click()
  await expect(program.getByText('31–35 из 35 линий', { exact: true })).toBeVisible()
  await expect(program.getByTestId('line-program-card')).toHaveCount(5)
  await program.getByRole('button', { name: 'Страница 1', exact: true }).click()
  await expect(program.getByTestId('line-program-card')).toHaveCount(30)
  await page.evaluate(() => window.scrollTo(0, 800))
  const toolbar = program.getByTestId('line-program-toolbar')
  await expect.poll(async () => (await toolbar.boundingBox())!.y).toBe(0)
  await expect(toolbar.getByRole('button', { name: 'Все линии', exact: true })).toBeVisible()
  await expect(toolbar.getByLabel('Поиск программы линий')).toBeVisible()
  const up = page.getByRole('button', { name: 'Вернуться в начало страницы' })
  await expect(up).toBeVisible()
  const arrowBox = (await up.boundingBox())!
  const reportBox = (await page.locator('[data-scroll-top-boundary]').boundingBox())!
  expect(arrowBox.x + arrowBox.width).toBeLessThan(reportBox.x + reportBox.width)
  await up.click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await program.getByRole('button', { name: 'Новая линия', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая линия' })
  await expect(dialog).toBeVisible()
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(560)
  await dialog.getByLabel('Проект', { exact: true }).press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(program.getByRole('button', { name: 'Новая линия', exact: true })).toBeFocused()
})

test('компактная таблица: 20 клейм, 148 стыков, редкие детали без лишних запросов, все стыки и сохранение выбора', async ({ page }) => {
  await withE2eDatabase(async (client) => {
    const { rows: [line] } = await client.query("insert into line_programs (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent) values ('E2E compact', 'COMPACT', 'COMPACT-LINE', 'II', 'A', 10, 0) returning id")
    await client.query(`insert into weld_joints (line_program_id, project_title, subtitle_code, line, joint, weld_date, connection_type, category, group_name, weld_control_percent, pvk_control_percent, has_vik, stamp_1_k, vik_result, has_rk, rk_result)
      select $1, 'E2E compact', 'COMPACT', 'COMPACT-LINE', 'F' || n::text, '2026-09-01', 'С17', 'II', 'A', 10, 0, 'да',
      'K' || lpad((case when n<=110 then 1 else 1+ceil((n-110)::numeric/2)::integer end)::text, 2, '0'), 'годен',
      case when n=1 then 'да' end, case when n=1 then 'годен' end from generate_series(1,148) n`, [line.id])
    await client.query("insert into duplicate_controls (weld_joint_id, method, result, conclusion, conclusion_date) select id, 'УЗК', 'ремонт', 'COMPACT-DUP', '2026-09-01' from weld_joints where line='COMPACT-LINE' and joint='F2'")
    await client.query("insert into pre_heat_treatment_controls (weld_joint_id, method, result, request_name) select id, 'ВИК', 'годен', 'COMPACT-PRE' from weld_joints where line='COMPACT-LINE' and joint='F3'")
  })
  const requests: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const id = new URL(request.url()).pathname.split('/_serverFn/')[1]
    if (!id) return
    try { requests.push(rpcName(request.url())) } catch { /* Non-RPC assets. */ }
  })
  const count = (name: string) => requests.filter((id) => id.startsWith(name + '_')).length
  await page.goto('/percentage-lines')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill('COMPACT-LINE')
  await expect(program.getByTestId('line-program-card')).toHaveCount(1)
  await program.getByRole('button', { name: 'Расчёт линии COMPACT-LINE' }).click()
  await expect(program.getByTestId('line-program-stamp')).toHaveCount(20)
  expect(count('getLineProgramCalculation')).toBe(1)
  expect(count('getLineProgramJointPage')).toBe(0)
  await expect(program.getByRole('columnheader', { name: 'ПВК · зачтено / норма' })).toHaveCount(0)
  await program.getByRole('button', { name: 'Клеймо K01', exact: true }).click()
  await expect(program.getByTestId('line-program-readonly-joint')).toHaveCount(50)
  expect(await program.getByTestId('stamp-joints-container').evaluate(element => element.previousElementSibling?.getAttribute('data-stamp'))).toBe('K01')
  const joints = program.getByRole('table', { name: 'Назначения и результаты' })
  await expect(joints.getByRole('columnheader')).toHaveCount(4)
  await expect(joints.getByRole('button', { name: 'Дубли: УЗК ремонт' })).toBeVisible()
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 })
    const firstRow = program.getByTestId('line-program-readonly-joint').first()
    expect((await firstRow.boundingBox())!.height).toBeLessThanOrEqual(90)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await joints.getByRole('button', { name: 'Дубли: УЗК ремонт' }).click()
  await expect(joints.getByLabel('Заключение: COMPACT-DUP')).toBeVisible()
  await expect(joints.getByRole('button', { name: 'НК до ТО · 1', exact: true })).toHaveCount(0)
  await joints.getByRole('button', { name: 'F3', exact: true }).click()
  await expect(joints.getByLabel('Заявка: COMPACT-PRE')).toBeVisible()
  await program.getByRole('button', { name: /^Назначения/ }).click()
  const editor = page.getByRole('dialog', { name: 'Назначения · COMPACT-LINE' })
  await expect(editor.getByRole('columnheader', { name: 'Результаты' })).toHaveCount(0)
  expect(count('getLineProgramJointPage')).toBe(1)
  await editor.getByRole('checkbox', { name: 'Выбрать F4', exact: true }).check()
  await expect(program.getByRole('navigation', { name: 'Страницы стыков' })).toHaveCount(1)
  await editor.getByRole('button', { name: 'Вернуться к просмотру' }).click()
  await program.getByRole('button', { name: 'Клеймо K01', exact: true }).click()
  await program.getByRole('button', { name: 'Клеймо K02', exact: true }).click()
  await expect(program.getByTestId('line-program-readonly-joint').filter({ visible: true })).toHaveCount(2)
  expect(await program.locator('[data-scope="stamp:k02"]').evaluate(element => element.previousElementSibling?.getAttribute('data-stamp'))).toBe('K02')
  const assignmentsBox = (await program.getByRole('button', { name: /^Назначения/ }).boundingBox())!
  expect(assignmentsBox.x + assignmentsBox.width).toBeLessThanOrEqual(1000)
  // Agreed eight-column layout (1 October): narrow views scroll within the
  // table; the page itself must stay within the viewport and every column accessible.
  const calculationTable = program.getByRole('table', { name: 'Расчёт по клеймам', exact: true })
  expect(await calculationTable.evaluate(element => {
    const container = element.parentElement!
    const before = container.scrollLeft
    container.scrollLeft = container.scrollWidth
    const canScroll = container.scrollLeft > before
    const lastColumn = element.querySelector('thead th:last-child')!.getBoundingClientRect()
    const viewport = container.getBoundingClientRect()
    const accessible = lastColumn.left >= viewport.left && lastColumn.right <= viewport.right + 1
    container.scrollLeft = before
    return canScroll && accessible && document.documentElement.scrollWidth <= window.innerWidth
  })).toBe(true)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await program.getByRole('button', { name: 'Клеймо K02', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'outputs/line-program-stamp-hierarchy-20260928.png' })
  await program.getByRole('button', { name: 'Клеймо K02', exact: true }).click()
  await expect(program.locator('[data-scope="stamp:k02"]')).toBeHidden()
  await expect(program.getByRole('button', { name: 'Клеймо K02', exact: true })).toBeFocused()
  expect(count('getLineProgramJointPage')).toBe(1)
  await program.getByRole('button', { name: 'Клеймо K01', exact: true }).click()
  await program.getByRole('button', { name: /^Назначения/ }).click()
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F4', exact: true })).toBeChecked()
  expect(count('getLineProgramCalculation')).toBe(1)
  expect(errors).toEqual([])
})

async function quickRows() {
  return withE2eDatabase(async (client) => (await client.query("select joint, has_rk, has_uzk, has_pvk, rk_result, uzk_result, pvk_result, layered_control_assigned from weld_joints where line='QUICK-LINE' order by joint")).rows)
}

async function seedQuickLine() {
  await withE2eDatabase(async (client) => {
    const { rows: [line] } = await client.query("insert into line_programs (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent) values ('E2E программа', 'LP', 'QUICK-LINE', 'II', 'A', 30, 10) returning id")
    await client.query(`insert into weld_joints (line_program_id, project_title, subtitle_code, line, joint, weld_date,
      connection_type, category, group_name, weld_control_percent, pvk_control_percent, has_vik, stamp_1_k, stamp_1_k_fact,
      officiality, revision_actuality, welding_method, material_group, d1, d2, t1, t2, wdi, isometry, spool,
      vik_control_basis, rk_control_basis, uzk_control_basis, pvk_control_basis)
      select $1, 'E2E программа', 'LP', 'QUICK-LINE', 'F' || (700+n)::text, '2026-09-01',
      case when n=2 then 'У17' else 'СШ' end, 'II', 'A', 30, 10, 'да', 'QUICK-A', 'QUICK-A',
      'действующий', 'актуальная', 'РД', 'M01', 108, 108, 4, 4, 0.42, 'ISO-QUICK', 'S1', 'проект', 'проект', 'проект', 'проект'
      from generate_series(1,20) n`, [line.id])
    await client.query(`insert into welder_stamps (naks_stamp, welder_name, weld_type, material_groups,
      diameter_from, diameter_to, thickness_from, thickness_to, valid_from, valid_to, naks_permits)
      values ('QUICK-A', 'E2E быстрые назначения', 'РД', 'M01', '1', '1000', '1', '100', '2026-01-01', '2026-12-31',
      '[{"id":"quick","weldType":"РД","materialGroups":"M01","diameterFrom":"1","diameterTo":"1000","thicknessFrom":"1","thicknessTo":"100","validFrom":"2026-01-01","validTo":"2026-12-31","archived":false}]')`)
  })
}
