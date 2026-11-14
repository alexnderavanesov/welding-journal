import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { completeAccountLink, inviteAccount } from '../../src/server/account-management'
import { DEFAULT_OTHER_SETTINGS } from '../../src/lib/other-settings'
import type { Permission } from '../../src/lib/access-permissions'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { asE2eOwner } from '../with-owner-access'

test.beforeEach(resetE2eAccountFixtureLimits)
const rkTable = { fileName: 'Audit RK', uploadedAt: '', entries: [{ diameter: 57, options: [{ label: '1 / 2', values: ['1', '2'], isDefault: true, note: '' }] }] }
const cases = [
  { name: 'process editor saves its RK table without WDI rights', areas: ['processes'], before: DEFAULT_OTHER_SETTINGS, after: { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: rkTable }, allowed: true },
  { name: 'WDI editor cannot change the RK table', areas: ['wdi'], before: DEFAULT_OTHER_SETTINGS, after: { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula', rkExposureTable: rkTable }, allowed: false },
  { name: 'WDI editor cannot change the legacy DLS check', areas: ['wdi'], before: { ...DEFAULT_OTHER_SETTINGS, requireDlsForOfficialStamps: true }, after: { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' }, allowed: false },
  { name: 'partial WDI payload cannot erase the RK table', areas: ['wdi'], before: { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: rkTable }, after: { wdiCalculationMode: 'formula' }, allowed: false },
  { name: 'WDI editor can retain unrelated RK and DLS values', areas: ['wdi'], before: { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: rkTable, requireDlsForOfficialStamps: true }, after: { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: rkTable, requireDlsForOfficialStamps: true, wdiCalculationMode: 'formula' }, allowed: true },
  { name: 'mixed write succeeds with each changed area permission', areas: ['wdi', 'processes', 'checks'], before: DEFAULT_OTHER_SETTINGS, after: { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula', rkExposureTable: rkTable, requireDlsForOfficialStamps: true }, allowed: true },
] as const

for (const scenario of cases) test(scenario.name, async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
  const email = `settings-access-${randomUUID()}@e2e.test`
  const previous = await withE2eDatabase(async db => (await db.query("select key,value,updated_at from app_settings where key in ('other','save-check')")).rows)
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Редактор отдельной настройки', email, title: '', role: 'user', permissions: scenario.areas.flatMap(area => [`${area}.view`, `${area}.edit`]) as Permission[] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    await withE2eDatabase(async db => {
      await db.query("insert into app_settings(key,value) values('other',$1) on conflict(key) do update set value=excluded.value,updated_at=now()", [JSON.stringify(scenario.before)])
      // Preserve the supported legacy fallback; no explicit officialDls override.
      await db.query("insert into app_settings(key,value) values('save-check','{}') on conflict(key) do update set value=excluded.value,updated_at=now()")
    })
    const before = await withE2eDatabase(async db => (await db.query("select value,updated_at::text from app_settings where key='other'")).rows[0])
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const call = async (operation: string, data: unknown, method = 'POST') => {
      const url = new URL(siblingRpcUrl(observed, `${operation}_createServerFn_handler`)), encoded = await serializeRpcData(data)
      if (method === 'GET') url.searchParams.set('payload', encoded)
      const response = await context.request.fetch(url.href, { method, ...(method === 'POST' ? { data: encoded } : {}),
        headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
      return await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
    }
    const settings = await call('listAppSettingsSnapshot', {}, 'GET')
    expect(settings.error).toBeUndefined()
    const saved = await call('saveAppSetting', { key: 'other', value: scenario.after, expectedUpdatedAt: settings.result.updatedAt.other })
    if (scenario.allowed) {
      expect(saved.error).toBeUndefined()
      const actual = await withE2eDatabase(async db => (await db.query("select value from app_settings where key='other'")).rows[0].value)
      expect(JSON.parse(actual)).toEqual(scenario.after)
      const audits = await withE2eDatabase(async db => (await db.query("select o.area,c.area as detail_area,c.changes from audit_operations o join audit_changes c on c.operation_id=o.id where o.actor_id=(select id from auth_users where email=$1) and o.action='saveAppSetting' and c.entity='app_settings' and c.entity_id='other'", [email])).rows)
      expect(audits).toHaveLength(1)
      expect(audits[0].area).toBe(scenario.areas.length === 1 ? scenario.areas[0] : 'checks')
      expect(audits[0].detail_area).toBe(audits[0].area)
      expect(audits[0].changes.value).toBeDefined()
      expect((await call('saveAppSetting', { key: 'other', value: scenario.before, expectedUpdatedAt: settings.result.updatedAt.other })).error?.message).toContain('изменена другим пользователем')
      if (scenario.areas.length === 1 && scenario.areas[0] === 'processes') {
        await page.goto('/settings')
        await page.getByRole('button', { name: 'Процессы контроля', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Параметры РК', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Редактировать справочник', exact: true }).click()
        await page.getByLabel('Примечание варианта 57:1', { exact: true }).fill('Изменено через интерфейс')
        await page.getByRole('button', { name: 'Применить к настройкам', exact: true }).click()
        await page.getByRole('button', { name: 'Сохранить справочник РК', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: 'Изменения сохранены.' })).toBeVisible()
        const stored = await withE2eDatabase(async db => JSON.parse((await db.query("select value from app_settings where key='other'")).rows[0].value))
        expect(stored.rkExposureTable.entries[0].options[0].note).toBe('Изменено через интерфейс')
        expect(stored.wdiCalculationMode).toBe('manual')
      }
    } else {
      expect(saved.error?.message).toContain('Недостаточно прав')
      expect(saved.result).toBeUndefined()
      expect(await withE2eDatabase(async db => (await db.query("select value,updated_at::text from app_settings where key='other'")).rows[0])).toEqual(before)
      expect(await withE2eDatabase(async db => (await db.query("select count(*)::int as count from audit_operations where actor_id=(select id from auth_users where email=$1) and action='saveAppSetting'", [email])).rows[0].count)).toBe(0)
    }
  } finally {
    await context.close()
    await withE2eDatabase(async db => {
      await db.query("delete from app_settings where key in ('other','save-check')")
      for (const row of previous) await db.query('insert into app_settings(key,value,updated_at) values($1,$2,$3)', [row.key, row.value, row.updated_at])
      await db.query('delete from auth_users where email=$1', [email])
    })
  }
})
