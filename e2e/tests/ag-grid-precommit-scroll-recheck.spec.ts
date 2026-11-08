import { expect as playwrightExpect, test, type Locator, type Page } from '@playwright/test'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { seedAgGridScaleFixture, AG_GRID_SCALE_PROJECT } from '../ag-grid-scale-fixture'
import { createSmoothnessProbe } from '../smoothness-probe'
import { auditSqlCount } from '../audit-sql'
import { rpcName } from '../rpc'

// One frozen build per isolated e2e/run.ts invocation. Run both sides serially;
// this profile records all 80 gestures and never drops a slow/background sample.
test.skip(process.env.AG_GRID_PRECOMMIT_SCROLL_RECHECK !== '1', 'Explicit serial 250k scroll confirmation only')
test.use({ trace: 'off', video: 'off', actionTimeout: 30000 })
const expect = playwrightExpect.configure({ timeout: 60000 })
const rounds = 20
const reports = [
  { name: 'journal', path: '/journal', kind: 'weldingJournal' },
  { name: 'psto', path: '/psto', kind: 'heatTreatment' },
] as const

async function idle(frame: Locator) {
  await expect(frame).toHaveAttribute('aria-busy', 'false', { timeout: 240000 })
  await expect(frame).not.toHaveAttribute('data-journal-updating', '')
  await expect(frame.locator('.ag-row-loading')).toHaveCount(0)
}

async function reset(page: Page, frame: Locator) {
  await frame.evaluate(element => {
    for (const viewport of element.querySelectorAll<HTMLElement>('.ag-grid-viewport')) viewport.scrollLeft = 0
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  })
  await idle(frame)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
}

async function geometry(frame: Locator) {
  return frame.evaluate(element => {
    const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
    const box = element.getBoundingClientRect()
    return { windowX: scrollX, windowY: scrollY, viewportX: viewport.scrollLeft, viewportY: viewport.scrollTop,
      viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight, scrollWidth: viewport.scrollWidth,
      pageHeight: document.scrollingElement!.scrollHeight, box: { x: box.x, y: box.y, width: box.width, height: box.height },
      columns: Number(element.querySelector('[aria-colcount]')?.getAttribute('aria-colcount')),
      rows: element.querySelectorAll('.ag-row').length, cells: element.querySelectorAll('.ag-cell').length,
      groups: element.querySelectorAll('.ag-row-group').length,
      // AG Grid may recycle DOM nodes in a different insertion order. Compare
      // the visual row positions and their identities, not DOM insertion order.
      visibleRows: [...element.querySelectorAll('.ag-row')].map(row => ({
        index: Number(row.getAttribute('row-index')), id: row.getAttribute('row-id'),
      })).sort((a, b) => a.index - b.index || String(a.id).localeCompare(String(b.id))) }
  })
}

type SqlCounts = { statements: number; rpcStatements: Record<string, number> }
async function sqlCounts(): Promise<SqlCounts> {
  const file = process.env.AUDIT_SQL_COUNTS_FILE
  if (!file) throw new Error('Per-RPC SQL counters are required')
  const result = JSON.parse(await readFile(file, 'utf8')) as SqlCounts
  if (!result.rpcStatements) throw new Error('Missing per-RPC SQL counters')
  return result
}

