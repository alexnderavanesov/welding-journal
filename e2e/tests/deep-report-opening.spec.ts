import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { editJournalJoint } from '../journal-grid'
import { openDocumentGridColumnMenu, revealDocumentColumn } from '../document-grid'
import { createOpeningRecorder, type OpeningSurface } from '../deep-report-opening-probe'
import { project, total, documentCount, rounds, repeatRounds, firstJoint, firstLine, manualTitle, templateBytes, setupDeepOpeningFixture, cleanupDeepOpeningFixture } from '../deep-report-opening-fixture'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName } from '../rpc'

// Run alone against either saved .output or the current production build.
// Every measured read/save uses the running HTTP application. Direct SQL is
// fixture setup/cleanup or the durable-value oracle after timed reopening.
const enabled = process.env.DEEP_REPORT_OPENING === '1'
test.skip(!enabled, 'Opt-in serial comparison of report opening on a local production build')
test.use({ trace: 'off', video: 'off' })
const reports = [
  { name: 'journal', report: 'weldingJournal', path: '/journal', button: 'Сварочный журнал' },
  { name: 'lnk', report: 'lnk', path: '/lnk', button: 'ЛНК' },
  { name: 'psto', report: 'heatTreatment', path: '/psto', button: 'ПСТО и ТВМТ' },
  { name: 'documents', report: null, path: '/documents', button: 'Документы' },
] as const
type Report = typeof reports[number]
const saveRounds = Number(process.env.DEEP_OPENING_SAVE_ROUNDS ?? 1)
const requestedReports = process.env.DEEP_OPENING_REPORTS?.split(',').map(value => value.trim())
const selectedReports = requestedReports ? reports.filter(report => requestedReports.includes(report.name)) : reports

function validateProfile() {
  expect(Number.isInteger(saveRounds) && saveRounds >= 1 && saveRounds <= 20).toBe(true)
  if (requestedReports) {
    expect(requestedReports.length).toBeGreaterThan(0)
    expect(new Set(requestedReports).size).toBe(requestedReports.length)
    expect(requestedReports.every(name => reports.some(report => report.name === name))).toBe(true)
  }
}

function surface(report: Report): OpeningSurface {
  const root = report.report ? `[data-weld-report-grid="${report.report}"]` : '[data-document-history-grid="generated:weldingJournal"]'
  return { name: report.name, path: report.path, root, frame: `${root} .journal-grid-frame`,
    leaf: report.report ? '.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading)' : '.ag-row[row-id^="document:"]',
    footer: report.report ? '[data-journal-footer]' : '.document-grid-footer' }
}

async function revealReportColumn(page: Page, report: Report, field: string) {
  if (!report.report) return revealDocumentColumn(page, field)
  const grid = page.locator(surface(report).root), viewport = grid.locator('.ag-grid-viewport')
  const header = grid.locator(`.ag-header-cell[col-id="${field}"]`)
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

async function ready(page: Page, report: Report, grouped = false) {
  const target = surface(report), root = page.locator(target.root), frame = page.locator(target.frame)
  await expect(page).toHaveURL(new RegExp(`${report.path}(?:\\?|$)`))
  await expect(frame).toBeVisible()
  if (report.report) await expect(frame).toHaveAttribute('aria-busy', 'false', { timeout: 240_000 })
  else await expect(frame).not.toHaveAttribute('data-journal-updating', '', { timeout: 240_000 })
  await expect(root.locator(grouped ? '.ag-row-group' : target.leaf).first()).toBeVisible({ timeout: 240_000 })
  await expect(root.locator('.ag-row-loading')).toHaveCount(0)
}

async function summaryReady(page: Page, report: Report, count?: number) {
  const root = page.locator(surface(report).root)
  await expect(root.getByText(count === undefined ? /^Найдено:\s*[\d\s]+$/ : `Найдено: ${count}`, { exact: true })).toBeVisible({ timeout: 240_000 })
  await expect(root.getByText('Подсчёт…', { exact: true })).toHaveCount(0)
  await expect(root.getByText('Загрузка…', { exact: true })).toHaveCount(0)
}

function editor(page: Page) {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
}

async function leave(page: Page, report: Report) {
  const other = report.name === 'journal' ? reports[1] : reports[0]
  await page.getByRole('button', { name: other.button, exact: true }).click()
  await ready(page, other)
  await summaryReady(page, other)
  await page.waitForLoadState('networkidle')
}

test.beforeAll(async () => {
  if (!enabled) return
  validateProfile()
  test.setTimeout(600_000)
  await setupDeepOpeningFixture()
})

test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(600_000)
  await cleanupDeepOpeningFixture()
})

