import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { resetE2eAccountFixtureLimits, latestE2eToken } from '../authentication'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { rpcName } from '../rpc'

test('rules and check parameters are available without registry permissions and never load its records', async ({ browser, baseURL }) => {
  await resetE2eAccountFixtureLimits()
  const email = `support-reference-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Читатель правил', email, title: '', role: 'user', permissions: [] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'support123' })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'support123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage(), calls: string[] = []
    page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
    await page.goto('/account?tab=rules&section=connections')
    await expect(page.getByRole('heading', { name: 'Правила системы', exact: true })).toBeVisible()
    await page.goto('/references?tab=checks')
    await expect(page).toHaveURL(/account\?tab=rules&section=checks/)
    await expect(page.getByRole('heading', { name: 'Как проверяется допуск клейма', exact: true })).toBeVisible()
    const navigation = page.getByRole('tablist', { name: 'Разделы правил системы', exact: true })
    await expect(navigation.getByRole('tab', { name: 'Параметры проверки', exact: true })).toBeVisible()
    await expect(navigation.getByRole('tab', { name: /Клейма|Специалисты|Технологические карты/ })).toHaveCount(0)
    await page.goto('/account?tab=rules&section=checks')
    await page.reload()
    await expect(page).toHaveURL(/account\?tab=rules&section=checks/)
    await expect(page.getByRole('heading', { name: 'Как проверяется допуск клейма', exact: true })).toBeVisible()
    expect(calls.filter(name => /^(getWelderStamp|getTechnologyCard|getDocumentSpecialist|listTechnologyCard|loadWelderStampRegistry|loadSpecialist|listSpecialist)/.test(name))).toEqual([])
    await page.goto('/references')
    await expect(page.getByText('Доступ к этому разделу не предоставлен.', { exact: true })).toBeVisible()
    expect(calls.filter(name => /^(getWelderStamp|getTechnologyCard|getDocumentSpecialist|listTechnologyCard|loadWelderStampRegistry|loadSpecialist|listSpecialist)/.test(name))).toEqual([])
  } finally {
    await context.close()
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})
