import { expect, test } from '@playwright/test'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'

import { serializeDispatcherTaskIndexPayload } from '../../src/lib/dispatcher-task-index-payload'
import type { RepeatedJointTask } from '../../src/lib/dispatcher-types'
import { lockWeldJointWritesForDispatcherReplacement } from '../../src/server/dispatcher-task-index'
import { DISPATCHER_INDEX_LOCK_ID } from '../../src/server/dispatcher-task-index-constants'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query('delete from dispatcher_task_pages')
    await client.query(`
      update dispatcher_task_index_state
      set source_revision = source_revision + 1,
          repeated_tasks = '[]',
          full_rebuild = true,
          updated_at = now()
      where id = 1
    `)
  })
})

test('рабочее окно находит задачу № 5001 без технической пагинации', async ({ page }) => {
  test.setTimeout(120_000)
  await seedTaskPages()

  await page.goto('/lnk')
  const panel = page.getByLabel('Диспетчер задач', { exact: true })
  await expect(panel).toContainText('5001 задача')
  await expect(page.getByLabel('Страницы задач диспетчера')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
  const dialog = page.getByRole('dialog', { name: 'Диспетчер задач' })
  const queue = dialog.getByLabel('Очередь задач диспетчера')
  await expect.poll(() => queue.locator('[data-dispatcher-workspace-task-row]').count()).toBeLessThan(40)
  await expect(queue.locator('[data-dispatcher-workspace-task-details]').first()).toContainText('Тест постраничного доступа к карточкам.')
  await expect(queue.getByRole('button', { name: 'Показать' }).first()).toBeVisible()
  await expect(queue.getByRole('button', { name: 'Картина' }).first()).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill('Проверка задачи № 5001')
  await dialog.getByRole('button', { name: 'Найти' }).click()
  await expect(dialog).toContainText('Найдена 1 задача')
  await expect(queue.locator('[data-dispatcher-workspace-task-details]').first()).toContainText('Тест постраничного доступа к карточкам.')
  await expect(queue.locator('[data-dispatcher-workspace-task-row]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('повтор загрузки задач учитывает пересчет другого пользователя', async ({ page }) => {
  test.setTimeout(120_000)
  await seedTaskPages()

  await page.goto('/lnk')
  const panel = page.getByLabel('Диспетчер задач', { exact: true })
  await expect(panel).toContainText('5001 задача')

  await withE2eDatabase(async (client) => {
    await client.query(`
      update dispatcher_task_index_state
      set source_revision = source_revision + 1,
          computed_revision = source_revision + 1,
          computed_at = now(),
          updated_at = now()
      where id = 1
    `)
  })

  await panel.getByRole('button', { name: 'Загрузить ещё задачи (5000 из 5001)' }).click()
  const taskAlert = panel.getByRole('alert')
  await expect(taskAlert).toContainText('Расчет диспетчера изменился')
  await taskAlert.getByRole('button', { name: 'Повторить загрузку' }).click()
  await expect(taskAlert).toHaveCount(0)

  await panel.getByRole('button', { name: 'Загрузить ещё задачи (5000 из 5001)' }).click()
  await expect(panel.getByRole('button', { name: 'Загрузить ещё задачи (5000 из 5001)' })).toHaveCount(0)
})

test('повтор поиска получает новую версию после пересчета другим пользователем', async ({ page }) => {
  await seedTaskPages()
  await page.goto('/lnk')
  const panel = page.getByLabel('Диспетчер задач', { exact: true })
  await expect(panel).toContainText('5001 задача')
  await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
  const dialog = page.getByRole('dialog', { name: 'Диспетчер задач' })
  await withE2eDatabase(async (client) => {
    await client.query(`
      update dispatcher_task_index_state
      set source_revision = source_revision + 1,
          computed_revision = source_revision + 1,
          computed_at = now(), updated_at = now()
      where id = 1
    `)
  })
  await dialog.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill('Проверка задачи № 5001')
  await dialog.getByRole('button', { name: 'Найти' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Расчет диспетчера изменился')
  await dialog.getByRole('button', { name: 'Повторить поиск' }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog).toContainText('Найдена 1 задача')
  await expect(dialog.locator('[data-dispatcher-workspace-task-row]')).toHaveCount(1)
})

test('восемь задач двух линий видны в одном списке; его можно свернуть и открыть снова', async ({ page }) => {
  test.setTimeout(120_000)
  await seedSplitTaskScopes()

  await page.goto('/lnk')
  const panel = page.getByLabel('Диспетчер задач', { exact: true })
  await expect(panel).toContainText('8 задач')
  await expect(page.getByLabel('Страницы задач диспетчера')).toHaveCount(0)
  await panel.locator('details').first().locator('summary').click()
  await expect(panel.getByText('E2E-L1')).toBeVisible()
  await expect(panel.getByText('E2E-L2')).toBeVisible()
  await panel.getByRole('button', { name: 'Свернуть', exact: true }).click()
  await expect(panel.getByText('E2E-L1')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
  const dialog = page.getByRole('dialog', { name: 'Диспетчер задач' })
  await expect(dialog).toContainText('8 задач')
  const taskRow = dialog.getByLabel('Очередь задач диспетчера').locator('[data-dispatcher-workspace-task-row]').first()
  const restingColor = await taskRow.evaluate((element) => getComputedStyle(element).backgroundColor)
  await taskRow.hover()
  await expect.poll(() => taskRow.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(restingColor)
  const searchForm = dialog.getByRole('search', { name: 'Поиск задач' })
  await expect(searchForm).toHaveAttribute('data-expanded', 'false')
  await expect(dialog.getByRole('button', { name: 'Найти' })).toHaveCount(0)
  const search = dialog.getByRole('textbox', { name: 'Поиск задач диспетчера' })
  await search.fill('E2E-L2')
  await expect(searchForm).toHaveAttribute('data-expanded', 'true')
  await expect(dialog.getByRole('button', { name: 'Найти' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Все задачи' })).toBeVisible()
  await search.press('Enter')
  await expect(dialog).toContainText('Найдено 7 задач')
  await dialog.getByRole('button', { name: 'Очистить' }).click()
  await expect(dialog.getByRole('heading', { name: 'Все задачи' })).toBeVisible()
  const desktopViewport = page.viewportSize()
  await page.setViewportSize({ width: 420, height: 800 })
  await expect(searchForm).toBeVisible()
  await search.click()
  await expect(searchForm).toHaveAttribute('data-expanded', 'true')
  await expect(dialog.getByRole('button', { name: 'Найти' })).toBeVisible()
  await expect.poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThan(2)
  if (desktopViewport) await page.setViewportSize(desktopViewport)
  const details = dialog.getByLabel('Очередь задач диспетчера').locator('[data-dispatcher-workspace-task-details]').first()
  await expect(details).toContainText('Тест общего списка задач двух линий.')
  await dialog.getByLabel('Очередь задач диспетчера').getByRole('button', { name: 'Показать' }).first().click()
  await expect(dialog).toHaveCount(0)
  await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
  await expect(page.getByRole('dialog', { name: 'Диспетчер задач' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await panel.getByRole('button', { name: 'Развернуть', exact: true }).click()
  await expect(panel.getByText('ДЗ-27', { exact: true })).toBeVisible()
})

test('замена индекса ждёт удаление стыка до захвата блокировки диспетчера', async () => {
  test.setTimeout(120_000)
  const deletingClient = new pg.Client({ connectionString: E2E_DATABASE_URL })
  const refreshingClient = new pg.Client({ connectionString: E2E_DATABASE_URL })
  await Promise.all([deletingClient.connect(), refreshingClient.connect()])
  try {
    const [{ pid }] = (await refreshingClient.query<{ pid: number }>('select pg_backend_pid() as pid')).rows
    await deletingClient.query('begin')
    await deletingClient.query('delete from weld_joints where id = 1')
    await refreshingClient.query('begin')
    const lockAttempt = lockWeldJointWritesForDispatcherReplacement({
      execute: (statement) => {
        const query = new PgDialect().sqlToQuery(statement)
        return refreshingClient.query(query.sql, query.params)
      },
    } as never)

    await expect.poll(async () => {
      const result = await deletingClient.query<{ wait_event_type: string | null }>(
        'select wait_event_type from pg_stat_activity where pid = $1',
        [pid],
      )
      return result.rows[0]?.wait_event_type
    }).toBe('Lock')

    // A delete reaches this advisory lock before the refresh does; otherwise
    // their FK/index writes can wait on one another until PostgreSQL aborts one.
    await deletingClient.query('select pg_advisory_xact_lock($1)', [DISPATCHER_INDEX_LOCK_ID])
    await deletingClient.query('rollback')
    await lockAttempt
    await refreshingClient.query('select pg_advisory_xact_lock($1)', [DISPATCHER_INDEX_LOCK_ID])
  } finally {
    await Promise.allSettled([
      deletingClient.query('rollback'),
      refreshingClient.query('rollback'),
    ])
    await Promise.all([deletingClient.end(), refreshingClient.end()])
  }
})

async function seedTaskPages() {
  const tasks = Array.from({ length: 5_001 }, (_, index) => ({
    kind: 'line-consistency',
    key: `e2e-task-${index + 1}`,
    row: {
      id: 1,
      projectTitle: 'E2E проект',
      subtitleCode: 'E2E-001',
      line: 'E2E-L1',
      joint: 'F1',
    },
    line: 'E2E-L1',
    projectTitle: 'E2E проект',
    subtitleCode: 'E2E-001',
    fieldKey: 'controlPresence',
    fieldLabel: 'Назначение контроля',
    title: `Проверка задачи № ${index + 1}`,
    values: ['РК', 'УЗК'],
    details: 'Тест постраничного доступа к карточкам.',
  })) as RepeatedJointTask[]
  const payload = serializeDispatcherTaskIndexPayload(tasks.slice(0, 5_000), [], {
    totalTaskCount: tasks.length,
    totalPageCount: 51,
    tasksTruncated: true,
    taskFilterOptions: [],
  })
  const pages = Array.from({ length: 51 }, (_, index) =>
    tasks.slice(index * 100, (index + 1) * 100))

  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into dispatcher_task_index_state (
        id, source_revision, computed_revision, repeated_tasks,
        welder_stamp_expiry_tasks, duplicate_keys, dirty_scopes,
        full_rebuild, computed_at, updated_at
      ) values (1, 1, 1, $1, '[]', '[]', '[]', false, now(), now())
      on conflict (id) do update set
        source_revision = dispatcher_task_index_state.source_revision + 1,
        computed_revision = dispatcher_task_index_state.source_revision + 1,
        repeated_tasks = excluded.repeated_tasks,
        welder_stamp_expiry_tasks = '[]',
        duplicate_keys = '[]',
        dirty_scopes = '[]',
        full_rebuild = false,
        computed_at = now(),
        updated_at = now()
    `, [payload])
    await client.query('delete from dispatcher_task_pages')
    await client.query(`
      insert into dispatcher_task_pages (scope_key, page_number, task_count, tasks)
      select 'e2e-scope', page.ordinality::integer,
        jsonb_array_length(page.tasks)::integer, page.tasks::text
      from jsonb_array_elements($1::jsonb) with ordinality as page(tasks, ordinality)
    `, [JSON.stringify(pages)])
  })
}

async function seedSplitTaskScopes() {
  const tasks = Array.from({ length: 8 }, (_, index) => {
    const line = index === 0 ? 'E2E-L1' : 'E2E-L2'
    return {
      kind: 'line-consistency',
      key: `split-line-task-${index + 1}`,
      row: { id: 1, projectTitle: 'E2E проект', subtitleCode: 'E2E-001', line, joint: `F${index + 1}` },
      line,
      projectTitle: 'E2E проект',
      subtitleCode: 'E2E-001',
      fieldKey: 'controlPresence',
      fieldLabel: 'Назначение контроля',
      title: `Задача линии ${line} № ${index + 1}`,
      values: ['РК', 'УЗК'],
      details: 'Тест общего списка задач двух линий.',
    }
  }) as RepeatedJointTask[]
  const payload = serializeDispatcherTaskIndexPayload(tasks, [], {
    totalTaskCount: tasks.length,
    totalPageCount: 2,
    taskFilterOptions: [],
  })
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into dispatcher_task_index_state (
        id, source_revision, computed_revision, repeated_tasks,
        welder_stamp_expiry_tasks, duplicate_keys, dirty_scopes,
        full_rebuild, computed_at, updated_at
      ) values (1, 1, 1, $1, '[]', '[]', '[]', false, now(), now())
      on conflict (id) do update set
        source_revision = dispatcher_task_index_state.source_revision + 1,
        computed_revision = dispatcher_task_index_state.source_revision + 1,
        repeated_tasks = excluded.repeated_tasks,
        welder_stamp_expiry_tasks = '[]',
        duplicate_keys = '[]',
        dirty_scopes = '[]',
        full_rebuild = false,
        computed_at = now(),
        updated_at = now()
    `, [payload])
    await client.query('delete from dispatcher_task_pages')
    await client.query(`
      insert into dispatcher_task_pages (scope_key, page_number, task_count, tasks)
      values ('line-1', 1, 1, $1), ('line-2', 1, 7, $2)
    `, [JSON.stringify(tasks.slice(0, 1)), JSON.stringify(tasks.slice(1))])
  })
}
