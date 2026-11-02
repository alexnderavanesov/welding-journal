import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { setupDeepOpeningFixture, cleanupDeepOpeningFixture, project, total, documentCount, firstLine } from '../deep-report-opening-fixture'
import { openDocumentGridFilter, revealDocumentColumn } from '../document-grid'
import { observeMixedClient } from '../mixed-resource-telemetry'
import { rpcName } from '../rpc'

// Run serially on the same saved/current production bundles as deep opening.
// Only fixture setup/cleanup touches SQL. Every lifecycle action uses the UI.
const enabled = process.env.DEEP_REPORT_LIFECYCLE === '1'
const rounds = 20, checkpointRounds = new Set([4, 9, 19])
test.skip(!enabled, 'Opt-in Chrome retained-memory comparison; no Safari heap approximation')
test.use({ trace: 'off', video: 'off' })
const surfaces = [
  { name: 'journal', path: '/journal', button: 'Сварочный журнал', report: 'weldingJournal', root: '[data-weld-report-grid="weldingJournal"]' },
  { name: 'lnk', path: '/lnk', button: 'ЛНК', report: 'lnk', root: '[data-weld-report-grid="lnk"]' },
  { name: 'psto', path: '/psto', button: 'ПСТО и ТВМТ', report: 'heatTreatment', root: '[data-weld-report-grid="heatTreatment"]' },
  { name: 'documents-generated', path: '/documents', button: 'Документы', report: null, root: '[data-document-history-grid="generated:weldingJournal"]' },
  { name: 'documents-system', path: '/documents', button: 'Заявка ЛНК', report: null, root: '[data-document-history-grid^="system:lnkRequest:"]' },
] as const
type Surface = typeof surfaces[number]
const leafSelector = (surface: Surface) => surface.report
  ? '.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading)' : '.ag-row[row-id^="document:"]'

function classifyConsoleErrors(messages: string[]) {
  // Exact seven-line missing-key banner emitted by the installed AG Grid
  // LicenseManager (124 columns). Keep all raw messages in the artifact;
  // invalid/expired keys, AG runtime errors and unrelated errors still fail.
  const center = (text: string) => text.padStart((124 - text.length) / 2 + text.length, '*').padEnd(124, '*')
  const banner = [center(''), center(' AG Grid Enterprise License '), center(' License Key Not Found '),
    '* All AG Grid Enterprise features are unlocked for trial.'.padEnd(123, ' ') + '*',
    '* If you want to hide the watermark please email info@ag-grid.com for a trial license key.'.padEnd(123, ' ') + '*',
    center(''), center('')]
  const licenseBanners: string[][] = [], runtimeErrors: string[] = []
  for (let index = 0; index < messages.length;) {
    if (banner.every((line, offset) => messages[index + offset] === line)) {
      licenseBanners.push(messages.slice(index, index + banner.length)); index += banner.length
    } else runtimeErrors.push(messages[index++])
  }
  return { licenseBanners, runtimeErrors }
}

async function ready(page: Page, surface: Surface, count?: number, leaves = false) {
  const root = page.locator(surface.root), frame = root.locator('.journal-grid-frame')
  await expect(page).toHaveURL(new RegExp(`${surface.path}(?:\\?|$)`))
  await expect(frame).toBeVisible()
  if (surface.report) await expect(frame).toHaveAttribute('aria-busy', 'false', { timeout: 240_000 })
  else await expect(frame).not.toHaveAttribute('data-journal-updating', '', { timeout: 240_000 })
  await expect(root.locator(leaves ? leafSelector(surface) : '.ag-row[row-id]:not(.ag-row-loading)').first()).toBeVisible({ timeout: 240_000 })
  await expect(root.locator('.ag-row-loading, .ag-row.ag-opacity-zero')).toHaveCount(0)
  await expect(root.getByText(count === undefined ? /^Найдено:\s*[\d\s]+$/ : `Найдено: ${count}`, { exact: true })).toBeVisible({ timeout: 240_000 })
  await expect(root.getByText(/^(Подсчёт…|Загрузка…)$/, { exact: true })).toHaveCount(0)
}

async function revealLine(page: Page, surface: Surface) {
  if (!surface.report) return revealDocumentColumn(page, 'line')
  const root = page.locator(surface.root), viewport = root.locator('.ag-grid-viewport')
  const header = root.locator('.ag-header-cell[col-id="line"]')
  await viewport.evaluate(element => { element.scrollLeft = 0 })
  const steps = await viewport.evaluate(element => Math.ceil(element.scrollWidth / Math.max(element.clientWidth / 2, 1)) + 1)
  for (let step = 0; step <= steps; step++) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    if (await header.count()) { await header.scrollIntoViewIfNeeded(); return header }
    await viewport.evaluate(element => { element.scrollLeft += Math.max(element.clientWidth / 2, 1) })
  }
  await expect(header).toBeVisible()
  return header
}

