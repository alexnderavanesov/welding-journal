import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl, rpcName } from '../rpc'
import { DEFAULT_DATA_LIST_SETTINGS } from '../../src/lib/data-list-settings'

const project = 'E2E connection type removal'
let snapshot: { value: string; updated_at: Date } | undefined
const stored = () => withE2eDatabase(async db => {
  const row = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
  return { value: JSON.parse(row.value), revision: row.updated_at.toISOString() }
})
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    snapshot = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
    await db.query("insert into app_settings(key,value) values('data-list',$1) on conflict(key) do update set value=excluded.value,updated_at=now()", [JSON.stringify(DEFAULT_DATA_LIST_SETTINGS)])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await withE2eDatabase(async db => {
    await db.query('delete from weld_joints where project_title=$1', [project])
    if (snapshot) await db.query("update app_settings set value=$1,updated_at=$2 where key='data-list'", [snapshot.value, snapshot.updated_at])
    else await db.query("delete from app_settings where key='data-list'")
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
  })
})

test('С/У/Т: удаление всех неиспользуемых типов сохраняется после обновления; Т4 доступен как опора', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Данные', exact: true }).click()
  const section = page.getByRole('region', { name: 'Тип соединения', exact: true })
  await expect(page.getByText('Системное', { exact: true })).toHaveCount(0)
  for (const type of DEFAULT_DATA_LIST_SETTINGS.connectionTypes) {
    await section.getByRole('button', { name: `Удалить ${type}`, exact: true }).click()
    await expect.poll(async () => (await stored()).value.connectionTypes).not.toContain(type)
  }
  await page.reload()
  await page.getByRole('button', { name: 'Данные', exact: true }).click()
  await expect(section.getByText('Список пуст.', { exact: false })).toBeVisible()
  for (const type of ['С2', 'У2', 'Т4']) {
    await section.getByLabel('Новое значение', { exact: true }).fill(type)
    await section.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect.poll(async () => (await stored()).value.connectionTypes).toContain(type)
  }
  await page.reload()
  await page.getByRole('button', { name: 'Данные', exact: true }).click()
  expect((await stored()).value.connectionTypes).toEqual(['С2', 'У2', 'Т4'])
  await expect(section.getByRole('button', { name: 'Удалить Т4', exact: true })).toBeVisible()
  await section.screenshot({ path: 'outputs/connection-types-removable.png' })
})

test('используемый тип защищён на сервере при устаревшем счётчике, прямом запросе и конкурентном создании', async ({ page, baseURL }) => {
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('listAppSettingsSnapshot_')) observed = request.url() })
  const save = async (value: unknown, revision: string) => {
    const response = await page.request.post(siblingRpcUrl(observed, 'saveAppSetting_createServerFn_handler'), {
      data: await serializeRpcData({ key: 'data-list', value, expectedUpdatedAt: revision }),
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    return await deserializeRpcResponse(await response.text()) as { result?: unknown; error?: Error }
  }
  await page.goto('/settings')
  const usage = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('getWeldDataUsageSummary_'))
  await page.getByRole('button', { name: 'Данные', exact: true }).click()
  await usage
  const section = page.getByRole('region', { name: 'Тип соединения', exact: true })
  await expect(section.getByText('стыков:', { exact: false })).toHaveCount(0)
  // The open page still has a zero count. Historical/unofficial records count too.
  await withE2eDatabase(async db => {
    // Historical spelling must not bypass usage protection: the settings list
    // and JS validation normalize Unicode whitespace and old Cyrillic letters.
    for (const type of ['\u00a0\u1c8317\ufeff', '\tу19\n', '\u2007\u1c851\u202f']) await db.query("insert into weld_joints(project_title,joint,connection_type,officiality,revision_actuality) values($1,$2,$3,'неофициальный','неактуальная')", [project, type, type])
  })
  const before = await stored()
  await section.getByRole('button', { name: 'Удалить Т1', exact: true }).click()
  await expect(page.getByText(/Нельзя удалить тип соединения «Т1»/)).toBeVisible()
  await expect(section.getByRole('button', { name: 'Удалить Т1', exact: true })).toBeVisible()
  expect(await stored()).toEqual(before)
  for (const type of ['С17', 'У19', 'Т1']) {
    const result = await save({ ...before.value, connectionTypes: before.value.connectionTypes.filter((v: string) => v !== type) }, before.revision)
    expect(result.error?.message).toContain(`«${type}»`)
    expect(await stored()).toEqual(before)
  }
  // T1 does not prevent removing a different T code.
  const removed = { ...before.value, connectionTypes: before.value.connectionTypes.filter((v: string) => v !== 'Т') }
  expect((await save(removed, before.revision)).error).toBeUndefined()
  const current = await stored()
  expect(current.value).toEqual(removed)
  expect((await save(before.value, before.revision)).error?.message).toContain('изменена другим пользователем')
  await withE2eDatabase(async db => {
    await db.query('begin')
    let committed = false
    try {
      await db.query("select pg_advisory_xact_lock_shared(hashtext('weld-validation-settings'))")
      await db.query('insert into weld_joints(project_title,joint,connection_type) values($1,$2,$3)', [project, 'ОП-RACE', 'Т3'])
      const pending = save({ ...current.value, connectionTypes: current.value.connectionTypes.filter((v: string) => v !== 'Т3') }, current.revision)
      await expect.poll(() => withE2eDatabase(async check => Number((await check.query("select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() and l.locktype='advisory' and not l.granted")).rows[0].count))).toBeGreaterThan(0)
      await db.query('commit')
      committed = true
      expect((await pending).error?.message).toContain('«Т3»')
      expect(await stored()).toEqual(current)
    } finally { if (!committed) await db.query('rollback') }
  })
})
