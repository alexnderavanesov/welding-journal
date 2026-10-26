import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E grid keyboard overlap'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('auto-height PageDown and PageUp cannot undo a newer keyboard destination', async ({ page }) => {
  const line = 'KEYBOARD-OVERLAP'
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'GRID',$2,'II','A',100,10) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,stamp_1_k,has_vik,vik_result)
      select $1,$2,'GRID',$3,'F'||n,'2026-09-01','действующий','актуальная','С17','KEYBOARD-A','да','годен'
      from generate_series(1,100) n`, [program.id, project, line])
  })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(line)
  await page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true }).click()
  await page.getByRole('button', { name: 'Клеймо KEYBOARD-A', exact: true }).click()
  const grid = page.getByRole('region', { name: `Стыки клейма KEYBOARD-A · ${line}`, exact: true })
  const first = grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="joint"]')
  await expect(first).toBeVisible()
  await first.focus()

  for (const keys of [['PageDown', 'End'], ['PageUp', 'Home'], ['PageDown', 'End', 'Home']]) {
    const observed = await page.evaluate(async keys => {
      const focused = () => document.activeElement?.closest('.ag-row')?.getAttribute('row-index')
      const started = performance.now()
      // Dispatch in the same browser turn: transport latency must not turn this
      // regression into the already-covered sequential keyboard scenario.
      for (const key of keys) document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      const immediate = focused()
      const dispatchMilliseconds = performance.now() - started
      // Observe beyond the library's 50 ms auto-height completion, not merely
      // the initially correct focus before the stale callback fires.
      await new Promise(resolve => setTimeout(resolve, 160))
      const box = document.activeElement!.getBoundingClientRect()
      return { keys, immediate, settled: focused(), dispatchMilliseconds, visible: box.top >= 72 && box.bottom <= innerHeight }
    }, keys)
    console.log(JSON.stringify({ phase: 'keyboard overlap', ...observed }))
    const destination = keys.at(-1) === 'End' ? '99' : '0'
    expect(observed.settled).toBe(destination)
    await expect.poll(() => page.evaluate(destination => {
      const cell = document.activeElement!
      const box = cell.getBoundingClientRect()
      return { row: cell.closest('.ag-row')?.getAttribute('row-index'), visible: box.top >= 72 && box.bottom <= innerHeight }
    }, destination), { timeout: 2000, intervals: [50] }).toEqual({ row: destination, visible: true })
  }
})
