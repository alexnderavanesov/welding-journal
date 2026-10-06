import { expect, test, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E PREPAGE'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('до ТО: страницы, поиск за первой страницей, совместные фильтры и повтор после ошибки', async ({ page }) => {
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,
      officiality,revision_actuality,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date)
      select $1,'PREPAGE','PREPAGE-L1','F'||lpad(n::text,3,'0'),'2026-09-01','С17','да',
        'действующий','актуальная',case when n=1 then 'MAIN' end,case when n=1 then date '2026-09-02' end,
        case when n=1 then 'годен' end,case when n=1 then 'MAIN-C' end,case when n=1 then date '2026-09-03' end
      from generate_series(1,103) n`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'ВИК','PRE-R-'||joint,'2026-09-01','годен','PRE-C-'||joint,'2026-09-02'
      from weld_joints where project_title=$1`, [project])
    // РК is the only rejected result. ВИК remains good; filters must match
    // one control, not take the method from ВИК and the result from РК.
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'РК','Ёлка 100%','2026-09-02','ремонт','LAST-PRE-RK','2026-09-03'
      from weld_joints where project_title=$1 and joint='F103'`, [project])
  })
  const calls: string[] = [], errors: string[] = []
  const pending = new Set<Request>()
  page.on('request', request => { if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url()).split('_')[0]); pending.add(request) } })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/lnk')
  await expect(page.getByLabel('Диспетчер задач', { exact: true })).toContainText('Изменения выполняются только после подтверждения.')
  await expect.poll(() => pending.size).toBe(0)
  const beforeRegistry = calls.length
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  await page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'До ТО', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК до ТО', exact: true }) })
  const search = dialog.getByPlaceholder('Стык, линия, заявка или заключение')
  const fillSearch = async (value: string) => {
    const loaded = page.waitForResponse(response => response.url().includes('/_serverFn/') &&
      rpcName(response.url()).startsWith('listLnkWorkflowRows') && Boolean(response.request().postData()?.includes(value)))
    await search.fill(value)
    await loaded
  }
  // Wait for the buffered search to commit before navigating. The unfiltered
  // first page can contain exactly the same 50 rows and isn't that evidence.
  await fillSearch(project)
  await expect(dialog.getByText('Стыков на странице: 50', { exact: true })).toBeVisible()
  await expect(dialog.getByText('PRE-C-F001', { exact: true })).toBeVisible()
  const firstCount = calls.filter(name => name === 'listLnkWorkflowRows').length
  await dialog.getByRole('button', { name: 'Следующие стыки', exact: true }).click()
  await expect(dialog.getByText('PRE-C-F051', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Следующие стыки', exact: true }).click()
  await expect(dialog.getByText('Стыков на странице: 3', { exact: true })).toBeVisible()
  await expect(dialog.getByText('LAST-PRE-RK', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Следующие стыки', exact: true })).toBeDisabled()
  expect(calls.filter(name => name === 'listLnkWorkflowRows').length - firstCount).toBe(2)
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(350)
  expect(calls.filter(name => name === 'listLnkWorkflowRows').length - firstCount).toBe(2)
  await fillSearch('елка 100%')
  await expect(dialog.getByText('Стыков на странице: 1', { exact: true })).toBeVisible()
  await expect(dialog.getByText('LAST-PRE-RK', { exact: true })).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Вид контроля в реестре' }).selectOption('ВИК')
  await expect(dialog.getByText('Стыков на странице: 0', { exact: true })).toBeVisible()
  await fillSearch(project)
  await dialog.getByRole('group', { name: 'Фильтр результатов' }).getByRole('button', { name: 'ремонт', exact: true }).click()
  await expect(dialog.getByText('Стыков на странице: 0', { exact: true })).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Вид контроля в реестре' }).selectOption('РК')
  await expect(dialog.getByText('LAST-PRE-RK', { exact: true })).toBeVisible()

  let fail = true
  await page.route('**/_serverFn/**', async route => {
    if (fail && rpcName(route.request().url()).startsWith('listLnkWorkflowRows')) {
      fail = false
      await route.fulfill({ status: 503, body: 'E2E temporary failure' })
    } else await route.continue()
  })
  await fillSearch('PRE-R-F102')
  await expect(dialog.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Повторить загрузку', exact: true })).toHaveCount(0)
  await expect(dialog.getByText('Стыков на странице: 0', { exact: true })).toBeVisible()
  await dialog.getByRole('group', { name: 'Фильтр результатов' }).getByRole('button', { name: 'Все', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Вид контроля в реестре' }).selectOption('')
  await expect(dialog.getByText('PRE-C-F102', { exact: true })).toBeVisible()
  expect(calls.slice(beforeRegistry).filter(name => /Dispatcher.*Refresh|refreshDispatcher/.test(name))).toEqual([])
  expect(errors).toEqual([])
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int as n from pre_heat_treatment_controls p join weld_joints w on w.id=p.weld_joint_id where w.project_title=$1', [project])).rows[0].n).toBe(104)
  })
})
