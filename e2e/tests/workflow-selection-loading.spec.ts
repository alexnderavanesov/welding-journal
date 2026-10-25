import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E workflow selection loading'
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' })
  await page.close()
  await cleanupLineProgramProjects([project])
})

for (const report of ['lnk', 'psto'] as const) for (const mode of ['request', 'result'] as const) {
  test(`${report} ${mode}: повторное открытие с другим выбором вне кешированной страницы`, async ({ page }) => {
    await withLineProgramFixture(db => db.query(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,psto_required,stamp_1_k)
      select $1,'LOAD','SELECTION-LOAD','F88'||lpad(n::text,4,'0'),'2026-09-01','С17','действующий','актуальная',$2,$3,'K1'
      from generate_series(1,604) n`, [project, report === 'lnk' ? 'да' : 'нет', report === 'psto' ? 'да' : 'нет']))
    if (report === 'psto') await withLineProgramFixture(db => db.query(`insert into pre_heat_treatment_controls
      (weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'ВИК','LOAD-PRE','2026-09-02','годен','LOAD-PRE-C','2026-09-03'
      from weld_joints where project_title=$1`, [project]))
    if (mode === 'result') await withLineProgramFixture(db => db.query(report === 'lnk'
      ? `update weld_joints set vik_request='LOAD-R',vik_request_date='2026-09-04',vik_result='ожидает НК' where project_title=$1`
      : `update weld_joints set psto_request='LOAD-R',psto_request_date='2026-09-04',psto_result='ожидает ПСТО' where project_title=$1`, [project]))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const rpc = report === 'lnk' ? 'listLnkWorkflowRows_' : 'listPstoWorkflowRows_'
    let calls = 0, pending = 0
    await page.route('**/*', async route => {
      if (rpcName(route.request().url()).startsWith(rpc)) {
        calls++
        // A real response, delayed to expose stale-cache/initialization races.
        pending++
        try {
          const response = await route.fetch()
          await new Promise(resolve => setTimeout(resolve, 500))
          await route.fulfill({ response })
        } finally { pending-- }
      } else await route.continue()
    })
    await page.goto(`/${report}`)
    const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
    const selectAll = page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox')
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: mode === 'request' ? (report === 'lnk' ? 'Заявка ЛНК' : 'Заявка ПСТО') : (report === 'lnk' ? 'Внесение результатов ЛНК' : 'Внесение результатов ПСТО'), exact: true }) })
    for (const [iteration, prefix] of ['F88000', 'F88060', 'F88060'].entries()) {
      await search.fill(prefix)
      await expect(page.getByText(`Найдено: ${prefix === 'F88000' ? 9 : 5}`, { exact: true })).toBeVisible()
      if (await selectAll.isChecked()) await selectAll.uncheck()
      await selectAll.check()
      const count = prefix === 'F88000' ? 9 : 5
      await page.locator('header').getByRole('button', { name: mode === 'request' ? 'Заявка' : 'Результат', exact: true }).click()
      await page.getByRole('button', { name: mode === 'request' ? (report === 'lnk' && iteration === 1 ? 'Добавить позиции' : 'Новая заявка') : 'Внести результаты', exact: true }).click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(`Выбрано: ${count}`, { exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: `Выбрано: ${count}`, exact: true }).click()
      await expect(dialog.getByRole('checkbox', { name: `Выбрать стык SELECTION-LOAD ${prefix === 'F88000' ? 'F880001' : 'F880604'}`, exact: true })).toBeChecked()
      // This test closes a fully loaded dialog. Pending-response cancellation
      // is exercised separately by workflow-selection-races with explicit gates.
      // Chromium can already report networkidle while a cached dialog has a
      // background response held by this route handler. Wait for that response.
      await expect.poll(() => pending).toBe(0)
      if (iteration === 2 && mode === 'request') {
        await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).click()
        await expect(dialog).toBeHidden()
        const column = report === 'lnk' ? 'vik_request' : 'psto_request'
        const saved = await withLineProgramFixture(db => db.query(`select joint from weld_joints
          where project_title=$1 and ${column} is not null order by joint`, [project]))
        expect(saved.rows.map(row => row.joint)).toEqual(['F880600','F880601','F880602','F880603','F880604'])
        break
      }
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
      // Explicitly clear the old report selection before changing the filter.
      await selectAll.uncheck()
    }
    expect(calls).toBeLessThanOrEqual(mode === 'request' ? 6 : 12)
    expect(errors).toEqual([])
  })
}
