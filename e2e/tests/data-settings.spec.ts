import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

const key = 'data-list'
let snapshot: { value: string; updated_at: Date } | undefined
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    snapshot = (await db.query('select value,updated_at from app_settings where key=$1', [key])).rows[0]
    await db.query(`insert into app_settings(key,value) values ($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()`,
      [key, JSON.stringify({ weldingTypes: ['МП'], connectionTypes: ['ТШ'], materialGroups: ['М02'], testTypes: ['ГИ', 'ПИ'] })])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await withE2eDatabase(async db => {
    if (snapshot) await db.query('update app_settings set value=$2,updated_at=$3 where key=$1', [key, snapshot.value, snapshot.updated_at])
    else await db.query('delete from app_settings where key=$1', [key])
  })
})
const stored = () => withE2eDatabase(async db => JSON.parse((await db.query('select value from app_settings where key=$1', [key])).rows[0].value))

test('системные значения, дополнительные списки и ровные кнопки во всём разделе данных', async ({ page }) => {
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Данные', exact: true }).click()
  const expected = [['Способ сварки', ['РАД', 'РД'], 'МП'], ['Тип соединения', ['С17', 'У19'], 'ТШ'], ['Группа материалов', ['М01', 'М05', 'М11'], 'М02'], ['Вид испытаний', [], 'ГИ']] as const
  for (const [name, system, custom] of expected) {
    const section = page.getByRole('region', { name, exact: true })
    await expect(section.getByRole('button', { name: `Удалить ${custom}`, exact: true })).toBeVisible()
    for (const value of system) {
      await expect(section.getByText(value, { exact: true })).toBeVisible()
      await expect(section.getByRole('button', { name: `Удалить ${value}`, exact: true })).toHaveCount(0)
    }
    await expect(section.getByRole('button', { name: /Очистить|Вернуть/ })).toHaveCount(0)
    const input = section.getByLabel('Новое значение', { exact: true })
    await input.scrollIntoViewIfNeeded()
    const inputBox = await input.boundingBox(), buttonBox = await section.getByRole('button', { name: 'Добавить' }).boundingBox()
    expect(Math.abs(inputBox!.y - buttonBox!.y)).toBeLessThanOrEqual(1)
    expect(inputBox!.height).toBe(buttonBox!.height)
  }
  expect(calls.filter(call => call.startsWith('saveAppSetting_'))).toHaveLength(0)
  expect((await stored()).connectionTypes).toEqual(['ТШ']) // Reading old settings must not write to the database.
  const material = page.getByRole('region', { name: 'Группа материалов', exact: true })
  await material.getByLabel('Новое значение', { exact: true }).fill('M02')
  await expect(material.getByRole('button', { name: 'Добавить' })).toBeDisabled()
  await material.getByLabel('Новое значение', { exact: true }).fill('М03')
  await material.getByRole('button', { name: 'Добавить' }).click()
  await expect.poll(async () => (await stored()).materialGroups).toEqual(['М01', 'М05', 'М11', 'М02', 'М03'])
  await material.getByRole('button', { name: 'Удалить М03', exact: true }).click()
  await expect.poll(async () => (await stored()).materialGroups).toEqual(['М01', 'М05', 'М11', 'М02'])
  await page.getByRole('region', { name: 'Вид испытаний', exact: true }).getByRole('button', { name: 'Удалить ГИ', exact: true }).click()
  await expect.poll(async () => (await stored()).testTypes).toEqual(['ПИ'])
  expect(calls.filter(call => call.startsWith('saveAppSetting_'))).toHaveLength(3)
  expect(calls.filter(call => call.startsWith('getWeldDataUsageSummary_'))).toHaveLength(1)
  await page.setViewportSize({ width: 1100, height: 800 })
  await material.screenshot({ path: '/private/tmp/welding-data-settings.png' })
  await page.setViewportSize({ width: 768, height: 900 })
  for (const [name] of expected) await expect.poll(() => page.getByRole('region', { name, exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('сервер сохраняет системные значения даже при прямой попытке убрать их из настройки', async ({ page }) => {
  const revision = await withE2eDatabase(async db => (await db.query('select updated_at from app_settings where key=$1', [key])).rows[0].updated_at.toISOString())
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Данные', exact: true }).click()
  const material = page.getByRole('region', { name: 'Группа материалов', exact: true })
  await material.getByLabel('Новое значение', { exact: true }).fill('М03')
  const write = page.waitForRequest(request => request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('saveAppSetting_'))
  await material.getByRole('button', { name: 'Добавить' }).click()
  const request = await write
  await expect.poll(async () => (await stored()).materialGroups).toContain('М03')
  const nextRevision = await withE2eDatabase(async db => (await db.query('select updated_at from app_settings where key=$1', [key])).rows[0].updated_at.toISOString())
  let body = request.postData()!
  expect(body).toContain(revision)
  // Replay a real wire request with the current version, omitting the fixed
  // codes by replacing them with already-present custom values. The server,
  // not the browser normalizer or stale-version guard, must restore the codes.
  for (const [system, custom] of [['РАД', 'МП'], ['РД', 'МП'], ['С17', 'ТШ'], ['У19', 'ТШ'], ['М01', 'М02'], ['М05', 'М02'], ['М11', 'М02']]) {
    expect(body).toContain(`"${system}"`)
    body = body.replaceAll(`"${system}"`, `"${custom}"`)
  }
  body = body.replaceAll(revision, nextRevision)
  const headers = await request.allHeaders(); delete headers['content-length']
  const response = await page.request.post(request.url(), { headers, data: body })
  expect(response.ok()).toBe(true)
  const expected = { weldingTypes: ['РАД', 'РД', 'МП'], connectionTypes: ['С17', 'У19', 'ТШ'], materialGroups: ['М01', 'М05', 'М11', 'М02', 'М03'], testTypes: ['ГИ', 'ПИ'] }
  expect(await stored()).toEqual(expected)
})
