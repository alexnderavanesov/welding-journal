import { expect, test, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '../../src/lib/system-index-settings'

test('старый клиент не меняет буквы индексов при существующих стыках; отдельный буквенный префикс остаётся изменяемым', async ({ page }) => {
  const original = await withE2eDatabase(async db => {
    expect(Number((await db.query('select count(*) as n from weld_joints')).rows[0].n)).toBeGreaterThan(0)
    const prior = (await db.query("select * from app_settings where key='system-index'")).rows[0]
    await db.query(`insert into app_settings(key,value,updated_at) values ('system-index',$1,clock_timestamp())
      on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at`, [JSON.stringify(DEFAULT_SYSTEM_INDEX_SETTINGS)])
    return prior
  })
  const stored = () => withE2eDatabase(async db => (await db.query("select value,updated_at from app_settings where key='system-index'")).rows[0])
  const writes: Request[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('saveAppSetting_')) writes.push(request) })
  try {
    const before = await stored()
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Системные индексы', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Ремонт', exact: true })).toBeDisabled()
    await page.getByText('Разрешать буквенный индекс перед номером стыка', { exact: true }).click()
    await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).first().click()
    await expect.poll(() => writes.length).toBe(1)
    await expect.poll(async () => JSON.parse((await stored()).value).allowLeadingLetterIndex).toBe(true)
    const current = await stored(), request = writes[0], body = request.postData()!
    // Replay a real authenticated wire request, with a FRESH setting version:
    // this must be the business guard, not an optimistic-concurrency rejection.
    expect(body).toContain('"R"'); expect(body).toContain(before.updated_at.toISOString())
    const headers = await request.allHeaders(); delete headers['content-length']
    const response = await page.request.post(request.url(), { headers, data: body
      .replaceAll('"R"', '"Q"').replaceAll(before.updated_at.toISOString(), current.updated_at.toISOString()) })
    expect(await response.text()).toContain('Буквы системных индексов можно менять только пока в проекте нет стыков')
    expect(await stored()).toEqual(current)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await withE2eDatabase(async db => {
      await db.query("delete from app_settings where key='system-index'")
      if (original) await db.query('insert into app_settings(key,value,updated_at) values ($1,$2,$3)', [original.key, original.value, original.updated_at])
      await db.query('update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true where id=1')
    })
  }
})
