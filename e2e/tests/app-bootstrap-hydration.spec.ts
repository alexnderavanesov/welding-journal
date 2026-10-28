import { expect, test } from '@playwright/test'

test('bootstrap recovery script matches the hydrated application without console errors', async ({ page }, info) => {
  const errors: string[] = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  if (process.env.E2E_USE_PRODUCTION_BUILD !== '1') {
    const scripts = await page.evaluate(async () => {
      const modulePath = '/src/lib/app-bootstrap-recovery.ts'
      const client = await import(/* @vite-ignore */ modulePath)
      const server = Array.from(document.scripts).find(script => script.textContent?.includes('const retryModules='))?.textContent
      return { server, client: 'window.process=window.process||{env:{}};window.process.env=window.process.env||{};' + client.APP_BOOTSTRAP_RECOVERY_SCRIPT }
    })
    await info.attach('bootstrap-script-comparison', { body: JSON.stringify(scripts, null, 2), contentType: 'application/json' })
    expect(scripts.server).toBe(scripts.client)
  }
  expect(errors).toEqual([])
})
