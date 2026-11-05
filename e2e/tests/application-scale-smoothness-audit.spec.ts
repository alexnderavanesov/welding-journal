import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { sampleLocalAuditResources } from '../audit-resources'
import { createSmoothnessProbe } from '../smoothness-probe'
import { withLineProgramFixture } from '../line-program-fixtures'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'

const enabled = process.env.SMOOTHNESS_SCALE === '1'
test.skip(!enabled, 'Explicit isolated 200000-joint performance profile')
test.use({ trace: 'off', video: 'off', actionTimeout: 20000 })

test('scale: 200000 joints across reports, program details and every statistics tab', async ({ page, browser }, info) => {
  test.setTimeout(900000)
  const probe = await createSmoothnessProbe(page, info)
  let stopResources: Awaited<ReturnType<typeof sampleLocalAuditResources>> | undefined
  try {
    await seedSmoothnessFixture()
    await withLineProgramFixture(async db => {
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,
        welding_method,material_group,d1,d2,t1,t2,weld_length,wdi,stamp_1_k,stamp_1_k_fact,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,psto_required)
        select p.id,p.project_title,p.subtitle_code,p.line,case when n%5=0 then 'ОП' else 'F' end||lpad(n::text,4,'0'),date '2026-10-01'+(n%28),
        case when n%5=0 then 'Т1' else 'С17' end,'действующий','актуальная','РД','М01',108,108,4,4,
        case when n%5=0 then 600.123 end,case when n%5<>0 then 0.42 end,'Q'||lpad((n%1000)::text,3,'0'),'Q'||lpad((n%1000)::text,3,'0'),
        'да','SM-SCALE-V-'||p.line,'2026-10-01','годен','SM-SCALE-C-'||p.line,'2026-10-02','нет'
        from line_programs p cross join generate_series(101,4000) n where p.project_title=$1`, [SMOOTHNESS_PROJECT])
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where project_title=$1 on conflict(weld_joint_id) do nothing`, [SMOOTHNESS_PROJECT])
      expect((await db.query('select count(*)::int n from weld_joints where project_title=$1', [SMOOTHNESS_PROJECT])).rows[0].n).toBe(200000)
      await db.query('analyze weld_joints'); await db.query('analyze weld_joint_program_states')
    })
    stopResources = await sampleLocalAuditResources(browser)
    for (let n = 0; n < 2; n++) for (const route of ['journal', 'lnk', 'psto']) {
      await probe.measure(`scale:${route}:open:${n}`, async () => { await page.goto(`/${route}`); await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 240000 }); await expect(page.locator('.journal-grid-frame .ag-row').first()).toBeVisible() })
      if (n === 0) { await probe.scroll(`scale:${route}:scroll`, page.locator('.journal-grid-frame')); await probe.resize(`scale:${route}:resize`, page.locator('.journal-grid-frame'), 'line') }
    }
    await probe.measure('scale:program:open', async () => { await page.goto('/line-program'); await expect(page.locator('[data-program-grid="lines"] .ag-row').first()).toBeVisible({ timeout: 120000 }) })
    await page.getByLabel('Поиск программы линий', { exact: true }).fill('SM-0001')
    await probe.measure('scale:program:detail-4000', async () => { await page.getByRole('button', { name: 'Расчёт линии SM-0001', exact: true }).click(); await expect(page.locator('[data-program-grid="stamps"] .ag-row').first()).toBeVisible({ timeout: 120000 }) })
    await probe.scroll('scale:program:stamps-scroll', page.locator('[data-program-grid="stamps"]'))
    await probe.measure('scale:program:assignments-4000', async () => { await page.getByRole('button', { name: 'Открыть назначения линии SM-0001', exact: true }).click(); await expect(page.locator('[data-program-grid="assignments"] .ag-row').first()).toBeVisible({ timeout: 120000 }) })
    await probe.scroll('scale:program:assignment-scroll', page.locator('[data-program-grid="assignments"]'))
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    for (const label of ['Общая', 'ЛНК', 'ПСТО', 'Опоры', 'Сварщики', 'Полинейная сводка']) {
      await probe.measure(`scale:statistics:${label}`, async () => {
        await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
        if (label !== 'Полинейная сводка') await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
        await expect(page.getByRole('button', { name: 'Отчет PDF', exact: true })).toBeEnabled({ timeout: 120000 })
      })
      const grid = page.getByRole('main').getByRole('grid').last()
      if (await grid.count()) await probe.scroll(`scale:statistics:${label}:scroll`, grid)
    }
  } finally {
    if (stopResources) await writeFile(info.outputPath('resources.json'), JSON.stringify(await stopResources(), null, 2))
    await probe.finish(); await page.close(); await cleanupSmoothnessFixture()
  }
})
