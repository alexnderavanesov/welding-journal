import { expect, test, type Page, type Request } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createSmoothnessProbe } from '../smoothness-probe'
import { cleanupSmoothnessFixture, seedSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'
import { rpcName } from '../rpc'

type TechnologySearchTiming = {
  timeOrigin: number
  installedAt: number
  inputAt: number | null
  domReadyAt: number | null
  mutationBatches: number
}
type TechnologySearchWindow = Window & {
  technologySearchTiming?: { state: TechnologySearchTiming; stop: () => void }
}

const enabled = !!process.env.SMOOTHNESS_LABEL && process.env.SMOOTHNESS_RECHECK === '1'
test.skip(!enabled, 'Explicit local recheck against baseline and current builds')
test.describe.configure({ mode: 'serial' })
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })
test.beforeAll(async () => { if (enabled) { test.setTimeout(180000); await seedSmoothnessFixture() } })
test.afterAll(async () => { if (enabled) { test.setTimeout(180000); await cleanupSmoothnessFixture() } })

// Full navigations reset the mounted page and its client query cache. They do
// not clear HTTP caches or server calculations; use this same harness for both builds.
async function reportReady(page: Page) {
  await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 })
  await expect(page.locator('.journal-grid-frame .ag-row[row-id]').first()).toBeVisible()
}

test('guide: three full navigations with content readiness', async ({ page }, info) => {
  test.setTimeout(300000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    for (let round = 0; round < 3; round++) {
      await probe.measure(`guide:full-navigation:${round}`, async () => {
        await page.goto('/account?tab=guide')
        await expect(page.getByRole('heading', { name: 'Как работать в системе', exact: true })).toBeVisible({ timeout: 60000 })
      })
    }
  } finally { await probe.finish() }
})

