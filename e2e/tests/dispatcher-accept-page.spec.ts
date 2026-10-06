import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { getDispatcherScopeKey } from '../../src/server/dispatcher-task-index'
import { serializeDispatcherTaskIndexPayload } from '../../src/lib/dispatcher-task-index-payload'
import type { RepeatedJointTask } from '../../src/lib/dispatcher-types'

const project = 'E2E accepted page'
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from dispatcher_task_pages')
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,repeated_tasks='[]' where id=1")
  })
})

test('принимает исключение из карточки 5001, а не только находит её', async ({ page }) => {
  const key = 'e2e-paged-accept-5001', title = 'Согласовать задачу 5001'
  const lineId = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query("insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ($1,'PAGE','PAGE-5001','II','A',30,10) returning id", [project])
    const { rows: [joint] } = await db.query("insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint) values ($1,$2,'PAGE','PAGE-5001','F1') returning id", [line.id, project])
    const row = { id: joint.id, projectTitle: project, subtitleCode: 'PAGE', line: 'PAGE-5001', joint: 'F1' }
    const tasks: RepeatedJointTask[] = Array.from({ length: 5000 }, (_, index) => ({ kind: 'line-consistency', key: `e2e-paged-check-${index}`, row, projectTitle: project, subtitleCode: 'PAGE', line: row.line, fieldKey: 'controlPresence', fieldLabel: 'Контроль', values: ['РК', 'УЗК'], title: `Проверка ${index}`, details: 'Проверка сохранённых страниц.' }))
    tasks.push({ kind: 'percentage-line-control', issue: 'excess', key, title, row, projectTitle: project, subtitleCode: 'PAGE', line: row.line, stamp: '', details: 'Подтверждение сохранённой задачи вне краткого снимка.', requiredControls: 1, coveredControls: 2, assignedControls: 2, count: 1 })
    const payload = serializeDispatcherTaskIndexPayload(tasks.slice(0, 5000), [], { totalTaskCount: 5001, totalPageCount: 51, tasksTruncated: true, taskFilterOptions: [] })
    await db.query(`insert into dispatcher_task_index_state(id,source_revision,computed_revision,repeated_tasks,welder_stamp_expiry_tasks,duplicate_keys,dirty_scopes,full_rebuild,computed_at,updated_at)
      values(1,1,1,$1,'[]','[]','[]',false,now(),now()) on conflict(id) do update set source_revision=dispatcher_task_index_state.source_revision+1,computed_revision=dispatcher_task_index_state.source_revision+1,repeated_tasks=excluded.repeated_tasks,welder_stamp_expiry_tasks='[]',duplicate_keys='[]',dirty_scopes='[]',full_rebuild=false,computed_at=now(),updated_at=now()`, [payload])
    await db.query('delete from dispatcher_task_pages')
    const pages = Array.from({ length: 51 }, (_, index) => tasks.slice(index * 100, (index + 1) * 100))
    await db.query(`insert into dispatcher_task_pages(scope_key,page_number,task_count,tasks)
      select $1,page.ordinality::int,jsonb_array_length(page.tasks),page.tasks::text from jsonb_array_elements($2::jsonb) with ordinality as page(tasks,ordinality)`, [getDispatcherScopeKey(row), JSON.stringify(pages)])
    return line.id
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/lnk')
  await page.getByLabel('Диспетчер задач', { exact: true }).getByRole('button', { name: 'Открыть диспетчер' }).click()
  const workspace = page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })
  await workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill(title)
  await workspace.getByRole('button', { name: 'Найти', exact: true }).click()
  await expect(workspace).toContainText('Найдена 1 задача')
  await workspace.getByRole('button', { name: 'Принять', exact: true }).click()
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Принять предупреждение', exact: true }) }).getByRole('button', { name: 'Принять', exact: true }).click()
  await expect.poll(() => withE2eDatabase(async db => (await db.query('select line_program_id from dispatcher_accepted_warnings where key=$1', [key])).rows)).toEqual([{ line_program_id: lineId }])
  // PostgreSQL preserves microseconds; JS Date only preserves milliseconds.
  // Cancellation must compare the exact database version, not a rounded date.
  await withE2eDatabase(db => db.query("update dispatcher_accepted_warnings set accepted_at='2026-09-29 10:00:00.123456+00' where key=$1", [key]))
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Принятые исключения', exact: true }).click()
  const settings = page.locator('#settings-panel-acceptedWarnings')
  await expect(settings.getByText(title, { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'Отменить', exact: true }).click()
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /Отменить принятое исключение/ }) }).getByRole('button', { name: 'Отменить исключение', exact: true }).click()
  await expect.poll(() => withE2eDatabase(async db => (await db.query('select key from dispatcher_accepted_warnings where key=$1', [key])).rows)).toEqual([])
  expect(errors).toEqual([])
})