test('20 identical flat and grouped vertical gestures in journal and PSTO on one frozen 250k build', async ({ browser }, info) => {
  test.setTimeout(1800000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.AG_GRID_SCALE_ROWS).toBe('250000')
  expect(process.env.E2E_CHROME).toBe('1')
  expect(info.project.use.channel).toBe('chrome')
  expect(browser.browserType().name()).toBe('chromium')
  expect(info.config.workers).toBe(1)
  expect(process.env.SMOOTHNESS_TRACE_ACTION).toBeUndefined()
  const label = process.env.AG_GRID_PRECOMMIT_SCROLL_LABEL
  if (!label || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,100}$/.test(label)) throw new Error('Set a unique AG_GRID_PRECOMMIT_SCROLL_LABEL')
  if (!process.env.E2E_AUDIT_OUTPUT_DIR) throw new Error('Select a frozen build with E2E_AUDIT_OUTPUT_DIR')
  const build = resolve(process.env.E2E_AUDIT_OUTPUT_DIR)
  if (build === resolve('.output')) throw new Error('Use a frozen build, not mutable .output')
  await access(resolve(build, 'server/index.mjs'))
  const parent = resolve('outputs/precommit-audit-2026-11-08/scroll-recheck')
  await mkdir(parent, { recursive: true })
  const destination = resolve(parent, label)
  await mkdir(destination) // Existing evidence must never be overwritten.
  const metadata = { label, build, count: 250000, roundsPerProfile: rounds, gestures: rounds * 4,
    browser: browser.browserType().name(), version: browser.version(), viewport: { width: 1600, height: 1000 },
    cpuThrottling: 'none', startedAt: new Date().toISOString(), heartbeatPolicy: 'preserved; zero report RPC/SQL; activity SQL reported separately' }
  const preparation: object[] = [], shapes: object[] = [], samples: object[] = [], accounting: object[] = []
  const save = () => writeFile(resolve(destination, 'comparison-side.json'), JSON.stringify({ ...metadata, preparation, geometry: shapes, accounting }, null, 2))
  console.log('PRECOMMIT_SCROLL_SEED_START', label)
  const fixture = await seedAgGridScaleFixture(250000)
  await writeFile(resolve(destination, 'fixture.json'), JSON.stringify(fixture, null, 2))
  console.log('PRECOMMIT_SCROLL_SEED_COMPLETE', label)
  const options = { storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: metadata.viewport }
  // A fresh context per profile avoids persisted grouping/selection from the
  // previous profile. Background activity stays enabled, including at 60s.
  try {
    for (const report of reports) for (const grouped of [false, true]) {
      const profile = `${report.name}:${grouped ? 'grouped' : 'flat'}:vertical`
      console.log('PRECOMMIT_SCROLL_PROFILE_START', profile)
      const context = await browser.newContext(options)
      try {
        const page = await context.newPage()
        await page.addInitScript(kind => localStorage.setItem(`welding-report-view:v1:${kind}`, JSON.stringify({
          activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
        })), report.kind)
        const calls: { name: string; id: string }[] = []
        page.on('request', request => {
          if (!request.url().includes('/_serverFn/')) return
          calls.push({ name: rpcName(request.url()), id: new URL(request.url()).pathname.split('/').at(-1)! })
        })
        await page.goto(report.path)
        const root = page.locator(`[data-weld-report-grid="${report.kind}"]`), frame = root.locator('.journal-grid-frame')
        await expect(frame.locator('.ag-row[row-id]:not(.ag-row-loading)').first()).toBeVisible({ timeout: 240000 })
        await idle(frame)
        await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(AG_GRID_SCALE_PROJECT)
        await expect(root.getByText('Найдено: 250000', { exact: true })).toBeVisible({ timeout: 240000 })
        await idle(frame)
        if (grouped) {
          for (const column of ['projectTitle', 'subtitleCode', 'line']) {
            await frame.locator(`.ag-header-cell[col-id="${column}"]`).click({ button: 'right' })
            await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
          }
          await frame.locator('.ag-row-group .ag-cell[col-id="projectTitle"]').first().click({ button: 'right' })
          await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
          await expect(frame.locator('.ag-row:not(.ag-row-group) .ag-cell[col-id="joint"]').first()).toHaveText(/^(?:F|ОП)\d+/)
          await idle(frame)
        } else await expect(frame.locator('.ag-row-group')).toHaveCount(0)
        // One identical unmeasured pass loads the first visible blocks before
        // shape/SQL assertions. Never trim the group model or replace wheel input.
        await reset(page, frame)
        await page.evaluate(() => window.scrollTo({ top: 1600, left: 0, behavior: 'instant' }))
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1600)
        await idle(frame); await page.waitForLoadState('networkidle')
        await reset(page, frame); await auditSqlCount()
        const baseline = await geometry(frame)
        expect(baseline.windowY).toBe(0); expect(baseline.viewportX).toBe(0)
        expect(baseline.columns).toBeGreaterThan(60)
        expect(baseline.scrollWidth).toBeGreaterThan(baseline.viewportWidth * 5)
        expect(baseline.rows).toBeGreaterThan(0)
        preparation.push({ profile, geometry: baseline }); await save()
        const probe = await createSmoothnessProbe(page, info)
        try {
          for (let round = 0; round < rounds; round++) {
            await reset(page, frame); await auditSqlCount()
            await expect.poll(() => geometry(frame), { message: `${profile}:${round}: settle back to the baseline geometry` }).toEqual(baseline)
            const name = `${profile}:${round}`, shape = await geometry(frame)
            expect(shape, `${name}: stable initial geometry and row identities`).toEqual(baseline)
            shapes.push({ name, ...shape })
            const firstCall = calls.length, before = await sqlCounts()
            await probe.scroll(name, frame)
            const after = await sqlCounts(), gestureCalls = calls.slice(firstCall)
            const deltas = Object.entries(after.rpcStatements).map(([id, count]) => ({ id, sql: count - (before.rpcStatements[id] ?? 0) })).filter(item => item.sql)
            const activityIds = new Set(calls.filter(call => call.name === 'refreshAccountActivity_createServerFn_handler').map(call => call.id))
            const reportSql = deltas.filter(item => !activityIds.has(item.id))
            const activitySql = deltas.filter(item => activityIds.has(item.id)).reduce((sum, item) => sum + item.sql, 0)
            accounting.push({ name, requests: gestureCalls, sqlStatements: after.statements - before.statements, activitySql, reportSql })
            await save()
            expect(gestureCalls.filter(call => call.name !== 'refreshAccountActivity_createServerFn_handler'), `${name}: no report-data RPC`).toEqual([])
            expect(reportSql, `${name}: no report-data SQL`).toEqual([])
            expect(after.statements - before.statements, `${name}: SQL belongs only to preserved account activity`).toBe(activitySql)
          }
        } finally {
          await probe.finish()
          const result = JSON.parse(await readFile(info.outputPath('smoothness.json'), 'utf8'))
          await copyFile(info.outputPath('smoothness.json'), resolve(destination, `${profile.replaceAll(':', '-')}.json`))
          samples.push(...result.samples)
          await writeFile(resolve(destination, 'interactions.json'), JSON.stringify({ ...metadata, samples }, null, 2))
        }
        // Keep diagnostic saving in finally, but do not replace the original
        // geometry/request failure with a secondary "fewer than 20" assertion.
        const result = JSON.parse(await readFile(info.outputPath('smoothness.json'), 'utf8'))
        expect(result.errors).toEqual([])
        expect(result.samples).toHaveLength(rounds)
        let gestureShape: object | undefined
        for (const sample of result.samples) {
          const interaction = sample.interaction
          const shape = { range: interaction.range, point: interaction.point, rows: sample.renderedGridRows }
          gestureShape ??= shape
          expect(shape, `${sample.name}: identical wheel owner geometry`).toEqual(gestureShape)
          expect(interaction.ownerLabel).toBe('document.scrollingElement')
          expect(interaction.outcome).toBe('scrolled')
          expect(interaction.start).toBe(0); expect(interaction.end).toBe(0)
          expect(interaction.amplitude).toBe(1600)
        }
      } finally { await context.close() }
      console.log('PRECOMMIT_SCROLL_PROFILE_COMPLETE', profile)
    }
    expect(samples).toHaveLength(rounds * 4)
  } finally { await save() }
})