test('technology cards: three searches after direct navigation to the populated registry', async ({ page }, info) => {
  test.setTimeout(300000)
  const probe = await createSmoothnessProbe(page, info)
  const searchTimings: object[] = []
  try {
    for (let round = 0; round < 3; round++) {
      await page.goto('/references?tab=technologyCards')
      const rows = page.getByRole('row').filter({ hasText: 'SM-TK-' })
      // The fixture contains 500 cards; the actual first server page contains 50.
      await expect(rows).toHaveCount(50, { timeout: 60000 })
      await expect(page.getByRole('button', { name: 'Далее', exact: true })).toBeEnabled()
      const search = page.getByRole('searchbox', { name: 'Поиск технологических карт', exact: true })
      await expect(search).toHaveValue('')
      await page.waitForLoadState('networkidle')
      await search.evaluate((element, target) => {
        const input = element as HTMLInputElement
        const scope = input.closest('section')
        if (!scope) throw new Error('Technology-card registry section was not found')
        const state: TechnologySearchTiming = {
          timeOrigin: performance.timeOrigin, installedAt: performance.now(), inputAt: null, domReadyAt: null, mutationBatches: 0,
        }
        const onInput = () => { if (input.value === target && state.inputAt === null) state.inputAt = performance.now() }
        const stop = () => { observer.disconnect(); input.removeEventListener('input', onInput, true) }
        const observer = new MutationObserver(() => {
          state.mutationBatches++
          if (state.inputAt === null || state.domReadyAt !== null) return
          const matches = [...scope.querySelectorAll<HTMLTableRowElement>('tbody tr')]
            .filter(row => row.textContent?.includes('SM-TK-'))
          const next = [...scope.querySelectorAll<HTMLButtonElement>('button')]
            .find(button => button.textContent?.trim() === 'Далее')
          if (matches.length === 1 && matches[0].cells[0]?.textContent?.trim() === target && next?.disabled) {
            // DOM commit time, independent of Playwright's assertion polling.
            // No geometry reads or RAF polling; visibility is still asserted below.
            state.domReadyAt = performance.now()
            stop()
          }
        })
        input.addEventListener('input', onInput, true)
        observer.observe(scope, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden'] })
        ;(window as TechnologySearchWindow).technologySearchTiming = { state, stop }
      }, 'SM-TK-0500')
      const requests: Request[] = []
      const onRequest = (request: Request) => {
        if (request.url().includes('/_serverFn/') && /^getTechnologyCardPage(?:_|$)/.test(rpcName(request.url()))) requests.push(request)
      }
      page.on('request', onRequest)
      let fillStartedEpochMs: number | null = null
      let assertionsCompletedEpochMs: number | null = null
      try {
        await probe.measure(`references:techcards-search:${round}`, async () => {
          fillStartedEpochMs = Date.now()
          await search.fill('SM-TK-0500')
          await expect(rows).toHaveCount(1, { timeout: 60000 })
          await expect(rows.first().getByRole('cell', { name: 'SM-TK-0500', exact: true })).toBeVisible()
          await expect(page.getByRole('button', { name: 'Далее', exact: true })).toBeDisabled()
          assertionsCompletedEpochMs = Date.now()
        })
      } finally {
        page.off('request', onRequest)
        const dom = await page.evaluate(() => {
          const audit = (window as TechnologySearchWindow).technologySearchTiming
          audit?.stop()
          return audit?.state ?? null
        })
        const inputEpochMs = dom?.inputAt != null ? dom.timeOrigin + dom.inputAt : null
        searchTimings.push({ round, source: 'MutationObserver DOM commit, not physical paint', dom,
          fillStartedEpochMs, assertionsCompletedEpochMs,
          inputToDomReadyMs: dom?.inputAt != null && dom.domReadyAt != null ? dom.domReadyAt - dom.inputAt : null,
          domReadyToAssertionsMs: dom?.domReadyAt != null && assertionsCompletedEpochMs !== null
            ? assertionsCompletedEpochMs - (dom.timeOrigin + dom.domReadyAt) : null,
          requests: requests.map(request => {
            const timing = request.timing()
            return { name: rpcName(request.url()), timing, failure: request.failure()?.errorText ?? null,
              startAfterInputMs: inputEpochMs === null ? null : timing.startTime - inputEpochMs,
              responseAfterInputMs: inputEpochMs === null || timing.responseStart < 0 ? null : timing.startTime + timing.responseStart - inputEpochMs,
              finishAfterInputMs: inputEpochMs === null || timing.responseEnd < 0 ? null : timing.startTime + timing.responseEnd - inputEpochMs }
          }),
        })
        expect(dom?.inputAt, 'Input event timing must be captured').toEqual(expect.any(Number))
        expect(dom?.domReadyAt, 'MutationObserver must capture the completed search DOM').toEqual(expect.any(Number))
      }
    }
  } finally {
    await writeFile(info.outputPath('techcard-search-timing.json'), JSON.stringify({ label: process.env.SMOOTHNESS_LABEL, browser: info.project.name, samples: searchTimings }, null, 2))
    await probe.finish()
  }
})

test('program: three first detail openings after full navigation and settled line search', async ({ page }, info) => {
  test.setTimeout(300000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    for (let round = 0; round < 3; round++) {
      await page.goto('/line-program')
      const lines = page.locator('[data-program-grid="lines"]')
      await expect(lines.locator('.ag-row').first()).toBeVisible({ timeout: 60000 })
      await page.getByLabel('Поиск программы линий', { exact: true }).fill('SM-0001')
      await expect(lines.locator('.ag-row')).toHaveCount(1, { timeout: 60000 })
      const open = page.getByRole('button', { name: 'Расчёт линии SM-0001', exact: true })
      await expect(open).toBeVisible()
      await page.waitForLoadState('networkidle')
      await probe.measure(`program:stamp-detail:${round}`, async () => {
        await open.click()
        await expect(page.locator('[data-program-grid="stamps"] .ag-row').first()).toBeVisible({ timeout: 60000 })
      })
    }
  } finally { await probe.finish() }
})

test('journal: grouped expansion waits for a real joint row and the completed grid load', async ({ page }, info) => {
  test.setTimeout(300000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/journal')
    await reportReady(page)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(SMOOTHNESS_PROJECT)
    await expect(page.getByText('Найдено: 5000', { exact: true })).toBeVisible({ timeout: 60000 })
    await reportReady(page)
    await page.waitForLoadState('networkidle')
    const grid = page.locator('.journal-grid-frame')
    for (const column of ['line', 'projectTitle', 'subtitleCode']) {
      await grid.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    await probe.measure('journal:expand-groups', async () => {
      await grid.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
      await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
      await expect(grid.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^(?:F|ОП)\d+/)
      await expect(grid).toHaveAttribute('aria-busy', 'false')
    })
  } finally { await probe.finish() }
})
