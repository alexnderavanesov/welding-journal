import { expect, test } from '@playwright/test'
import { createSmoothnessProbe } from '../smoothness-probe'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { seedSmoothnessFixture, cleanupSmoothnessFixture } from '../smoothness-fixture'

const enabled = !!process.env.SMOOTHNESS_LABEL
test.skip(!enabled, 'Explicit local performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })
test.beforeAll(async () => { if (enabled) { test.setTimeout(180000); await seedSmoothnessFixture() } })
test.afterAll(async () => { if (enabled) { test.setTimeout(180000); await cleanupSmoothnessFixture() } })

for (const scope of ['primary', 'beforeHeatTreatment', 'psto', 'tvmt'] as const) for (const mode of ['request', 'result'] as const) {
  test(`${scope} ${mode}: 100 selected joints, repeated opening, input and virtual scrolling`, async ({ page }, info) => {
    test.setTimeout(180000)
    const project = `E2E smooth workflow ${scope} ${mode}`
    const probe = await createSmoothnessProbe(page, info)
    try {
      await withLineProgramFixture(async db => {
        await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,psto_required,stamp_1_k,lnk_created_at,psto_created_at)
          select $1,'SM-WF','SM-WF','F'||lpad(n::text,4,'0'),'2026-10-01','С17','действующий','актуальная','да',$2,'Q000','2026-10-01','2026-10-01'
          from generate_series(1,100) n`, [project, scope === 'primary' ? 'нет' : 'да'])
        if (scope === 'primary' && mode === 'result') await db.query(`update weld_joints set vik_request='SM-WF-R',vik_request_date='2026-10-02',vik_result='ожидает НК' where project_title=$1`, [project])
        if (scope !== 'primary' && (scope !== 'beforeHeatTreatment' || mode === 'result')) await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
          select id,'ВИК','SM-WF-PRE','2026-10-02',case when $2 then 'ожидает НК' else 'годен' end,
          case when $2 then null else 'SM-WF-PRE-C' end,case when $2 then null else date '2026-10-03' end
          from weld_joints where project_title=$1`, [project, scope === 'beforeHeatTreatment'])
        if ((scope === 'psto' && mode === 'result') || scope === 'tvmt') await db.query(`update weld_joints set psto_request='SM-WF-PSTO',psto_request_date='2026-10-04' where project_title=$1`, [project])
        if (scope === 'tvmt') await db.query(`update weld_joints set psto_result='проведено',psto_date='2026-10-05',heat_treatment_diagram='SM-WF-D' where project_title=$1`, [project])
        if (scope === 'tvmt' && mode === 'result') await db.query(`update weld_joints set tvmt_request='SM-WF-TVMT',tvmt_request_date='2026-10-06',tvmt_result='ожидает НК' where project_title=$1`, [project])
      })
      await page.goto(scope === 'psto' || scope === 'tvmt' ? '/psto' : '/lnk')
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
      await expect(page.getByText('Найдено: 100', { exact: true })).toBeVisible({ timeout: 60000 })
      await probe.measure(`${scope}:${mode}:select-100`, async () => {
        const selectAll = page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox')
        await selectAll.click()
        await expect(selectAll).toBeChecked({ timeout: 60000 })
      })
      const title = `${mode === 'request' ? 'Заявка' : 'Внесение результатов'} ${scope === 'psto' ? 'ПСТО' : scope === 'tvmt' ? 'ТВМТ' : scope === 'beforeHeatTreatment' ? 'ЛНК до ТО' : 'ЛНК'}`
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      for (let round = 0; round < 3; round++) {
        if (round > 0) {
          // Primary request selection is shared with the report. Restore the
          // same 100-row input after the previous draft's deliberate deselect.
          const all = page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox')
          if (!await all.isChecked()) { await all.click(); await expect(all).toBeChecked({ timeout: 60000 }) }
        }
        await probe.measure(`${scope}:${mode}:open:${round}`, async () => {
          await page.locator('header').getByRole('button', { name: scope === 'tvmt' ? 'ТВМТ' : mode === 'request' ? 'Заявка' : 'Результат', exact: true }).click()
          await page.getByRole('button', { name: scope === 'tvmt' ? (mode === 'request' ? 'Новая заявка ТВМТ' : 'Внести результаты ТВМТ') : mode === 'request' ? 'Новая заявка' : 'Внести результаты', exact: true }).click()
          await expect(dialog.getByRole('button', { name: 'Выбрано: 100', exact: true })).toBeVisible({ timeout: 60000 })
          if (mode === 'result' && (scope === 'primary' || scope === 'beforeHeatTreatment')) {
            const method = dialog.getByRole('combobox', { name: 'Метод контроля', exact: true })
            await expect(method).toBeEnabled({ timeout: 60000 })
            if (await method.inputValue() !== (scope === 'primary' ? 'vikRequest' : 'ВИК')) {
              await method.click()
              await page.getByRole('listbox').getByRole('option', { name: 'ВИК', exact: true }).click()
            }
          }
        })
        await dialog.getByRole('button', { name: 'Выбрано: 100', exact: true }).click()
        const rows = dialog.locator('[data-index]')
        await expect(rows.first()).toBeVisible()
        expect(await rows.count()).toBeLessThan(60)
        if (round === 0) {
          await probe.scroll(`${scope}:${mode}:selected-scroll`, rows.first().locator('../..'))
          const checkbox = dialog.getByRole('checkbox', { name: 'Выбрать стык SM-WF F0001', exact: true })
          await probe.measure(`${scope}:${mode}:selection`, async () => {
            // The selected-only list removes this row immediately. A first()
            // uncheck would keep resolving to a different still-checked row.
            await checkbox.click()
            await expect(dialog.getByRole('button', { name: 'Выбрано: 99', exact: true })).toBeVisible()
          })
          const dateLabel = mode === 'request' ? 'Дата заявки' : scope === 'psto' ? 'Дата ПСТО' : scope === 'tvmt' ? 'Дата ТВМТ' : 'Дата контроля'
          await probe.measure(`${scope}:${mode}:input`, async () => { await dialog.getByLabel(dateLabel, { exact: true }).fill('2026-10-12') })
        }
        await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
        await expect(dialog).toBeHidden()
      }
    } finally { await probe.finish(); await page.close(); await cleanupLineProgramProjects([project]) }
  })
}