test('four report families: delivery, current rows, complete summary, revisits and reading saved records', async ({ browser }, info) => {
  test.setTimeout(1_800_000)
  const results: object[] = [], diagnostics: object[] = []
  const contextOptions = { storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL,
    viewport: { width: 1600, height: 1000 } }
  try {
    // This deliberately separate first opening starts with a fixture-dirtied
    // dispatcher. It is NOT called a simulated binary/application update.
    const prime = await browser.newContext(contextOptions)
    try {
      const page = await prime.newPage(), recorder = await createOpeningRecorder(page, surface(reports[0]))
      page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(60_000)
      try {
        await recorder.measure('dispatcher-dirty-fixture-first-opening', 0, () => page.goto('/journal'),
          () => ready(page, reports[0]), () => summaryReady(page, reports[0]))
        results.push(...recorder.samples); expect(recorder.errors).toEqual([])
      } finally { await recorder.dispose() }
    } finally { await prime.close() }

    for (const report of selectedReports) for (let cold = 0; cold < rounds; cold++) {
      // New context = cold browser HTTP cache; PostgreSQL/OS caches stay warm.
      const context = await browser.newContext(contextOptions)
      try {
        const page = await context.newPage(), target = surface(report)
        page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(60_000)
        const recorder = await createOpeningRecorder(page, target)
        try {
          await recorder.measure('cold-browser-context', cold, () => page.goto(report.path),
            () => ready(page, report), () => summaryReady(page, report))
          if (cold !== rounds - 1) continue
          for (let round = 0; round < repeatRounds; round++) await recorder.measure('warm-browser-reload', round,
            () => page.reload(), () => ready(page, report), () => summaryReady(page, report))
          for (let round = 0; round < repeatRounds; round++) {
            await leave(page, report)
            await recorder.measure('warm-spa-return', round,
              () => page.getByRole('button', { name: report.button, exact: true }).click(),
              () => ready(page, report), () => summaryReady(page, report))
          }
          const search = report.report ? page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })
            : page.getByRole('textbox', { name: 'Поиск документов', exact: true })
          await recorder.measure('fragment-filter', 0, async () => {
            // The documents fixture has the same total before/after this
            // filter. A matching count alone can pass before its debounce.
            const response = report.report ? null : page.waitForResponse(response => {
              if (!rpcName(response.url()).startsWith('listRemoteGeneratedDocumentHistoryGrid_')) return false
              const body = response.request().postData()
              return Boolean(body && (deserializeRpcPayload(body) as { data?: { search?: string } }).data?.search === project)
            })
            await search.fill(project)
            if (response) await (await response).finished()
          },
            async () => { await summaryReady(page, report, report.report ? total : documentCount); await ready(page, report) },
            () => summaryReady(page, report))
          if (report.report) {
            await revealReportColumn(page, report, 'line')
            await page.locator(`${target.root} .ag-header-cell[col-id="line"]`).click({ button: 'right' })
          } else await openDocumentGridColumnMenu(page, 'line')
          await recorder.measure('group-after-fragment-filter', 0,
            () => page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click(),
            () => ready(page, report, true), () => summaryReady(page, report))
          const firstGroup = page.locator(`${target.root} .ag-row-group`).filter({ hasText: firstLine }).first()
          await recorder.measure('expand-filtered-group', 0, () => report.report
            ? page.getByRole('button', { name: `Развернуть группу ${firstLine}`, exact: true }).click()
            : firstGroup.locator('.ag-group-contracted').click(),
          () => ready(page, report), () => summaryReady(page, report))
          const selected = page.locator(`${target.root} ${target.leaf}`).first()
          const selectedId = await selected.getAttribute('row-id')
          await selected.getByRole('checkbox').check()
          await expect(selected.getByRole('checkbox')).toBeChecked()
          for (let round = 0; round < repeatRounds; round++) {
            if (report.report) await page.getByRole('button', { name: `Свернуть группу ${firstLine}`, exact: true }).click()
            else await firstGroup.locator('.ag-group-expanded').click()
            await recorder.measure('reopen-filtered-group', round, () => report.report
              ? page.getByRole('button', { name: `Развернуть группу ${firstLine}`, exact: true }).click()
              : firstGroup.locator('.ag-group-contracted').click(),
            () => ready(page, report), () => summaryReady(page, report))
            await expect(page.locator(`${target.root} .ag-row[row-id="${selectedId}"]`).getByRole('checkbox')).toBeChecked()
          }
          // Group settings and selections must remain independently observable
          // on a return. Expansion restoration differs between report families.
          await leave(page, report)
          await recorder.measure('return-with-filter-and-group', 0,
            () => page.getByRole('button', { name: report.button, exact: true }).click(),
            () => ready(page, report, true), () => summaryReady(page, report, report.report ? total : documentCount))
          await expect(search).toHaveValue(project)
          diagnostics.push({ report: report.name, selectedId, afterGroupedReturn: await page.locator(target.root).evaluate(root => ({
            selectedText: [...root.querySelectorAll('span')].map(el => el.textContent).find(text => /^Выбрано:/.test(text ?? '')),
            expanded: root.querySelectorAll('.ag-row-group[aria-expanded="true"]').length,
          })) })

          for (let saveRound = 0; saveRound < saveRounds; saveRound++) {
            // Restore the same project scope and line-group state BEFORE the
            // write. Restoring it afterwards would warm the read being timed.
            if (await search.inputValue() !== project) await search.fill(project)
            await summaryReady(page, report, report.report ? total : documentCount)
            await ready(page, report, true)
            await revealReportColumn(page, report, 'line')
            const group = page.locator(`${target.root} .ag-row-group`).first()
            await (report.report ? group.locator('.ag-group-value') : group).click({ button: 'right' })
            await page.getByRole('button', { name: 'Свернуть все', exact: true }).click()
            await expect(page.locator(`${target.root} .ag-row-group[aria-expanded="true"]`)).toHaveCount(0)
            if (report.name === 'journal') {
              await revealReportColumn(page, report, 'joint')
              await page.getByRole('button', { name: `Развернуть группу ${firstLine}`, exact: true }).click()
              await ready(page, report)
            }
            await page.waitForLoadState('networkidle')
            if (report.name !== 'journal') {
              await page.getByRole('button', { name: 'Сварочный журнал', exact: true }).click()
              const journalSearch = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })
              await journalSearch.fill(firstJoint)
              await summaryReady(page, reports[0], 1)
              // The document series moves this joint. Expand its actual group,
              // not the original firstLine label from before the previous save.
              const collapsed = page.getByRole('button', { name: /^Развернуть группу / })
              if (await collapsed.count()) await collapsed.first().click()
              await revealReportColumn(page, reports[0], 'joint')
            }
            await expect(page.getByRole('button', { name: firstJoint, exact: true })).toBeVisible()
            const savedJointRowId = await page.getByRole('button', { name: firstJoint, exact: true })
              .evaluate(element => element.closest('.ag-row')?.getAttribute('row-id'))
            expect(savedJointRowId).toBeTruthy()
            await editJournalJoint(page, firstJoint)
            const baseValue = report.name === 'documents' ? `${firstLine}-UPDATED` : `SAVED-${report.name}`
            const value = saveRounds === 1 ? baseValue : `${baseValue}-${String(saveRound + 1).padStart(3, '0')}`
            const moveCheck = report.name === 'documents' ? page.waitForResponse(response =>
              rpcName(response.url()).startsWith('getPstoWeldLineMovePreview_')) : null
            await editor(page).getByLabel(report.name === 'documents' ? 'Линия' : 'Изометрия', { exact: true }).fill(value)
            if (moveCheck) {
              const response = await moveCheck
              expect(response.ok()).toBe(true)
              const payload = await deserializeRpcResponse(await response.text()) as { result: unknown; error?: Error }
              if (payload.error) throw payload.error
              if (payload.result) await page.getByRole('button', { name: /^Подтвердить перенос(?: цепочки)?$/ }).click()
              await expect(editor(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
            }
            await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
            await expect(editor(page)).toBeHidden({ timeout: 240_000 })
            await ready(page, reports[0])
            await summaryReady(page, reports[0], report.name === 'journal' ? total : 1)
            if (report.name === 'journal') await leave(page, report)
            const field = report.report ? 'isometry' : 'line'
            const freshRows = page.locator(report.report
              ? `${target.root} .ag-row[row-id="${savedJointRowId}"]:not(.ag-row-group)`
              : `${target.root} ${target.leaf}`)
            await recorder.measure('reopen-and-read-saved-record', saveRound, async () => {
              await page.getByRole('button', { name: report.button, exact: true }).click()
              await ready(page, report, true)
              await expect(search).toHaveValue(project)
              // Column virtualization is an ordinary visible part of this
              // read workflow; include revealing the column in the timing.
              await revealReportColumn(page, report, 'line')
              const groupValue = report.report ? firstLine : value
              const savedGroup = page.locator(`${target.root} .ag-row.ag-row-group`)
                .filter({ has: page.getByText(groupValue, { exact: true }) })
              await expect(savedGroup).toBeVisible({ timeout: 240_000 })
              if (!report.report) {
                await expect(savedGroup.locator('.ag-group-child-count')).toHaveText('(1)')
                if (saveRound > 0) {
                  const previousLine = `${baseValue}-${String(saveRound).padStart(3, '0')}`
                  await expect(page.locator(`${target.root} .document-grid-group-label`).getByText(previousLine, { exact: true })).toHaveCount(0)
                }
              }
              if (await savedGroup.getAttribute('aria-expanded') !== 'true') {
                if (report.report) await savedGroup.getByRole('button', { name: `Развернуть группу ${groupValue}`, exact: true }).click()
                else await savedGroup.locator('.ag-group-contracted').click()
              }
              await revealReportColumn(page, report, field)
            }, async () => {
              await ready(page, report)
              if (!report.report) await expect.poll(() => freshRows.evaluateAll(rows =>
                new Set(rows.map(row => row.getAttribute('row-id'))).size)).toBe(1)
              await expect(freshRows.locator(`[col-id="${field}"]`)).toBeVisible()
              await expect(freshRows.locator(`[col-id="${field}"]`)).toHaveText(value, { timeout: 240_000 })
            }, () => summaryReady(page, report, report.report ? total : documentCount))
            // The timer ends on the new visible value in the same project
            // query. SQL and a subsequent narrow query are extra oracles only.
            const stored = await withE2eDatabase(async db => (await db.query('select line,isometry from weld_joints where project_title=$1 and joint=$2', [project, firstJoint])).rows[0])
            expect(report.name === 'documents' ? stored.line : stored.isometry).toBe(value)
            await search.fill(report.report ? firstJoint : manualTitle)
            await summaryReady(page, report, 1)
            const openGroup = page.locator(`${target.root} .ag-row-group[aria-expanded="false"]`).first()
            if (await openGroup.count()) {
              if (report.report) await openGroup.getByRole('button', { name: /^Развернуть группу / }).click()
              else await openGroup.locator('.ag-group-contracted').click()
            }
            await ready(page, report)
            await revealReportColumn(page, report, field)
            await expect(page.locator(`${target.root} ${target.leaf}`).locator(`[col-id="${field}"]`)).toContainText(value)
            diagnostics.push({ report: report.name, saveRound, saved: value, savedJointRowId, timedSavedValueVerified: true, durableAndFreshReadVerified: true,
              savedScope: { search: project, groupBy: ['line'], rows: report.report ? total : documentCount } })
          }

          if (report.name === 'documents') {
            // This tab has no direct URL; measure its real first tab opening
            // separately instead of labelling an already loaded shell cold.
            const system: OpeningSurface = { ...target, name: 'documents-system', root: '[data-document-history-grid^="system:lnkRequest:"]',
              frame: '[data-document-history-grid^="system:lnkRequest:"] .journal-grid-frame' }
            const systemRecorder = await createOpeningRecorder(page, system)
            // The current document already exists, so install this surface's
            // probe now as well as on future document navigations.
            const { installOpeningProbe } = await import('../deep-report-opening-probe')
            await page.evaluate(installOpeningProbe, system)
            try {
              const systemReady = async () => {
                await expect(page.locator(system.frame)).not.toHaveAttribute('data-journal-updating', '', { timeout: 240_000 })
                await expect(page.locator(`${system.root} ${system.leaf}`).first()).toBeVisible({ timeout: 240_000 })
              }
              const systemSummary = async () => { await expect(page.locator(system.root).getByText(`Найдено: ${documentCount}`, { exact: true })).toBeVisible({ timeout: 240_000 }) }
              await systemRecorder.measure('first-system-registry-tab', 0,
                () => page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click(), systemReady, systemSummary)
              for (let round = 0; round < repeatRounds; round++) {
                await leave(page, report)
                await systemRecorder.measure('warm-system-registry-return', round,
                  () => page.getByRole('button', { name: 'Документы', exact: true }).click(), systemReady, systemSummary)
              }
              results.push(...systemRecorder.samples); expect(systemRecorder.errors).toEqual([])
            } finally { await systemRecorder.dispose() }
          }
          expect(recorder.errors).toEqual([])
        } finally { results.push(...recorder.samples); await recorder.dispose() }
      } finally { await context.close() }
    }
  } finally {
    const output = { label: process.env.DEEP_OPENING_LABEL ?? 'unlabelled', joints: total,
      manualDocuments: documentCount, systemRequests: documentCount, templateBytes, coldRounds: rounds, repeatRounds, saveRounds,
      selectedReports: selectedReports.map(report => report.name),
      browser: browser.browserType().name(), version: browser.version(), cpuThrottling: 'none',
      limitations: ['Local normal CPU; browser cache cold does not mean OS/PostgreSQL cold',
        'Dispatcher dirty fixture is separate from a binary-update recovery test',
        'Installed Safari requires its separate driver; WebKit is not Safari',
        'Selected report families retain the full fixture; journal preparation/navigation remains available and is not extra family coverage',
        'After-save rounds use ordinary UI writes; project filter and line-group state are restored before each write, never before the timed fresh reopening',
        'reopen-and-read-saved-record includes navigation, finding/expanding the saved line group and revealing its column; observedRowsReadyMs waits for the exact new visible value without changing the project filter, unlike ordinary warm reopening or the historical after-save phase',
        'RAF intervals are not physical FPS; system documents have no direct URL',
        'Large independent document cardinality and concurrent writers are separate profiles'],
      results, diagnostics }
    await writeFile(info.outputPath(`deep-opening-${process.env.DEEP_OPENING_LABEL ?? 'unlabelled'}.json`), JSON.stringify(output, null, 2))
    await info.attach('deep-opening', { body: JSON.stringify(output), contentType: 'application/json' })
  }
})

