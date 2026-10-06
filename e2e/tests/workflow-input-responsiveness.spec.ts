import { expect, test, type Page, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E workflow input responsiveness'

test.beforeAll(async () => {
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joints(project_title, subtitle_code, line, joint, weld_date,
      connection_type, officiality, revision_actuality, has_vik, psto_required, stamp_1_k)
      select $1, 'RESP', 'RESP-' || kind || '-L' || ((n-1)/100+1),
        'F' || (case when kind='LNK' then 90000 else 92000 end+n), '2026-09-01',
        'С17', 'действующий', 'актуальная', 'да', case when kind='PSTO' then 'да' else 'нет' end, 'RESP-K'
      from generate_series(1,1200) n cross join (values ('LNK'), ('PSTO')) as kinds(kind)`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,
      result,conclusion_name,conclusion_date)
      select id,'ВИК','RESP-PRE-'||line,'2026-09-02','годен','RESP-PRE-C-'||line,'2026-09-03'
      from weld_joints where project_title=$1 and line like 'RESP-PSTO-%'`, [project])
  })
})
test.afterAll(() => cleanupLineProgramProjects([project]))

for (const kind of ['LNK', 'PSTO'] as const) test(`${kind}: набор, выбор и повторное открытие на 1200 кандидатах`, async ({ page }) => {
  test.setTimeout(120_000)
  const calls: string[] = [], errors: string[] = [], pending = new Set<Request>()
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (!request.url().includes('/_serverFn/')) return
    calls.push(rpcName(request.url()).split('_')[0]!)
    pending.add(request)
  })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  await installInputMeasurements(page)
  await page.goto(kind === 'LNK' ? '/lnk' : '/psto')
  const title = kind === 'LNK' ? 'Заявка ЛНК' : 'Заявка ПСТО'
  const open = async () => {
    await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
    await page.getByRole('button', { name: 'Новая заявка', exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  }
  await open()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  if (kind === 'LNK') {
    const method = dialog.getByRole('button', { name: 'ВИК', exact: true })
    await method.click()
    await expect(method).toHaveAttribute('aria-pressed', 'true')
  }
  const search = dialog.getByPlaceholder('Проект, шифр, линия, спул или стык')
  const rowsRpc = kind === 'LNK' ? 'listLnkWorkflowRows' : 'listPstoWorkflowRows'
  await expect.poll(() => pending.size).toBe(0)
  const beforeSearch = calls.filter(name => name === rowsRpc).length
  await search.pressSequentially(`RESP-${kind}-`, { delay: 15 })
  await expect(search).toHaveValue(`RESP-${kind}-`)
  await expect(search).toBeFocused()
  await expect.poll(() => calls.filter(name => name === rowsRpc).length).toBeGreaterThan(beforeSearch)
  await expect.poll(() => pending.size).toBe(0)
  // Fast typing is debounced: a query per character is not acceptable.
  expect(calls.filter(name => name === rowsRpc).length - beforeSearch).toBeLessThanOrEqual(2)
  const checks = dialog.getByRole('checkbox', { name: /^Выбрать стык RESP-/ })
  await expect(checks.first()).toBeEnabled()
  expect(await checks.count()).toBeLessThan(60) // virtualization, not 500 mounted rows
  const selectionStart = calls.length
  for (let row = 0; row < 5; row++) {
    const checkbox = checks.nth(row)
    await checkbox.check()
    await expect(checkbox).toBeChecked()
  }
  await expect(dialog.getByRole('button', { name: 'Выбрано: 5', exact: true })).toBeEnabled()
  await expect.poll(() => pending.size).toBe(0)
  expect(calls.slice(selectionStart).filter(name => name === rowsRpc).length).toBeLessThanOrEqual(6)

  const bulkStart = calls.length
  await dialog.getByRole('button', { name: 'Выбрать доступные', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Выбрано: 500', exact: true })).toBeEnabled()
  await expect.poll(() => pending.size).toBe(0)
  expect(calls.slice(bulkStart).filter(name => name === rowsRpc).length).toBeLessThanOrEqual(2)
  expect(await checks.count()).toBeLessThan(60)

  await dialog.getByRole('tab', { name: /Заявки и имена/ }).click()
  await dialog.getByRole('button', { name: 'Пользовательское', exact: true }).click()
  const nameInput = dialog.getByRole('textbox', { name: /^Название заявки/ }).first()
  await expect(nameInput).toBeVisible()
  await nameInput.fill('')
  const beforeName = calls.length
  await nameInput.pressSequentially('Проверка быстрого ввода 1234567890', { delay: 15 })
  await expect(nameInput).toHaveValue('Проверка быстрого ввода 1234567890')
  await expect(nameInput).toBeFocused()
  expect(calls.slice(beforeName).filter(name => name === rowsRpc)).toEqual([])
  await nameInput.press('Tab')
  await expect.poll(() => pending.size).toBe(0)
  // Wait beyond debounce and trigger the actual focus/reconnect listeners.
  const idleStart = calls.length
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise(resolve => setTimeout(resolve, 400))
  })
  expect(calls.slice(idleStart)).toEqual([])
  const measurements = await page.evaluate(() => (window as unknown as {
    workflowInputSamples: Array<{ event: string; ms: number }>
  }).workflowInputSamples)
  const sorted = measurements.map(item => item.ms).sort((a,b) => a-b)
  expect(sorted.length).toBeGreaterThan(20)
  const p95 = sorted[Math.floor(sorted.length * .95)]!
  console.log(JSON.stringify({ workflow: kind, candidates: 1200, loadedLimit: 500,
    samples: sorted.length, inputToPaintP95Ms: Math.round(p95 * 10) / 10,
    inputToPaintMaxMs: Math.round(sorted.at(-1)! * 10) / 10, rowsRequests: calls.filter(name => name === rowsRpc).length }))
  // A generous regression budget, not a production-device SLA. Exact values
  // are logged for comparison with the previous production build.
  expect(p95).toBeLessThan(250)
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(dialog).toBeHidden()
  await open()
  await expect(dialog.getByPlaceholder('Проект, шифр, линия, спул или стык')).toBeVisible()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(errors).toEqual([])
})

async function installInputMeasurements(page: Page) {
  await page.addInitScript(() => {
    const samples: Array<{ event: string; ms: number }> = []
    ;(window as unknown as { workflowInputSamples: typeof samples }).workflowInputSamples = samples
    for (const event of ['input', 'change']) document.addEventListener(event, e => {
      if (!(e.target instanceof HTMLInputElement) || !e.target.closest('[role="dialog"]')) return
      const start = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => samples.push({ event, ms: performance.now() - start })))
    }, true)
  })
}
