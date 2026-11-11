import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createSmoothnessProbe } from '../smoothness-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture } from '../smoothness-fixture'
import { withLineProgramFixture } from '../line-program-fixtures'

const enabled = !!process.env.SMOOTHNESS_LABEL
test.skip(!enabled, 'Explicit local performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })
test.beforeAll(async () => { if (enabled) {
  test.setTimeout(180000); await seedSmoothnessFixture()
  await withLineProgramFixture(db => db.query("update weld_joints set stamp_1_k='Q000',stamp_1_z='Q000' where line='SM-0001' and project_title='E2E smoothness 2026-11-05'"))
} })
test.afterAll(async () => { if (enabled) { test.setTimeout(180000); await cleanupSmoothnessFixture() } })

test('page grids: idle work after scroll, including hidden scroll partners', async ({ page }, info) => {
  test.setTimeout(180000)
  await page.addInitScript(() => {
    const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window)
    const state = { active: new Map<number, number>(), origins: new Map<number, { stack?: string; callback: string }>(), ticks10: 0 }
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const wrapped = timeout === 10 && typeof handler === 'function' ? (...params: unknown[]) => { state.ticks10++; return handler(...params) } : handler
      const id = set(wrapped, timeout, ...args); state.active.set(id, timeout ?? 0)
      if (timeout === 10) state.origins.set(id, { stack: new Error().stack, callback: String(handler) })
      return id
    }) as typeof window.setInterval
    window.clearInterval = id => { if (typeof id === 'number') { state.active.delete(id); state.origins.delete(id) }; clear(id) }
    Object.assign(window, { gridIdleAudit: state })
  })
  const probe = await createSmoothnessProbe(page, info), samples: unknown[] = []
  try {
    for (const [route, selector] of [
      ['/line-program', '[data-program-grid="lines"]'],
      ['/line-program?detail=1', '[data-program-grid="joints"]'],
      ['/statistics', '[data-statistics-grid="welders"]'],
      ['/account?tab=rules&section=connections', '.connection-rules-grid'],
    ]) {
      await page.goto(route)
      if (route.includes('detail=1')) {
        await page.getByLabel('Поиск программы линий', { exact: true }).fill('SM-0001')
        await page.getByRole('button', { name: 'Расчёт линии SM-0001', exact: true }).click()
        await page.getByRole('button', { name: 'Клеймо Q000', exact: true }).click()
      }
      if (route === '/statistics') {
        await page.getByRole('main').getByRole('button', { name: 'Сварщики', exact: true }).click()
        await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
        await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
      }
      const grid = page.locator(selector)
      await expect(grid.locator('.ag-row').first()).toBeVisible({ timeout: 60000 })
      await probe.scroll(`${route}:wheel`, grid)
      await page.waitForTimeout(350)
      for (let n = 0; n < 3; n++) {
        await page.evaluate(() => { (window as any).gridIdleAudit.ticks10 = 0 })
        await probe.measure(`${route}:idle:${n}`, async () => { await page.waitForTimeout(2000) })
        const observation = await page.evaluate(selector => ({
          ticks10: (window as any).gridIdleAudit.ticks10,
          active10: [...(window as any).gridIdleAudit.active.values()].filter(delay => delay === 10).length,
          intervalOrigins: [...(window as any).gridIdleAudit.origins.values()],
          allPartners: [...document.querySelectorAll<HTMLElement>('.ag-body-vertical-scroll-viewport, .ag-body-horizontal-scroll-viewport')].map(element => ({
            grid: element.closest<HTMLElement>('[data-program-grid]')?.dataset.programGrid,
            context: element.closest<HTMLElement>('[data-program-grid]')?.dataset.programGridContext,
            className: element.className, measurable: element.checkVisibility({ checkVisibilityCSS: true }),
            width: element.clientWidth, height: element.clientHeight,
            visibility: getComputedStyle(element).visibility,
          })),
          partners: [...document.querySelectorAll(`${selector} .ag-body-vertical-scroll-viewport`)].map(element => ({
            measurable: element.checkVisibility({ checkVisibilityCSS: true }),
            scrollTop: element.scrollTop, clientHeight: element.clientHeight,
          })),
        }), selector)
        samples.push({ route, n, ...observation })
        if (process.env.SMOOTHNESS_ASSERT_IDLE === '1') expect.soft(observation.active10, `${route}: idle ${n}`).toBe(0)
      }
    }
  } finally {
    await writeFile(info.outputPath('idle-intervals.json'), JSON.stringify(samples, null, 2))
    await probe.finish()
  }
})
