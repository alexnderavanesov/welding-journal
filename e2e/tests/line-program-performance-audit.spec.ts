import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

test.use({ trace: 'off', video: 'off' })

for (const count of [50, 100, 500]) test(`${count} joints: assignment opening, independent selection, history and retained memory`, async ({ browser }, info) => {
  test.skip(!process.env.AUDIT_PROGRAM_LABEL, 'Opt-in comparison on the local production build')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  test.setTimeout(300_000)
  const project = `E2E program performance ${count}`, line = `AUDIT-GRID-${count}`
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'PERF',$2,'II','Б(а)',10,10) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,stamp_1_k,stamp_1_z,stamp_1_o,has_vik,vik_result,
      vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,psto_required,psto_result,psto_date,heat_treatment_diagram)
      select $1,$2,'PERF',$3,'F'||lpad(n::text,4,'0'),'2026-09-01','действующий','актуальная','С17',
        'AUDIT-A','AUDIT-B','AUDIT-C','да','годен','AUDIT-VIK','2026-09-03','AUDIT-VIK-C','2026-09-03',
        'да','проведено','2026-09-02','AUDIT-PSTO' from generate_series(1,$4::int) n`, [program.id, project, line, count])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,conclusion_name,conclusion_date,result)
      select id,m,'AUDIT-PRE','2026-09-01','AUDIT-PRE-'||m,'2026-09-01','годен'
      from weld_joints cross join unnest(array['ВИК','РК','УЗК','ПВК']) m where project_title=$1`, [project])
  })
  const samples: unknown[] = [], retained: unknown[] = [], errors: string[] = []
  const paint = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  try {
    for (let cold = 0; cold < 3; cold++) {
      const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } })
      try {
        const page = await context.newPage(), calls: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
        const cdp = browser.browserType().name() === 'chromium' ? await context.newCDPSession(page) : null
        await cdp?.send('Performance.enable')
        const metrics = async () => Object.fromEntries((await cdp?.send('Performance.getMetrics'))?.metrics.map(item => [item.name, item.value]) ?? [])
        const measure = async (action: string, round: number, run: () => Promise<void>) => {
          const before = await metrics(), requestStart = calls.length, start = performance.now()
          await run(); await paint(page)
          const milliseconds = performance.now() - start, after = await metrics()
          samples.push({ action, cold, round, milliseconds, requests: calls.slice(requestStart),
            scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
            layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
            styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
            domNodes: await page.locator('*').count() })
        }
        await measure('cold-section-and-details', cold, async () => {
          await page.goto('/line-program')
          await page.getByLabel('Поиск программы линий').fill(line)
          await page.getByTestId('line-program-card').getByRole('button', { name: `Учитываемых соединений ${count}`, exact: true }).click()
          await expect(page.getByTestId('line-program-readonly-joint').first()).toBeVisible()
        })
        const open = page.getByTestId('line-program-detail').getByTestId('program-scope-actions').getByRole('button', { name: /^Назначения/ })
        const editor = page.getByRole('dialog', { name: /^Назначения ·/ })
        const openEditor = async () => {
          await open.click()
          await expect(editor.getByRole('checkbox', { name: 'Выбрать F0001', exact: true })).toBeVisible()
        }
        const closeEditor = async () => {
          await editor.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
          await expect(editor).toBeHidden()
        }
        await measure('cold-assignment-open', cold, openEditor)
        await closeEditor()
        if (cold === 2) {
          const initialRequests = calls.length
          for (let round = 0; round < 50; round++) {
            if (round < 20) await measure('warm-assignment-open', round, openEditor)
            else await openEditor()
            if (round < 20) {
              const checkbox = editor.getByRole('checkbox', { name: 'Выбрать F0001', exact: true })
              await measure('selection', round, async () => { await checkbox.setChecked(round % 2 === 0) })
              const select = editor.getByRole('combobox', { name: 'F0001 · РК', exact: true })
              await measure('draft-assignment', round, async () => { await select.selectOption(round % 2 === 0 ? 'да' : 'дополнительный') })
              const summary = editor.getByTestId('line-program-joint').first().locator('summary')
              await measure('history-open', round, async () => {
                await summary.click()
                await expect(editor.getByLabel('Результат F0001', { exact: true })).toBeVisible()
              })
              await summary.click()
            }
            await closeEditor()
            if (cdp && [0, 9, 19, 49].includes(round)) {
              await cdp.send('HeapProfiler.collectGarbage')
              retained.push({ round, ...(await cdp.send('Runtime.getHeapUsage')), ...(await cdp.send('Memory.getDOMCounters')) })
            }
          }
          expect(calls.slice(initialRequests)).toEqual([])
          await openEditor()
          await expect(editor.getByRole('combobox', { name: 'F0001 · РК', exact: true })).toHaveValue('дополнительный')
          await closeEditor()
        }
        await cdp?.detach()
      } finally { await context.close() }
    }
    expect(errors).toEqual([])
    const result = { count, browser: browser.browserType().name(), version: browser.version(), cpuThrottling: 'none', samples, retained }
    await writeFile(info.outputPath(`program-${process.env.AUDIT_PROGRAM_LABEL}-${count}.json`), JSON.stringify(result, null, 2))
    console.log('PROGRAM_AUDIT', JSON.stringify(result))
  } finally { await cleanupLineProgramProjects([project]) }
})
