import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

test.afterEach(() => cleanupLineProgramProjects(['E2E ввод', 'E2E фон ввода']))

test('карточка: общие поля защищены, индивидуальные редактируются, быстрый ввод не теряет символы', async ({ page }, testInfo) => {
  await withE2eDatabase(async (client) => {
    // Match a populated journal: isolated runs must not measure a nearly empty table.
    await client.query(`insert into weld_joints(project_title,line,joint,has_vik)
      select 'E2E фон ввода','INPUT-BACKGROUND','F'||n,'да' from generate_series(1000,1199) n`)
    const { rows: [program] } = await client.query(`insert into line_programs
      (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent)
      values ('E2E ввод', 'INPUT', 'INPUT-LINE', 'II', 'Б(а)', 10, 10) returning id`)
    await client.query(`insert into weld_joints
      (line_program_id, project_title, subtitle_code, line, joint, category, group_name, weld_control_percent, pvk_control_percent,
       isometry, sheet, revision_number, connection_type, has_vik, officiality)
      values ($1, 'E2E ввод', 'INPUT', 'INPUT-LINE', 'F990', 'II', 'Б(а)', 10, 10, 'ISO-990', 1, 0, 'СШ', 'да', 'действующий')`, [program.id])
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/journal')
  const row = page.getByRole('button', { name: 'F990', exact: true }).locator('xpath=ancestor::tr')
  await row.getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  await expect(editor.getByText(/Программа линии: базовый 10%/)).toBeVisible()
  for (const label of ['Проект', 'Шифр', 'Группа трубопровода', 'Категория трубопровода', 'Контроль швов, (%)']) {
    await expect(editor.getByRole('textbox', { name: label, exact: true })).toHaveAttribute('readonly')
  }
  for (const label of ['Линия', 'Изометрия', 'Номер листа', 'Номер ИЗМа']) {
    await expect(editor.getByRole('textbox', { name: label, exact: true })).toBeEditable()
  }
  const identityInputs = await Promise.all(['Проект', 'Шифр', 'Линия'].map((name) =>
    editor.getByRole('textbox', { name, exact: true }).boundingBox()))
  expect(identityInputs.every(Boolean)).toBe(true)
  expect(Math.max(...identityInputs.map((box) => box!.y)) - Math.min(...identityInputs.map((box) => box!.y))).toBeLessThanOrEqual(1)

  // Record input-to-next-frame delay rather than the duration of automation calls.
  await page.evaluate(() => {
    const samples: number[] = []
    const longTasks: Array<{ start: number; duration: number }> = []
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ type: 'longtask' })
    document.addEventListener('input', (event) => {
      if (!(event.target instanceof HTMLInputElement) || !event.target.closest('[role="dialog"]')) return
      const start = performance.now()
      requestAnimationFrame(() => samples.push(performance.now() - start))
    })
    Object.assign(window, { __weldInputFrameSamples: samples, __weldInputLongTasks: longTasks })
  })
  const requests: Array<{ url: string; body: string }> = []
  page.on('request', (request) => {
    if (request.url().includes('/_serverFn/')) requests.push({ url: request.url(), body: request.postData() ?? '' })
  })
  const line = editor.getByRole('textbox', { name: 'Линия', exact: true })
  await line.fill('')
  await line.pressSequentially('INPUT-быстрый-ввод-0123456789', { delay: 15 })
  await expect(line).toHaveValue('INPUT-быстрый-ввод-0123456789')
  await expect(editor.getByText(/Новая линия появится в программе после сохранения/)).toBeVisible()
  await page.waitForTimeout(500)
  // Initial/final suggestions, one refresh after the program fills its shared
  // fields, the program lookup and one debounced move check. Never per character.
  expect(requests.length).toBeLessThanOrEqual(5)
  const lineRequests = requests.length
  await line.fill('INPUT-LINE')
  await line.press('Tab')
  await expect(editor.getByText(/Программа линии: базовый 10%/)).toBeVisible()
  await page.waitForTimeout(400)
  requests.length = 0
  const isometry = editor.getByRole('textbox', { name: 'Изометрия', exact: true })
  await isometry.fill('')
  await isometry.pressSequentially('ISO-быстрый-ввод-0123456789', { delay: 15 })
  await expect(isometry).toHaveValue('ISO-быстрый-ввод-0123456789')
  await editor.getByRole('textbox', { name: 'Номер листа', exact: true }).fill('17')
  await editor.getByRole('textbox', { name: 'Номер ИЗМа', exact: true }).fill('3')
  // At most an initial and a final suggestion request for each of the three
  // focused fields; no line-program reads, move checks, or closed-field queries.
  await page.waitForTimeout(700)
  expect(requests.length).toBeLessThanOrEqual(6)
  expect(requests.every(({ body }) => body.includes('"fieldKey"'))).toBe(true)
  const samples = await page.evaluate(() => (window as unknown as { __weldInputFrameSamples: number[] }).__weldInputFrameSamples)
  const sorted = [...samples].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const longTasks = await page.evaluate(() => (window as unknown as { __weldInputLongTasks: unknown[] }).__weldInputLongTasks)
  const measurements = { samples: samples.length, p95, max: sorted.at(-1), lineRequests, otherFieldRequests: requests.length, longTasks }
  console.info('Weld form input:', JSON.stringify(measurements))
  await testInfo.attach('input-latency.json', { body: JSON.stringify(measurements), contentType: 'application/json' })
  expect(samples.length).toBeGreaterThan(20)
  expect(p95).toBeLessThan(200)

  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(await withE2eDatabase(async (client) => (await client.query(`select project_title, subtitle_code, line, isometry, sheet::float, revision_number::float
    from weld_joints where joint='F990' and subtitle_code='INPUT'`)).rows[0])).toEqual({
    project_title: 'E2E ввод', subtitle_code: 'INPUT', line: 'INPUT-LINE', isometry: 'ISO-быстрый-ввод-0123456789', sheet: 17, revision_number: 3,
  })
  expect(errors).toEqual([])

  await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
  const newEditor = page.getByRole('dialog')
  await expect(newEditor.getByRole('textbox', { name: 'Проект', exact: true })).toBeEditable()
  await expect(newEditor.getByRole('textbox', { name: 'Шифр', exact: true })).toBeEditable()
  await newEditor.getByRole('button', { name: 'Отмена', exact: true }).click()
})
