import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const PROJECT = 'E2E offpage report menu'
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([PROJECT])
})

for (const path of ['/lnk', '/psto']) {
  test(`${path}: действия сохраняют все 100 выбранных за пределами текущей выборки одним запросом`, async ({ page }) => {
    await withE2eDatabase(db => db.query(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,psto_required,stamp_1_k)
      select $1,'MENU','OFFPAGE-MENU','F'||lpad(n::text,4,'0'),'2026-09-01','С17','действующий','актуальная','да','да','K1'
      from generate_series(1,110) n`, [PROJECT]))
    const errors: string[] = [], calls: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    const countExact = () => calls.filter(name => name.startsWith('listWeldJointRowsByIds_')).length
    await page.goto(path)
    const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
    await search.fill(PROJECT)
    if (path === '/psto') {
      await expect(page.getByText('Загружено: 100 из 110', { exact: true })).toBeVisible()
      await page.locator('[data-psto-grid] .ag-header-cell').getByRole('checkbox').check()
    } else {
      await expect(page.getByText('из 110 строк', { exact: true })).toBeVisible()
      await expect(page.getByText('1-100', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Выбрать видимые стыки', exact: true }).click()
    }
    const panel = page.getByLabel('Действия с выбранными стыками', { exact: true })
    await expect(panel).toContainText('Выбрано: 100')
    if (path === '/psto') {
      const actions = panel.getByRole('button', { name: 'Действия', exact: true })
      await actions.click()
      await expect(page.getByTestId('context-action-menu')).toContainText('Выбрано стыков: 100')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('context-action-menu')).toBeHidden()
      await expect(actions).toBeFocused()
      await expect(panel).toContainText('Выбрано: 100')
      expect(countExact()).toBe(0)
    }
    await search.fill(`${PROJECT} отсутствующий-стык`)
    await expect(page.getByText(path === '/psto' ? 'Загружено: 0 из 0' : 'из 0 строк', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(countExact()).toBe(0)
    await panel.getByRole('button', { name: 'Действия', exact: true }).click()
    const menu = page.getByTestId('context-action-menu')
    await expect(menu).toContainText('Выбрано стыков: 100')
    const navigate = menu.getByRole('button', { name: 'Перейти', exact: true })
    await expect(navigate).toBeVisible({ timeout: 5000 })
    await expect.poll(() => menu.evaluate(element => element.getBoundingClientRect().bottom - (innerHeight - 8)), { timeout: 5000 }).toBeLessThanOrEqual(0)
    await navigate.hover()
    const navigation = page.getByRole('menu', { name: 'Перейти', exact: true })
    const openJournal = navigation.getByRole('button', { name: 'Открыть в сварочном журнале (100)', exact: true })
    await expect(openJournal).toBeVisible({ timeout: 5000 })
    await openJournal.click()
    expect(countExact()).toBe(1)
    // LNK/PSTO use their existing cross-report navigation command. The
    // destination must exclude the ten records that were never selected.
    await expect(page.locator('[data-welding-journal-grid]')).toBeVisible()
    await expect(page.getByText('Загружено: 100 из 100', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(countExact()).toBe(1)
    expect(errors).toEqual([])
  })
}
