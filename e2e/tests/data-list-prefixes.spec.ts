import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { DEFAULT_DATA_LIST_SETTINGS, type DataListSettings } from '../../src/lib/data-list-settings'

test('справочники: классы С/У и группы М проверяются в форме и на сервере, старые значения сохраняются', async ({ page, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Uses the production RPC manifest')
  const snapshot = await withE2eDatabase(async db => (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0])
  const stored = () => withE2eDatabase(async db => {
    const row = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
    return { value: row ? JSON.parse(row.value) as DataListSettings : DEFAULT_DATA_LIST_SETTINGS, revision: row?.updated_at.toISOString() ?? null }
  })
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  const save = async (value: DataListSettings, expectedUpdatedAt: string | null) => {
    const response = await page.request.post(siblingRpcUrl(observed, 'saveAppSetting_createServerFn_handler'), {
      data: await serializeRpcData({ key: 'data-list', value, expectedUpdatedAt }),
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    return await deserializeRpcResponse(await response.text()) as { result?: unknown; error?: Error }
  }
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Данные', exact: true }).click()
    const connections = page.getByRole('region', { name: 'Тип соединения', exact: true })
    const materials = page.getByRole('region', { name: 'Группа материалов', exact: true })
    await expect(connections.getByText(/Первая буква — кириллическая «С» или «У»/)).toBeVisible()
    await expect(materials.getByText(/Первая буква — только кириллическая «М»/)).toBeVisible()
    const initial = await stored()
    for (const [section, value] of [[connections, 'Т1'], [connections, 'C2'], [materials, 'Н01'], [materials, 'M02']] as const) {
      await section.getByLabel('Новое значение').fill(value)
      await expect(section.getByRole('button', { name: 'Добавить', exact: true })).toBeDisabled()
      await section.getByLabel('Новое значение').press('Enter')
      await expect(section.getByRole('button', { name: `Удалить ${value}`, exact: true })).toHaveCount(0)
    }
    expect(await stored()).toEqual(initial)
    for (const [section, key, value] of [
      [connections, 'connectionTypes', 'С2'], [connections, 'connectionTypes', 'У17'], [materials, 'materialGroups', 'М02'],
    ] as const) {
      await section.getByLabel('Новое значение').fill(value.toLowerCase())
      await section.getByRole('button', { name: 'Добавить', exact: true }).click()
      await expect.poll(async () => (await stored()).value[key]).toContain(value)
    }
    await page.reload()
    await page.getByRole('button', { name: 'Данные', exact: true }).click()
    await expect(connections.getByRole('button', { name: 'Удалить С2', exact: true })).toBeVisible()
    await expect(materials.getByRole('button', { name: 'Удалить М02', exact: true })).toBeVisible()

    const before = await stored()
    const auditCount = () => withE2eDatabase(async db => (await db.query('select count(*)::int as count from audit_operations')).rows[0].count)
    const countBefore = await auditCount()
    for (const [connection, material] of [['Т1', 'Н01'], ['C2', 'M02']]) {
      const result = await save({ ...before.value,
        connectionTypes: [...before.value.connectionTypes, 'С3', connection],
        materialGroups: [...before.value.materialGroups, 'М123', material],
      }, before.revision)
      expect(result.error?.message).toContain(connection)
      expect(result.error?.message).toContain(material)
      expect(await stored()).toEqual(before)
      expect(await auditCount()).toBe(countBefore)
    }
    expect((await save(before.value, initial.revision)).error?.message).toContain('изменена другим пользователем')

    // Model an older project on this disposable database; no automatic cleanup of its codes.
    const legacy = { ...before.value, connectionTypes: [...before.value.connectionTypes, 'ТШ'], materialGroups: [...before.value.materialGroups, 'Н01'] }
    await withE2eDatabase(db => db.query("update app_settings set value=$1,updated_at=updated_at+interval '1 millisecond' where key='data-list'", [JSON.stringify(legacy)]))
    await page.reload()
    await page.getByRole('button', { name: 'Данные', exact: true }).click()
    await expect(connections.getByRole('button', { name: 'Удалить ТШ', exact: true })).toBeVisible()
    await connections.getByLabel('Новое значение').fill('С3')
    await connections.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect.poll(stored).toMatchObject({ value: { ...legacy, connectionTypes: [...legacy.connectionTypes, 'С3'] } })
  } finally {
    await page.close()
    await withE2eDatabase(async db => {
      if (snapshot) await db.query("update app_settings set value=$1,updated_at=$2 where key='data-list'", [snapshot.value, snapshot.updated_at])
      else await db.query("delete from app_settings where key='data-list'")
      await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
    })
  }
})