test('registries, officiality, duplicate controls and dispatcher: nested lists', async ({ page }, info) => {
  test.setTimeout(300000)
  const officialityProject = 'E2E smoothness officiality'
  const probe = await createSmoothnessProbe(page, info)
  try {
    await withLineProgramFixture(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,
      officiality,revision_actuality,welding_method,material_group,d1,d2,t1,t2,wdi,stamp_1_k,
      has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
      has_uzk,uzk_request,uzk_request_date,uzk_result,uzk_conclusion,uzk_conclusion_date,psto_required)
      select $1,'SM-OFFICIALITY','SM-OFFICIALITY','F'||lpad(n::text,4,'0'),'2026-10-01','С17',
      'действующий','актуальная','РД','М01',108,108,4,4,0.42,'Q000',
      'да','SM-O-V','2026-10-02','годен','SM-O-VC','2026-10-03',
      'да','SM-O-U','2026-10-04','ремонт','SM-O-UC','2026-10-05','нет'
      from generate_series(1,100) n`, [officialityProject]))
    for (const [route, menu, action, title] of [
      ['/lnk', 'Заявка', 'Все заявки ЛНК', 'Редактирование заявок ЛНК'],
      ['/lnk', 'Результат', 'Все результаты ЛНК', 'Редактирование результатов ЛНК'],
      ['/psto', 'Результат', 'История ПСТО и ТВМТ', 'История ПСТО и ТВМТ'],
    ]) {
      await page.goto(route)
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      const choice = route === '/psto' ? dialog.locator('aside').getByRole('button').filter({ hasText: /SM-\d+ ·/ }).first()
        : dialog.locator('[data-index]').first().getByRole('button').first()
      await probe.measure(`registry:${title}:open`, async () => {
        await page.locator('header').getByRole('button', { name: menu, exact: true }).click()
        await page.getByRole('button', { name: action, exact: true }).click()
        await expect(dialog).toBeVisible()
        await expect(choice).toBeVisible()
      })
      await probe.scroll(`registry:${title}:scroll`, route === '/psto' ? dialog.locator('aside .overflow-y-auto') : dialog.locator('[data-index]').first().locator('../..'))
      await probe.measure(`registry:${title}:detail`, async () => { await choice.click(); await page.waitForLoadState('networkidle') })
      await probe.scroll(`registry:${title}:detail-scroll`, dialog)
    }
    for (const action of ['Официальность', 'Дубль контроль']) {
      await page.goto('/lnk')
      const dialog = page.getByRole('dialog')
      await probe.measure(`${action}:open-search`, async () => {
        await page.locator('header').getByRole('button', { name: action, exact: true }).click()
        await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('SM-OFFICIALITY')
        await expect(dialog.getByText(/^Найдено: [1-9]\d* · Выбрано: 0$/)).toBeVisible({ timeout: 60000 })
      })
      await probe.scroll(`${action}:scroll`, dialog.locator('[data-index]').first().locator('../..'))
      const count = Number((await dialog.getByText(/^Найдено: [1-9]\d* · Выбрано: 0$/).innerText()).match(/Найдено: (\d+)/)![1])
      expect(count).toBeGreaterThan(0); expect(count).toBeLessThanOrEqual(100)
      await probe.measure(`${action}:select-${count}`, async () => { await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click(); await expect(dialog.getByText(`Найдено: ${count} · Выбрано: ${count}`, { exact: true })).toBeVisible() })
      expect(await dialog.locator('[data-index]').count()).toBeLessThan(100)
    }
    await page.goto('/journal')
    await probe.measure('dispatcher:open', async () => { await page.getByRole('button', { name: 'Открыть диспетчер', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })).toBeVisible() })
    const dispatcher = page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })
    await probe.scroll('dispatcher:queue-scroll', dispatcher.getByRole('region', { name: 'Очередь задач диспетчера', exact: true }))
  } finally { await probe.finish(); await page.close().catch(() => {}); await cleanupLineProgramProjects([officialityProject]) }
})
