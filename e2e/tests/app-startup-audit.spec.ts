import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

async function expectExplicitRecovery(page: Page, browser: Browser, info: TestInfo, timeout = 5000) {
  try {
    await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })).toBeVisible({ timeout })
  } catch (originalFailure) {
    // Keep the original failed recovery assertion. A new context is diagnostic
    // evidence, never a successful retry that makes this test pass.
    const failedPage = await page.evaluate(() => ({ url: location.href, text: document.body.innerText,
      resources: performance.getEntriesByType('resource').map(entry => ({ name: entry.name, bytes: (entry as PerformanceResourceTiming).transferSize })) }))
    const context = await browser.newContext()
    let recoveredInFreshContext = false
    try {
      const fresh = await context.newPage()
      await fresh.goto(page.url())
      await expect(fresh.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })).toBeVisible({ timeout: 30_000 })
      recoveredInFreshContext = true
    } catch { /* Preserve both the original failure and the recovery result. */ }
    finally { await context.close() }
    await writeFile(info.outputPath('explicit-recovery-diagnostic.json'), JSON.stringify({ browser: browser.browserType().name(),
      explicitRetryRecovered: false, recoveredInFreshContext, failedPage }, null, 2))
    console.log('EXPLICIT_RECOVERY_DIAGNOSTIC', JSON.stringify({ recoveredInFreshContext }))
    throw originalFailure
  }
}

// Exercise real production module boundaries. Vite dev's module URLs and retry
// semantics differ, so it cannot stand in for an application update.
test.beforeEach(() => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Requires the local production build')
})

test('одноразовый отказ модуля приложения восстанавливает загрузку без бесконечного обновления', async ({ page, browser }, info) => {
  let failures = 0, navigations = 0, recoveryFetches = 0
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++ })
  await page.route(/\/assets\/home-page-[^/]+\.js(?:\?.*)?$/, async route => {
    if (route.request().resourceType() === 'fetch') recoveryFetches++
    if (failures++ === 0) await route.abort('failed')
    else await route.continue()
  })
  await page.goto('/journal')
  await expectExplicitRecovery(page, browser, info, 30_000)
  await expect(page.locator('.journal-grid-frame')).toBeVisible()
  // One failed load, its successful module load, plus at most one explicit
  // cache refresh on browsers retaining the failure across navigations.
  expect(recoveryFetches).toBeLessThanOrEqual(1)
  expect(failures).toBe(2 + recoveryFetches)
  // Chromium retries a failed modulepreload on the real import, so a single
  // failed request need not reach the application's bounded reload handler.
  expect(navigations).toBeGreaterThanOrEqual(1)
  expect(navigations).toBeLessThanOrEqual(2)
})

test('постоянный отказ модуля останавливает автоматический повтор и позволяет явное восстановление', async ({ page, browser }, info) => {
  let failures = 0, navigations = 0
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++ })
  const module = /\/assets\/home-page-[^/]+\.js(?:\?.*)?$/
  await page.route(module, async route => { failures++; await route.abort('failed') })
  await page.goto('/journal')
  await expect.poll(() => navigations, { timeout: 30_000 }).toBe(2)
  await expect(page.getByRole('heading', { name: 'Не удалось открыть раздел', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
  await expect(page.locator('p:visible').filter({ hasText: 'Если после восстановления соединения повтор не помогает, полностью закройте браузер и откройте приложение снова.' })).toBeVisible()
  const stoppedRequests = failures
  // A browser may reuse its failed-module cache on the second navigation.
  // The bounded reload contract is asserted separately above and below.
  expect(stoppedRequests).toBeGreaterThanOrEqual(1)
  // Count document reloads separately from preload/import requests.
  await page.waitForTimeout(1500)
  expect(navigations).toBe(2)
  expect(failures).toBe(stoppedRequests)
  await page.unroute(module)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expectExplicitRecovery(page, browser, info)
})

test('отказ начального JavaScript не оставляет бесконечную загрузку без действия для восстановления', async ({ page, browser }, info) => {
  let failures = 0
  const entry = /\/assets\/index-[^/]+\.js(?:\?.*)?$/
  await page.route(entry, async route => { failures++; await route.abort('failed') })
  await page.goto('/journal')
  await expect.poll(() => failures).toBeGreaterThan(0)
  // The application shell must offer recovery even when React never starts.
  const retry = page.getByRole('button', { name: /Повторить|Обновить/ })
  await expect(retry).toBeVisible({ timeout: 15_000 })
  await page.unroute(entry)
  await retry.click()
  await expectExplicitRecovery(page, browser, info)
})

test('отказ хранилища браузера не ломает экран восстановления модуля', async ({ page, browser }, info) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem
    const check = (key: string) => { if (key.startsWith('welding-journal:chunk-reload:')) throw new DOMException('Storage unavailable', 'SecurityError') }
    Storage.prototype.getItem = function (key) { check(key); return get.call(this, key) }
    Storage.prototype.setItem = function (key, value) { check(key); return set.call(this, key, value) }
    Storage.prototype.removeItem = function (key) { check(key); return remove.call(this, key) }
  })
  let navigations = 0
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++ })
  const module = /\/assets\/home-page-[^/]+\.js(?:\?.*)?$/
  await page.route(module, route => route.abort('failed'))
  await page.goto('/journal')
  await expect(page.getByRole('heading', { name: 'Не удалось открыть раздел', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  expect(navigations).toBe(1)
  await page.unroute(module)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expectExplicitRecovery(page, browser, info)
})

for (const fault of ['syntax','execution'] as const) test(`ошибка исполнения начального модуля (${fault}) оставляет ручное восстановление`, async ({page,browser}, info)=>{
  const entry=/\/assets\/index-[^/]+\.js(?:\?.*)?$/
  await page.route(entry,route=>route.fulfill({status:200,contentType:'application/javascript',
    body:fault==='syntax'?'export const interrupted = ;':'throw new Error("Local entry execution probe")'}))
  await page.goto('/journal')
  const retry=page.getByRole('button',{name:/Повторить|Обновить/})
  await expect(retry).toBeVisible({timeout:10000})
  await page.unroute(entry)
  await retry.click()
  await expectExplicitRecovery(page, browser, info)
})
