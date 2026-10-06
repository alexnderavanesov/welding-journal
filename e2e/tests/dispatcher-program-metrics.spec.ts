import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { DEFAULT_DISPATCHER_SETTINGS } from '../../src/lib/dispatcher-settings'
import { DISPATCHER_TASK_CALCULATION_VERSION } from '../../src/lib/dispatcher-task-index-payload'
import type { PercentageLineControlTask } from '../../src/lib/dispatcher-types'

const project = 'E2E capped dispatcher metrics', line = 'CAPPED-METRICS'
let setting: { value: string; updated_at: Date } | undefined
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    if (setting) await db.query(`update app_settings set value=$1,updated_at=$2 where key='dispatcher'`, [setting.value, setting.updated_at])
    else await db.query(`delete from app_settings where key='dispatcher'`)
    await db.query(`update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true where id=1`)
  })
})

const storedTasks = () => withE2eDatabase(async db => (await db.query('select tasks from dispatcher_task_pages')).rows
  .flatMap(row => JSON.parse(row.tasks) as PercentageLineControlTask[])
  .filter(task => task.kind === 'percentage-line-control' && task.row.projectTitle === project && task.issue === 'missing'))

test('диспетчер и старый индекс: доступно 2 вместо нормы 5/3, ПВК 30% вместо общего 50%', async ({ page }) => {
  await withE2eDatabase(async db => {
    setting = (await db.query(`select value,updated_at from app_settings where key='dispatcher'`)).rows[0]
    await db.query(`insert into app_settings(key,value) values ('dispatcher',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify(DEFAULT_DISPATCHER_SETTINGS)])
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'METRICS',$2,'II','A',50,30) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      category,group_name,weld_control_percent,pvk_control_percent,has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,stamp_1_k,officiality)
      select $1,$2,'METRICS',$3,'F'||(n+800),'2026-09-01','С17','II','A',50,30,'да',
      case when n<=8 then 'ремонт' else 'годен' end,'METRICS-VIK-R','2026-09-01','METRICS-VIK-C','2026-09-02','METRICS-A','действующий'
      from generate_series(1,10) n`, [program.id, project, line])
    await db.query(`insert into dispatcher_task_index_state(id,source_revision,computed_revision,full_rebuild)
      values (1,1,-1,true) on conflict(id) do update set source_revision=dispatcher_task_index_state.source_revision+1,full_rebuild=true`)
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await expect.poll(async () => (await storedTasks()).length).toBe(2)
  for (const task of await storedTasks()) expect(task).toMatchObject({ requiredControls: 2, count: 2 })

  // Simulate an already stored old calculation, without changing welds or
  // marking any scope dirty. The calculation version must force its rebuild.
  await page.waitForLoadState('networkidle')
  await withE2eDatabase(async db => {
    const state = (await db.query('select repeated_tasks,source_revision,computed_revision from dispatcher_task_index_state where id=1')).rows[0]
    expect(state.computed_revision).toBe(state.source_revision)
    const payload = JSON.parse(state.repeated_tasks)
    payload.version = DISPATCHER_TASK_CALCULATION_VERSION - 1
    await db.query('update dispatcher_task_index_state set repeated_tasks=$1 where id=1', [JSON.stringify(payload)])
    for (const stored of (await db.query('select scope_key,page_number,tasks from dispatcher_task_pages')).rows) {
      const tasks = JSON.parse(stored.tasks) as PercentageLineControlTask[]
      for (const task of tasks) if (task.kind === 'percentage-line-control' && task.row.projectTitle === project) {
        task.requiredControls = task.demandKind === 'pvk' ? 3 : 5
      }
      await db.query('update dispatcher_task_pages set tasks=$1 where scope_key=$2 and page_number=$3', [JSON.stringify(tasks), stored.scope_key, stored.page_number])
    }
  })
  await page.reload()
  await expect.poll(async () => (await storedTasks()).map(task => task.requiredControls)).toEqual([2, 2])
  await page.getByLabel('Диспетчер задач', { exact: true }).getByRole('button', { name: 'Открыть диспетчер' }).click()
  const dialog = page.getByRole('dialog', { name: 'Диспетчер задач' })
  await dialog.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill(line)
  await dialog.getByRole('button', { name: 'Найти' }).click()
  const pvk = dialog.locator('[data-dispatcher-task-details]').filter({ hasText: 'ПВК 30%' })
  await expect(pvk).toHaveCount(1)
  await expect(pvk.getByText('Требуется').locator('..')).toHaveText('Требуется2')
  await expect(pvk.getByText('Контроль').locator('..')).toHaveText('Контроль30%')
  expect(errors).toEqual([])
})
