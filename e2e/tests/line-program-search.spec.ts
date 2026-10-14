import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E search-first lines'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed() {
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'FILTER','FIND-'||lpad(n::text,3,'0'),'II','A',10,0 from generate_series(1,65) n`, [project])
    // The matching stamp exists on only one of the ten joints. The other nine
    // must remain in the norm. A missing legacy FK must not hide this line.
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,
      officiality,revision_actuality,stamp_1_k,stamp_1_z,has_vik)
      select $1,'FILTER','FIND-065','F'||n,'2026-09-01','С17','действующий','актуальная',
        'BASE',case when n=1 then 'MATCH_%' end,'да' from generate_series(1,10) n`, [project])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'FILTER','FIND-INCOMPLETE','II','A',100,null)`, [project])
  })
}

test('early pages, independent search, literal legacy stamp and complete-line norm', async ({ page }) => {
  await seed()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let held = false
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.route('**/_serverFn/**', async route => {
    if (!held && rpcName(route.request().url()).startsWith('getLineProgramSection_')) {
      held = true
      await gate
    }
    await route.continue().catch(() => {})
  })
  try {
    await page.goto('/line-program')
    await expect(page.getByTestId('line-program-card')).toHaveCount(30)
    await expect.poll(() => held).toBe(true)
    await expect(page.getByRole('status')).toContainText('Рассчитываем итоги всего отбора')
    await expect(page.getByLabel('Итоги раздела')).toHaveCount(0)
    await expect(page.locator('header').getByRole('button', { name: 'Показать', exact: true })).toBeDisabled()
    await page.getByLabel('Поиск программы линий').fill('match_%')
    const card = page.getByTestId('line-program-card')
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId('line-name')).toHaveText('FIND-065')
    await expect(card.getByRole('button', { name: 'Учитываемых соединений 10', exact: true })).toBeVisible()
    await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 1', exact: true })).toBeVisible()
    release()
    await card.getByRole('button', { name: 'Расчёт линии FIND-065', exact: true }).click()
    await expect(card.getByTestId('line-program-stamp')).toHaveCount(2)
    await expect(card.getByTestId('line-name')).toHaveText('FIND-065')
    // Literal wildcard matching, and an empty result is not a partial page.
    await page.getByLabel('Поиск программы линий').fill('match_X')
    await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 0', exact: true })).toBeVisible()
    await expect(page.getByTestId('line-program-card')).toHaveCount(0)
    await page.getByLabel('Поиск программы линий').fill(project)
    await page.getByRole('button', { name: '100%-ные линии', exact: true }).click()
    await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 0', exact: true })).toBeVisible()
    const before = calls.length
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await page.waitForTimeout(400)
    expect(calls.slice(before).filter(name => /^getLineProgram(Page|Section|Calculation|JointPage)_/.test(name))).toEqual([])
    expect(errors).toEqual([])
  } finally { release(); await page.close() }
})

test('a late complete summary cannot replace a page read after another client changed the source', async ({ page }) => {
  await seed()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let held = false, captured = false, sectionReads = 0
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith('getLineProgramSection_')) return route.continue()
    sectionReads++
    if (held) return route.continue()
    held = true
    const response = await route.fetch()
    captured = true
    await gate
    await route.fulfill({ response }).catch(() => {})
  })
  try {
    await page.goto('/line-program')
    await expect.poll(() => captured).toBe(true)
    await withLineProgramFixture(db => db.query(`update line_programs set weld_control_percent=20,updated_at=now()
      where project_title=$1 and line='FIND-035'`, [project]))
    await page.getByRole('button', { name: 'Страница 2', exact: true }).click()
    const card = page.getByTestId('line-program-card').filter({ has: page.getByTestId('line-name').filter({ hasText: /^FIND-035$/ }) })
    await expect(card.getByTestId('line-name')).toHaveText('FIND-035')
    await expect(card.getByRole('button', { name: 'Расчёт линии FIND-035', exact: true })).toContainText('20%')
    release()
    await expect(page.getByLabel('Итоги раздела')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Расчёт линии FIND-035', exact: true })).toContainText('20%')
    expect(sectionReads).toBe(2)
  } finally { release(); await page.close() }
})
