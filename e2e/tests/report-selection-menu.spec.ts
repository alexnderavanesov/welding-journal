import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const PROJECT = 'E2E offpage report menu'
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([PROJECT])
})

for (const path of ['/lnk', '/psto']) {
  test(`${path}: действия сохраняют все выбранные, включая незагруженные, за пределами текущей выборки одним запросом`, async ({ page }) => {
    await withLineProgramFixture(db => db.query(`insert into weld_joints
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
    await expect(page.getByText('Найдено: 110', { exact: true })).toBeVisible()
    const selectAll = page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox')
    await selectAll.click()
    await expect(page.getByLabel('Действия с выбранными стыками', { exact: true })).toContainText('Выбрано: 110')
    await page.getByRole('button', { name: 'F0001', exact: true }).locator('xpath=ancestor::*[@role="row"]').getByRole('checkbox').uncheck()
    const panel = page.getByLabel('Действия с выбранными стыками', { exact: true })
    await expect(panel).toContainText('Выбрано: 109')
    {
      const actions = panel.getByRole('button', { name: 'Действия', exact: true })
      await actions.click()
      await expect(page.getByTestId('context-action-menu')).toContainText('Выбрано стыков: 109')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('context-action-menu')).toBeHidden()
      await expect(actions).toBeFocused()
      await expect(panel).toContainText('Выбрано: 109')
      expect(countExact()).toBe(1)
    }
    await panel.getByRole('button', { name: 'Снять выбор', exact: true }).click()
    await expect(panel).toBeHidden()
    await expect(selectAll).not.toBeChecked()
    await selectAll.click()
    await expect(page.getByLabel('Действия с выбранными стыками', { exact: true })).toContainText('Выбрано: 110')
    await page.getByRole('button', { name: 'F0001', exact: true }).locator('xpath=ancestor::*[@role="row"]').getByRole('checkbox').uncheck()
    await expect(panel).toContainText('Выбрано: 109')
    await search.fill(`${PROJECT} отсутствующий-стык`)
    await expect(page.getByText('Найдено: 0', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(countExact()).toBe(1)
    await panel.getByRole('button', { name: 'Действия', exact: true }).click()
    const menu = page.getByTestId('context-action-menu')
    await expect(menu).toContainText('Выбрано стыков: 109')
    const navigate = menu.getByRole('button', { name: 'Перейти', exact: true })
    await expect(navigate).toBeVisible({ timeout: 5000 })
    await expect.poll(() => menu.evaluate(element => element.getBoundingClientRect().bottom - (innerHeight - 8)), { timeout: 5000 }).toBeLessThanOrEqual(0)
    await navigate.hover()
    const navigation = page.getByRole('menu', { name: 'Перейти', exact: true })
    const openJournal = navigation.getByRole('button', { name: 'Открыть в сварочном журнале (109)', exact: true })
    await expect(openJournal).toBeVisible({ timeout: 5000 })
    await openJournal.click()
    expect(countExact()).toBe(2)
    // LNK/PSTO use their existing cross-report navigation command. The
    // destination includes unloaded records and excludes the explicitly unchecked record.
    await expect(page.locator('[data-welding-journal-grid]')).toBeVisible()
    await expect(page.getByText('Найдено: 109', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'F0001', exact: true })).toBeHidden()
    await page.waitForLoadState('networkidle')
    expect(countExact()).toBe(2)
    expect(errors).toEqual([])
  })
}
