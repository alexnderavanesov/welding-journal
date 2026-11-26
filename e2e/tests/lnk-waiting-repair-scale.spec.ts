import { expect, test } from '@playwright/test'
import assert from 'node:assert/strict'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as XLSX from 'xlsx'
import { loadPendingRepairNames } from '@/server/lnk-waiting-repair-report'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { captureReportExcel } from '../report-excel-capture'

test('resolves pending named repairs and renamed coil pairs across 200000 joints in one query', async ({}, info) => {
  test.skip(process.env.LNK_REPAIR_SCALE !== '1', 'Отдельный локальный нагрузочный прогон')
  test.setTimeout(240_000)
  await withE2eDatabase(async client => {
    await client.query('begin')
    try {
      await client.query("set local statement_timeout = '120s'")
      const { rows: [{ base }] } = await client.query<{ base: number }>('select coalesce(max(id),0)+1 as base from weld_joints')
      await client.query(`insert into weld_joints (id, project_title,subtitle_code,line,joint,weld_date,revision_actuality)
        select $1::int+n,'Масштаб ремонта','П','L'||(n/100),'F'||n,
          case when n%100=4 or (n%100=1 and n/100%2=0) then null else date '2026-08-01' end,
          'актуальная' from generate_series(0,199999) n`, [base])
      await client.query(`insert into weld_joint_program_states (weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side)
        select $1::int+n,case when n%100=4 then 'repair' else 'coil' end,
          case when n%100=4 then $1+n-1 else $1+n end,
          case when n%100=4 then $1+n-1 else $1+n-n%100 end,
          case when n%100<>4 then $1+n-n%100 end,
          case when n%100<>4 then n%100 end
        from generate_series(0,199999) n where n%100 in (1,2,4)`, [base])
      await client.query('analyze weld_joints')
      await client.query('analyze weld_joint_program_states')
      const tasks = Array.from({ length: 2000 }, (_, line) => [
        { kind: 'create', row: { id: base + line * 100 } },
        { kind: 'create', row: { id: base + line * 100 + 5 } },
      ]).flat()
      const snapshot = { repeatedTasks: JSON.stringify({ tasks }) }
      let queries = 0
      const db = drizzle(client, { logger: { logQuery() { queries++ } } })
      const started = performance.now()
      const pending = await loadPendingRepairNames(db, snapshot)
      const elapsedMs = Math.round(performance.now() - started)
      expect(queries).toBe(1)
      expect(pending.size).toBe(5000)
      for (let n = 0; n < 200000; n += 100) {
        assert.equal(pending.get(base + n), n % 200 === 0 ? `F${n + 1}, F${n + 2}` : undefined)
        assert.equal(pending.get(base + n + 3), `F${n + 4}`)
        assert.equal(pending.get(base + n + 5), '-')
      }
      const measurement = JSON.stringify({ joints: 200000, assignments: pending.size, queries, elapsedMs })
      await info.attach('repair-resolution', { body: measurement, contentType: 'application/json' })
      console.log('repair-resolution', measurement)
    } finally {
      await client.query('rollback')
    }
  })
})

test('opens the foreman preview and downloads every repair assignment from a 200000-joint journal', async ({ page }, info) => {
  test.skip(process.env.LNK_REPAIR_SCALE !== '1', 'Отдельный локальный нагрузочный прогон')
  test.setTimeout(900_000)
  const project = 'E2E масштаб задания прорабу'
  try {
    await withLineProgramFixture(db => db.query(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,
        has_vik,vik_control_basis,vik_result,vik_conclusion_date,vik_conclusion)
      select $1,'А','L'||(n/100),case when n%100=22 then 'F'||(n-1)||'R1' else 'F'||n end,
        case when n%100<>22 then date '2026-09-01' end,'действующий','актуальная','С17',
        'да','проект',case n%100 when 21 then 'ремонт' when 22 then null else 'годен' end,
        case when n%100<>22 then date '2026-09-02' end,case when n%100<>22 then 'ВИК-'||n end
      from generate_series(0,199999) n`, [project]))
    const opened = performance.now()
    await page.goto('/lnk')
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    const requested = performance.now()
    await page.getByRole('button', { name: 'Ожидает ремонта', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
    await expect(preview.frameLocator('iframe').locator('tbody tr')).toHaveCount(100, { timeout: 360_000 })
    const ready = performance.now()
    const workbook = await captureReportExcel(page, preview)
    const downloaded = performance.now()
    const data = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['Ожидает ремонта'], { header: 1 })
    const assignments = data.filter(row => row[0] === project)
    expect(assignments).toHaveLength(2000)
    expect(new Set(assignments.map(row => row[6])).size).toBe(2000)
    for (const row of assignments) assert.equal(row[24], row[6] + 'R1')
    await preview.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
    await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
    const reopened = performance.now()
    await page.getByRole('button', { name: 'Ожидает ремонта', exact: true }).click()
    await expect(preview.frameLocator('iframe').locator('tbody tr')).toHaveCount(100, { timeout: 120_000 })
    const measurement = JSON.stringify({ assignments: assignments.length, openLnkMs: Math.round(requested - opened),
      previewMs: Math.round(ready - requested), downloadAndReadMs: Math.round(downloaded - ready),
      reopenMs: Math.round(performance.now() - reopened) })
    console.log('repair-browser', measurement)
    await info.attach('repair-browser', { body: measurement, contentType: 'application/json' })
  } finally {
    await cleanupLineProgramProjects([project])
  }
})
