import { expect, test, type Page } from '@playwright/test'
import { rpcName } from '../rpc'

// Use the runner's existing authenticated disposable fixture. No records need
// creating: an empty overview still mounts the same production surface.
const programCss = /\/assets\/line-program-page-[^/]+\.css(?:\?.*)?$/

test.beforeEach(() => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Requires real production module/CSS boundaries')
})

async function expectProgramReady(page: Page) {
  await expect(page).toHaveURL(/\/line-program(?:\?|$)/)
  await expect(page.getByRole('textbox', { name: 'Поиск программы линий', exact: true })).toBeVisible()
  await expect(page.locator('[data-program-grid="lines"] .ag-root')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Array.from(document.styleSheets).some(sheet =>
    /\/assets\/line-program-page-[^/]+\.css(?:\?.*)?$/.test(sheet.href ?? ''),
  ))).toBe(true)
}

test('первое открытие программы линий ждёт CSS общей загрузки перед монтажом таблицы', async ({ page }) => {
  let releaseCss!: () => void
  const cssGate = new Promise<void>(resolve => { releaseCss = resolve })
  const interceptedUrls = new Set<string>()
  await page.route(programCss, async route => {
    interceptedUrls.add(route.request().url())
    await cssGate
    await route.continue()
  })

  try {
    // The intentionally pending stylesheet can prevent the document's load
    // event. Wait for the real application shell instead of that event.
    await page.goto('/line-program', { waitUntil: 'commit' })
    await expect.poll(() => interceptedUrls.size).toBe(1)
    await expect(page.getByRole('navigation', { name: 'Разделы программы' })).toBeVisible()
    const loading = page.getByText('Загружаем программу линий...', { exact: true })
    await expect(loading).toBeVisible()
    // Keep the fault active after React has attempted the lazy render. This
    // catches a second import skipping Vite's already-seen but unfinished CSS.
    await page.waitForTimeout(750)
    await expect(loading).toBeVisible()
    await expect(page.getByTestId('line-program')).toHaveCount(0)
    await expect(page.locator('[data-program-grid="lines"]')).toHaveCount(0)

    releaseCss()
    await expectProgramReady(page)
    await expect(loading).toHaveCount(0)
  } finally {
    releaseCss()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('ошибка CSS программы линий видна и штатное «Повторить» восстанавливает раздел', async ({ page }) => {
  let failures = 0
  await page.route(programCss, async route => {
    failures++
    await route.abort('failed')
  })
  // Browser resource errors are expected for this deliberate network fault.
  await page.goto('/line-program', { waitUntil: 'commit' })
  await expect.poll(() => failures).toBeGreaterThan(0)
  const error = page.getByRole('heading', { name: 'Не удалось открыть раздел', exact: true })
  const retry = page.getByRole('button', { name: 'Повторить', exact: true })
  await expect(error).toBeVisible({ timeout: 30_000 })
  // Let the existing bounded automatic recovery finish, if the error type
  // enables it. The later recovery must still come from the ordinary button.
  await page.waitForLoadState('networkidle')
  await expect(error).toBeVisible()
  await expect(retry).toBeVisible()
  await expect(page.getByTestId('line-program')).toHaveCount(0)

  await page.unroute(programCss)
  await retry.click()
  await expectProgramReady(page)
  await expect(error).toHaveCount(0)
})

test('открытие раздела не запускает рабочие запросы до входа', async ({ browser, baseURL }) => {
  for (const path of ['/journal', '/documents', '/line-program']) {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
    try {
      const page = await context.newPage(), calls: string[] = []
      page.on('request', request => {
        const name = rpcName(request.url())
        if (name) calls.push(name)
      })
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(calls.filter(name => !/^(refreshAccountActivity|getCurrentAccount)_/.test(name))).toEqual([])
      await expect(page.locator('.ag-root')).toHaveCount(0)
    } finally { await context.close() }
  }
})