test('document collapse removes obsolete controls and keyboard reopening preserves selection and ranges', async ({ page }, info) => {
  test.skip(process.env.DEEP_OPENING_ASSERT_NO_REMOVAL_ROWS !== '1', 'Acceptance check for the candidate; separate from saved-bundle timing')
  test.setTimeout(120_000)
  page.setDefaultTimeout(30_000)
  const report = reports[3], target = surface(report), grid = page.locator(target.root)
  await page.addInitScript(() => {
    const holder = window as unknown as { documentSelectionTrace: unknown[] }
    holder.documentSelectionTrace = []
    const snapshot = (stage: string, key?: string) => {
      const root = document.querySelector('[data-document-history-grid="generated:weldingJournal"]')
      holder.documentSelectionTrace.push({ stage, key, time: performance.now(),
        focus: document.activeElement?.closest('[row-id]')?.getAttribute('row-id'),
        checked: [...root?.querySelectorAll('.ag-row[row-id] input[type="checkbox"]') ?? []]
          .filter(element => (element as HTMLInputElement).checked).map(element => element.closest('[row-id]')?.getAttribute('row-id')),
        footer: root?.querySelector('.document-grid-footer')?.textContent,
        stored: Object.keys(sessionStorage).filter(key => key.includes('documents:session:')).map(key => [key, sessionStorage.getItem(key)]),
      })
    }
    for (const type of ['click', 'change', 'keydown', 'keyup']) document.addEventListener(type, event => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-document-history-grid]')) return
      if (!(event instanceof KeyboardEvent) && !event.target.closest('.ag-selection-checkbox')) return
      const key = event instanceof KeyboardEvent ? event.key : event.target.closest('[row-id]')?.getAttribute('row-id') ?? undefined
      snapshot(type, key)
      queueMicrotask(() => snapshot(`${type}:microtask`, key))
      requestAnimationFrame(() => snapshot(`${type}:frame`, key))
    }, true)
  })
  await page.goto(report.path)
  await ready(page, report); await summaryReady(page, report, documentCount)
  const outside = grid.locator(target.leaf).first(), outsideId = await outside.getAttribute('row-id')
  const outsideTitle = await outside.locator('[col-id="title"] button').innerText()
  await outside.getByRole('checkbox').check()
  await openDocumentGridColumnMenu(page, 'line')
  await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
  const group = grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: firstLine }).first()
  await expect(group).toBeVisible()
  await group.focus(); await group.press('Enter')
  await ready(page, report)
  const selected = grid.locator(target.leaf).first(), id = await selected.getAttribute('row-id')
  expect(id).not.toBe(outsideId)
  await selected.getByRole('checkbox').check()
  const previous = await selected.elementHandle()
  expect(previous).not.toBeNull()
  try {
    await group.focus(); await group.press('Enter')
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    // This direct check intentionally does not poll for AG's400ms cleanup.
    // A collapsed row must already have no mounted/focusable controls.
    if (process.env.DEEP_OPENING_ALLOW_REMOVAL_ROWS !== '1') {
      expect(await previous!.evaluate(element => element.isConnected)).toBe(false)
      await expect(grid.locator(`[row-id="${id}"]`)).toHaveCount(0)
    }
    await expect(group).toBeFocused()
    await group.press('Enter')
    await ready(page, report)
    await expect(grid.locator(`[row-id="${id}"]`).getByRole('checkbox')).toBeChecked()
    await expect(grid.getByText('Выбрано: 2', { exact: true })).toBeVisible()
    const cell = grid.locator(`${target.leaf} [col-id="title"]`).first()
    await cell.click({ position: { x: 3, y: 15 } })
    await page.keyboard.press('Shift+ArrowDown')
    await expect(grid.locator('.ag-cell-range-selected')).toHaveCount(2)
    await expect(grid.locator(`[row-id="${id}"]`).getByRole('checkbox')).toBeChecked()
    // Exercise the inverse operation with the same immediate collapse. A fix
    // that merely unions a late selectedNodes snapshot loses this deselect.
    await grid.locator(`[row-id="${id}"]`).getByRole('checkbox').uncheck()
    await group.focus(); await group.press('Enter')
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(group).toBeFocused()
    await group.press('Enter'); await ready(page, report)
    await expect(grid.locator(`[row-id="${id}"]`).getByRole('checkbox')).not.toBeChecked()
    await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(outsideTitle)
    await summaryReady(page, report, 1)
    const outsideGroup = grid.locator('.ag-row-group[aria-expanded="false"]').first()
    if (await outsideGroup.count()) await outsideGroup.locator('.ag-group-contracted').click()
    await ready(page, report)
    await expect(grid.locator(`[row-id="${outsideId}"]`).getByRole('checkbox')).toBeChecked()
    await expect(grid.locator('[role="alert"]')).toHaveCount(0)
  } finally {
    await writeFile(info.outputPath('document-selection-events.json'), JSON.stringify(await page.evaluate(() =>
      (window as unknown as { documentSelectionTrace: unknown[] }).documentSelectionTrace), null, 2))
    await previous?.dispose()
  }
})
