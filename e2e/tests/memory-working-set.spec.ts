import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { observeMixedClient } from '../mixed-resource-telemetry'
import { editJournalJoint } from '../journal-grid'

const project = 'E2E ordinary latency'
test('ordinary journal, editor, line section and detail before/after memory optimization', async ({ page, context }) => {
  test.skip(process.env.AUDIT_ORDINARY_LATENCY !== '1', 'Isolated before/after measurement, same resource-limited image')
  const telemetry = observeMixedClient(context, 'ordinary')
  page.on('pageerror', error => telemetry.errors.push(error.message))
  const samples: Array<{ action: string; round: number; milliseconds: number }> = []
  try {
    await withLineProgramFixture(async db => {
      await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
        select $1,'LAT','LAT-'||lpad(n::text,2,'0'),'II','Б(а)',10,10 from generate_series(1,10) n`, [project])
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
        officiality,revision_actuality,connection_type,category,group_name,weld_control_percent,pvk_control_percent,
        has_vik,psto_required,stamp_1_k)
        select p.id,p.project_title,p.subtitle_code,p.line,'F'||n,'2026-09-01','действующий','актуальная','С17',
          p.category,p.group_name,10,10,'да','нет','LAT1'
        from line_programs p cross join generate_series(1,200) n where p.project_title=$1`, [project])
    })
    for (let round = 0; round < 4; round++) {
      let firstRowId: number | undefined
      const measure = async (action: string, run: () => Promise<void>) => {
        const start = performance.now()
        await run()
        samples.push({ action, round, milliseconds: Math.round(performance.now() - start) })
      }
      await measure('journal', async () => {
        await page.goto('/journal')
        const grid = page.locator('[data-welding-journal-grid]')
        await expect(grid.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
        const firstRow = grid.locator('.ag-grid-scrolling-rows .ag-row[row-id]').first()
        await expect(firstRow).toBeVisible()
        firstRowId = Number(await firstRow.getAttribute('row-id'))
        expect(firstRowId).toBeGreaterThan(0)
        await expect.poll(() => telemetry.pending.size).toBe(0)
      })
      await measure('editor', async () => {
        const started = performance.now(), requestsBefore = telemetry.calls.length
        await editJournalJoint(page, firstRowId)
        const clicked = performance.now()
        await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toBeVisible()
        console.log(JSON.stringify({ phase: 'ordinary editor timing', round,
          clickMilliseconds: Math.round(clicked - started), afterClickMilliseconds: Math.round(performance.now() - clicked),
          completedRpc: telemetry.calls.slice(requestsBefore) }))
      })
      await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click()
      await measure('program-section', async () => {
        await page.goto('/line-program')
        await expect(page.getByTestId('line-program-card').filter({ has: page.getByRole('button', { name: 'Расчёт линии LAT-01', exact: true }) })).toBeVisible()
        await expect.poll(() => telemetry.pending.size).toBe(0)
      })
      await measure('program-detail', async () => {
        const card = page.getByTestId('line-program-card').filter({ has: page.getByRole('button', { name: 'Расчёт линии LAT-01', exact: true }) })
        await card.getByRole('button', { name: 'Учитываемых соединений 200', exact: true }).click()
        const rows = page.locator('[data-testid="line-program-detail"][data-line="LAT-01"]').getByTestId('line-program-readonly-joint')
        await expect(rows.first()).toBeVisible(); expect(await rows.count()).toBeLessThanOrEqual(50)
      })
    }
    expect(telemetry.errors).toEqual([])
  } finally {
    console.log(JSON.stringify({ phase: 'ordinary latency', samples, rpc: await telemetry.summary() }))
    await cleanupLineProgramProjects([project])
  }
})
