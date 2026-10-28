import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { rpcName } from '../rpc'

test.use({ trace: 'off', video: 'off' })

type StartupProbe = { started: number; shell: number | null; grid: number | null; ready: number | null; longTasks: number[]; errors: string[] }

function installProbe() {
  const probe = { started: 0, shell: null as number | null, grid: null as number | null,
    ready: null as number | null, longTasks: [] as number[], errors: [] as string[] }
  Object.assign(window, { startupAudit: probe })
  const inspect = () => {
    if (location.pathname !== '/journal') return
    const now = performance.now() - probe.started
    if (probe.shell === null && document.querySelector('input[aria-label="Быстрый поиск по отчету"]')) probe.shell = now
    const frame = document.querySelector('.journal-grid-frame')
    if (probe.grid === null && frame) probe.grid = now
    if (probe.ready === null && frame?.getAttribute('aria-busy') === 'false' && frame.querySelector('.ag-row[row-id]')) probe.ready = now
  }
  new MutationObserver(inspect).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] })
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' })
  }
  window.addEventListener('error', event => probe.errors.push(event.message))
}

async function ready(page: Page) {
  await expect(page).toHaveURL(/\/journal(?:\?|$)/)
  await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })).toBeVisible()
  await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.journal-grid-frame .ag-row[row-id]').first()).toBeVisible()
}

test('normal CPU: three cold sessions, twenty refreshes and twenty returns with separate delivery/interface/data phases', async ({ browser }, info) => {
  test.skip(!process.env.AUDIT_STARTUP_LABEL, 'Opt-in local production startup measurement')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  test.setTimeout(300_000)
  const samples: unknown[] = []
  const run = async (page: Page, phase: string, round: number, action: () => Promise<unknown>) => {
    const requests: string[] = []
    const requestDetails: { name: string; body: string | null; startedMs: number }[] = []
    const record = (request: import('@playwright/test').Request) => {
      const name = rpcName(request.url())
      if (name) { requests.push(name); requestDetails.push({ name, body: request.postData(), startedMs: performance.now() - start }) }
    }
    page.on('request', record)
    const start = performance.now()
    await action()
    await ready(page)
    const observedReadyMs = performance.now() - start
    // Let completed requests and their ResourceTiming entries settle. This
    // wait is outside the reported readiness and is equal for every sample.
    await page.waitForLoadState('networkidle')
    const metrics = await page.evaluate(() => {
      const probe = (window as unknown as { startupAudit: StartupProbe }).startupAudit
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      const resources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter(entry => entry.startTime >= probe.started)
      return { ...probe, document: probe.started === 0 ? {
        ttfbMs: navigation.responseStart, htmlCompleteMs: navigation.responseEnd,
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        firstContentfulPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      } : null,
      resources: resources.map(entry => ({ name: new URL(entry.name).pathname, durationMs: entry.duration,
        transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize })),
      domNodes: document.querySelectorAll('*').length, deviceScaleFactor: devicePixelRatio }
    })
    page.off('request', record)
    expect(metrics.errors).toEqual([])
    expect(metrics.ready).not.toBeNull()
    samples.push({ phase, round, observedReadyMs, requests, requestDetails, ...metrics })
  }
  for (let cold = 0; cold < 3; cold++) {
    // A fresh context gives an empty browser HTTP cache; the local server and
    // PostgreSQL are deliberately not called cold merely because a tab is new.
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } })
    try {
      await context.addInitScript(installProbe)
      const page = await context.newPage()
      await run(page, 'cold-browser-context', cold, () => page.goto('/journal'))
      if (cold !== 2) continue
      for (let round = 0; round < 20; round++) await run(page, 'warm-refresh', round, () => page.reload())
      for (let round = 0; round < 20; round++) {
        await page.getByRole('button', { name: 'ЛНК', exact: true }).click()
        await expect(page).toHaveURL(/\/lnk(?:\?|$)/)
        await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => {
          const probe = (window as unknown as { startupAudit: StartupProbe }).startupAudit
          Object.assign(probe, { started: performance.now(), shell: null, grid: null, ready: null, longTasks: [], errors: [] })
          performance.clearResourceTimings()
        })
        await run(page, 'warm-route-return', round, () => page.getByRole('button', { name: 'Сварочный журнал', exact: true }).click())
      }
    } finally { await context.close() }
  }
  const result = { browser: browser.browserType().name(), version: browser.version(), cpuThrottling: 'none', samples }
  await writeFile(info.outputPath(`startup-${process.env.AUDIT_STARTUP_LABEL}.json`), JSON.stringify(result, null, 2))
  await info.attach('startup-measurements', { body: JSON.stringify(result), contentType: 'application/json' })
  console.log('STARTUP_AUDIT', JSON.stringify(result))
})