async function openLineFilter(page: Page, surface: Surface) {
  if (!surface.report) return openDocumentGridFilter(page, 'line', 'Линия')
  await (await revealLine(page, surface)).locator('.ag-header-cell-filter-button').click()
  const dialog = page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function setGroupExpanded(page: Page, surface: Surface, expanded: boolean) {
  const root = page.locator(surface.root), group = root.locator('.ag-row-group').filter({ hasText: firstLine }).first()
  await expect(group).toBeVisible()
  if (await group.getAttribute('aria-expanded') !== String(expanded)) {
    if (surface.report) await root.getByRole('button', { name: `${expanded ? 'Развернуть' : 'Свернуть'} группу ${firstLine}`, exact: true }).click()
    else await group.locator(expanded ? '.ag-group-contracted' : '.ag-group-expanded').click()
  }
  await expect(group).toHaveAttribute('aria-expanded', String(expanded))
  if (!expanded) await expect(root.locator(leafSelector(surface))).toHaveCount(0)
}

test.beforeAll(async ({ browserName }) => {
  if (!enabled || browserName !== 'chromium') return
  test.setTimeout(600_000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD, 'Lifecycle comparisons require the saved/current production bundle').toBe('1')
  expect(total, 'Keep this lifecycle profile identical to the 9k opening fixture').toBe(9000)
  expect(documentCount).toBe(250)
  await setupDeepOpeningFixture()
})
test.afterAll(async ({ browserName }) => {
  if (!enabled || browserName !== 'chromium' || process.env.E2E_USE_PRODUCTION_BUILD !== '1') return
  test.setTimeout(600_000)
  await cleanupDeepOpeningFixture()
})

test('twenty SPA cycles retain bounded grids and expose post-GC heap, DOM and listener trends', async ({ browser, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Chrome CDP only; WebKit is not installed Safari')
  test.setTimeout(1_800_000)
  const origin = new URL(String(info.project.use.baseURL))
  expect(origin.hostname).toBe('127.0.0.1')
  expect(origin.protocol).toBe('http:')
  const context = await browser.newContext({ baseURL: origin.origin, storageState: process.env.E2E_AUTH_STATE,
    viewport: { width: 1600, height: 1000 } })
  const telemetry = observeMixedClient(context, 'deep-report-lifecycle')
  const page = await context.newPage(), cdp = await context.newCDPSession(page)
  page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(60_000)
  const consoleErrors: string[] = [], actions: object[] = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  const checkpoints: Array<{ round: number; surface: string; heapUsedBytes: number; heapTotalBytes: number;
    domNodes: number; documents: number; listeners: number; attachedNodes: number; attachedGridRows: number;
    mountedGridRoots: number; renderedLeaves: number; rowHeight: number; viewportHeight: number; rowLimit: number; unfinishedRpc: string[] }> = []
  let step = 'initial', timeOrigin: number | undefined, completedRounds = 0
  const cancellations: Array<{ step: string; name: string; error: string | null }> = []
  page.on('requestfailed', request => {
    if (request.url().includes('/_serverFn/')) cancellations.push({ step, name: rpcName(request.url()), error: request.failure()?.errorText ?? null })
  })
  const checkNetwork = () => {
    expect(telemetry.errors).toEqual([])
    // These read hooks explicitly abort obsolete counts/blocks on regroup or
    // unmount. Keep each cancellation and its action in the evidence. Genuine
    // network errors, aborted writes and unexpected GETs must still fail.
    for (const failure of telemetry.expectedFailures) expect(failure).toMatch(
      /^(?:readJournalGrid|getJournalReportSummary|getDispatcherTaskContext|readReportOutputSnapshot|summarizeJournalGridArea|summarizeJournalGridRange|summarizeJournalGridSelection)(?:_[^:]*)?: net::ERR_ABORTED$/,
    )
  }
  const idle = async () => {
    // A load-state event belongs to the document's initial navigation and can
    // already be satisfied on every later SPA action. Require a fresh quiet
    // interval so debounced range/area summaries finish before GC/checkpoints.
    let started = -1, quietSince = performance.now()
    await expect.poll(() => {
      if (telemetry.pending.size || telemetry.rpcStarted !== started) {
        started = telemetry.rpcStarted; quietSince = performance.now()
        return false
      }
      return performance.now() - quietSince >= 500
    }, { timeout: 240_000, intervals: [50], message: 'No pending or newly started RPC for 500ms' }).toBe(true)
    await telemetry.summary() // Flush response-size promises before taking a call-count boundary.
  }
  const save = async () => {
    const deltas = checkpoints.filter(item => item.round > 4).map(item => {
      const initial = checkpoints.find(candidate => candidate.round === 4 && candidate.surface === item.surface)!
      return { surface: item.surface, fromRound: 4, toRound: item.round,
        heapUsedBytes: item.heapUsedBytes - initial.heapUsedBytes, domNodes: item.domNodes - initial.domNodes,
        listeners: item.listeners - initial.listeners, attachedNodes: item.attachedNodes - initial.attachedNodes }
    })
    await writeFile(info.outputPath('deep-report-lifecycle.json'), JSON.stringify({
      label: process.env.DEEP_LIFECYCLE_LABEL ?? 'unlabelled', browser: browser.browserType().name(), version: browser.version(),
      joints: total, generatedDocuments: documentCount, systemDocuments: documentCount,
      rounds, completedRounds, step, checkpoints, deltas, actions, rpc: await telemetry.summary(), cancellations, consoleErrors,
      consoleClassification: classifyConsoleErrors(consoleErrors), productionBuild: process.env.E2E_USE_PRODUCTION_BUILD === '1',
      scope: 'One document/context; 20 SPA cycles through journal, LNK, PSTO, generated documents and the LNK-request tab. Popup line fragment → select found → group collapse/open/reopen on every surface.',
      interpretation: ['GC occurs only at fixed checkpoints outside action timings, after RPC/DOM settling.',
        'Round 4 is the post-warmup reference; compare equal surfaces at rounds 9 and 19 and paired saved/current builds.',
        'CDP DOM counters include detached nodes; attached DOM counts are recorded separately. Growth alone is not proof of a leak.',
        'No arbitrary MiB/listener acceptance threshold. Instrumented action durations are diagnostics, not performance claims.',
        'Chrome only; no Safari heap measurements, renderer RSS or server-memory inference.'] }, null, 2))
  }
  const measure = async (round: number, surface: Surface, action: string, run: () => Promise<unknown>, count?: number, leaves = false) => {
    await idle()
    step = `${round}:${surface.name}:${action}`
    const from = telemetry.calls.length, started = performance.now()
    await run(); await ready(page, surface, count, leaves)
    await expect.poll(() => telemetry.pending.size, { timeout: 240_000 }).toBe(0)
    const instrumentedReadyMs = performance.now() - started
    await idle()
    const calls = telemetry.calls.slice(from)
    actions.push({ round, surface: surface.name, action, instrumentedReadyMs, rpc: calls.length,
      responseBodyBytes: calls.reduce((sum, call) => sum + call.bytes, 0), calls })
    checkNetwork(); expect(classifyConsoleErrors(consoleErrors).runtimeErrors).toEqual([])
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
    await expect(page.locator('[data-weld-report-grid], [data-document-history-grid]')).toHaveCount(1)
  }
  try {
    await page.goto('/journal'); await ready(page, surfaces[0]); await idle()
    timeOrigin = await page.evaluate(() => performance.timeOrigin)
    for (let round = 0; round < rounds; round++) {
      for (const surface of surfaces) {
        await measure(round, surface, 'spa-open', async () => {
          if (!(round === 0 && surface.name === 'journal')) await page.getByRole('button', { name: surface.button, exact: true }).click()
          if (surface.name === 'documents-generated') {
            // A revisit first restores the previously active system tab. Let
            // that real mount finish before selecting the generated registry.
            await expect(page.locator('[data-document-history-grid]')).toBeVisible()
            await idle()
            if (!await page.locator(surface.root).count()) await page.getByRole('button', { name: 'ЖСР', exact: true }).click()
          }
        }, round ? 100 : undefined)
        if (round === 0) await measure(round, surface, 'fixture-project-scope', async () => {
          const search = surface.report ? page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })
            : page.getByRole('textbox', { name: 'Поиск документов', exact: true })
          await search.fill(project)
        }, surface.report ? total : documentCount)
        await measure(round, surface, 'popup-reset-line', async () => {
          const filter = await openLineFilter(page, surface)
          await filter.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
        }, surface.report ? total : documentCount)
        await measure(round, surface, 'popup-fragment-select-found', async () => {
          const filter = page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true })
          await filter.getByRole('textbox', { name: 'Найти значение фильтра', exact: true }).fill(firstLine)
          await expect(filter.locator('.journal-filter-values')).toHaveAttribute('aria-busy', 'false')
          await expect(filter.locator('.journal-filter-option')).toHaveCount(1)
          await expect(filter.locator('.journal-filter-option')).toContainText(firstLine)
          await filter.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
          await filter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
        }, 100)
        if (round === 0) await measure(round, surface, 'group-line', async () => {
          await (await revealLine(page, surface)).click({ button: 'right' })
          await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
          await expect(page.locator(surface.root).locator('.ag-row-group').first()).toBeVisible()
        }, 100)
        await measure(round, surface, 'group-open', async () => {
          await setGroupExpanded(page, surface, false)
          await setGroupExpanded(page, surface, true)
        }, 100, true)
        await measure(round, surface, 'group-reopen', async () => {
          await setGroupExpanded(page, surface, false)
          await setGroupExpanded(page, surface, true)
        }, 100, true)
        if (checkpointRounds.has(round)) {
          step = `${round}:${surface.name}:post-gc-checkpoint`
          await idle(); await ready(page, surface, 100, true)
          await cdp.send('HeapProfiler.collectGarbage')
          const heap = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters')
          const attached = await page.evaluate(({ rootSelector, leaf, report }) => {
            const root = document.querySelector(rootSelector)!, viewport = root.querySelector<HTMLElement>('.ag-grid-viewport')!
            const firstRow = root.querySelector<HTMLElement>(leaf)!
            const rowHeight = firstRow.getBoundingClientRect().height
            return { attachedNodes: document.querySelectorAll('*').length,
              attachedGridRows: document.querySelectorAll('.ag-row[row-id]').length,
              mountedGridRoots: document.querySelectorAll('[data-weld-report-grid], [data-document-history-grid]').length,
              renderedLeaves: root.querySelectorAll(leaf).length, rowHeight, viewportHeight: viewport.clientHeight,
              // Existing Chrome journal gate (<80); document gate uses its
              // visible rows + two 6-row buffers + four boundary rows.
              rowLimit: report ? 79 : Math.ceil(viewport.clientHeight / rowHeight) + 16 }
          }, { rootSelector: surface.root, leaf: leafSelector(surface), report: surface.report })
          const unfinishedRpc = [...telemetry.pending.keys()].map(request => new URL(request.url()).pathname)
          checkpoints.push({ round, surface: surface.name, heapUsedBytes: heap.usedSize, heapTotalBytes: heap.totalSize,
            domNodes: dom.nodes, documents: dom.documents, listeners: dom.jsEventListeners, ...attached, unfinishedRpc })
          expect(unfinishedRpc).toEqual([])
          expect(attached.mountedGridRoots).toBe(1)
          expect(attached.rowHeight).toBeGreaterThan(0)
          expect(Number.isFinite(attached.rowLimit)).toBe(true)
          expect(attached.renderedLeaves).toBeGreaterThan(0)
          expect(attached.renderedLeaves).toBeLessThanOrEqual(attached.rowLimit)
          if (surface.report) expect(attached.attachedGridRows).toBeLessThan(80)
          await save()
          // Opt-in diagnosis only, after recording the comparable checkpoint.
          // Chunks live in the Node runner, not in the page whose heap we measure.
          if (process.env.DEEP_LIFECYCLE_HEAP === '1' && surface.name === 'documents-system' && (round === 4 || round === 19)) {
            const chunks: string[] = []
            const collect = ({ chunk }: { chunk: string }) => { chunks.push(chunk) }
            cdp.on('HeapProfiler.addHeapSnapshotChunk', collect)
            try {
              await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
              await writeFile(info.outputPath(`heap-round-${round}.heapsnapshot`), chunks.join(''))
            } finally { cdp.off('HeapProfiler.addHeapSnapshotChunk', collect) }
          }
        }
      }
      completedRounds = round + 1
      console.log('DEEP_LIFECYCLE_ROUND', JSON.stringify({ round, checkpoints: checkpoints.length, actions: actions.length }))
    }
    expect(checkpoints).toHaveLength(checkpointRounds.size * surfaces.length)
    checkNetwork(); expect(classifyConsoleErrors(consoleErrors).runtimeErrors).toEqual([])
    step = 'complete'
  } finally {
    try { await save() } finally { await cdp.detach(); await context.close() }
  }
})
