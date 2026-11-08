import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { createOpeningRecorder, installOpeningProbe } from '../deep-report-opening-probe'
import { documentGridRow, revealDocumentColumn } from '../document-grid'

const enabled = process.env.TARGETED_OPENING_MEASUREMENTS === '1'
test.skip(!enabled, 'Opt-in local measurement of returning after another client saves')
test.use({ trace: 'retain-on-failure', video: 'off' })

// A completed diagnostic can record automaticFresh:false. That is a product
// finding, not a passing acceptance check; retain it in the measurement report.
test('five sections: record freshness and recovery after another client saves', async ({ browser }, info) => {
  test.setTimeout(240000)
  const output: object[] = []
  const options = { storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } }
  const readerContext = await browser.newContext(options), writerContext = await browser.newContext(options)
  try {
    await seedSmoothnessFixture()
    const id = await withE2eDatabase(async db => (await db.query('select id from weld_joints where project_title=$1 and line=$2 and joint=$3', [SMOOTHNESS_PROJECT, 'SM-0001', 'F0001'])).rows[0].id)
    // A unique fixture name keeps the same record mounted in all three reports;
    // different default sorts must not turn virtual-row lookup into latency.
    const joint = 'F99123456'
    await withLineProgramFixture(db => db.query('update weld_joints set joint=$1 where id=$2', [joint, id]))
    const reader = await readerContext.newPage(), writer = await writerContext.newPage()
    const ready = async (page: typeof reader) => {
      await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 })
      await expect(page.locator('.journal-grid-frame .ag-row[row-id]').first()).toBeVisible()
    }
    await writer.goto('/journal')
    await writer.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(joint)
    await expect(writer.getByText('Найдено: 1', { exact: true })).toBeVisible({ timeout: 60000 })
    for (const [route, name, report] of [['journal', 'Сварочный журнал', 'weldingJournal'], ['lnk', 'ЛНК', 'lnk'], ['psto', 'ПСТО и ТВМТ', 'heatTreatment']] as const) {
      await reader.bringToFront()
      await reader.goto(`/${route}`)
      await reader.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(joint)
      await expect(reader.getByText('Найдено: 1', { exact: true })).toBeVisible({ timeout: 60000 })
      const viewport = reader.locator('[data-weld-report-grid] .ag-grid-viewport')
      const header = reader.locator('[data-weld-report-grid] .ag-header-cell[col-id="isometry"]')
      for (let step = 0; step < 20 && !await header.count(); step++) {
        await viewport.evaluate(element => { element.scrollLeft += Math.max(100, element.clientWidth / 2) })
        await reader.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      }
      await header.scrollIntoViewIfNeeded()
      await reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Документы', exact: true }).click()
      await expect(reader.locator('[data-document-history-grid] .ag-row').first()).toBeVisible()
      await reader.waitForLoadState('networkidle')

      await writer.bringToFront()
      await editJournalJoint(writer, id)
      const dialog = writer.getByRole('dialog').filter({ has: writer.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
      const value = `FRESH-${route}-${Date.now()}`
      await dialog.getByLabel('Изометрия', { exact: true }).fill(value)
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(dialog).toBeHidden({ timeout: 60000 })
      await ready(writer)
      expect(await withE2eDatabase(async db => (await db.query('select isometry from weld_joints where id=$1', [id])).rows[0].isometry)).toBe(value)

      await reader.bringToFront()
      const root = `[data-weld-report-grid="${report}"]`
      const recorder = await createOpeningRecorder(reader, { name: route, path: `/${route}`, root, frame: `${root} .journal-grid-frame`, leaf: '.ag-row[row-id]:not(.ag-row-loading)', footer: '[data-journal-footer]' })
      // Recorder was created on a live page; install its observer there before SPA navigation.
      await reader.evaluate(installOpeningProbe, { name: route, path: `/${route}`, root, frame: `${root} .journal-grid-frame`, leaf: '.ag-row[row-id]:not(.ag-row-loading)', footer: '[data-journal-footer]' })
      await reader.evaluate(({ root, value, id }) => {
        const state = { started: performance.now(), freshMs: null as number | null }
        Object.assign(window, { targetedFreshness: state })
        const observer = new MutationObserver(() => {
          const cell = document.querySelector(`${root} .ag-row[row-id="${id}"] [col-id="isometry"]`)
          if (cell?.textContent?.trim() === value) { state.freshMs = performance.now() - state.started; observer.disconnect() }
        })
        observer.observe(document, { subtree: true, childList: true, characterData: true })
      }, { root, value, id })
      try {
        const cell = reader.locator(`${root} .ag-row[row-id="${id}"] [col-id="isometry"]`)
        const refresh = reader.getByRole('button', { name: 'Обновить таблицу', exact: true })
        const sample = await recorder.measure('return-after-other-client-save', 0,
          () => reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name, exact: true }).click(),
          () => expect.poll(async () => await cell.textContent({ timeout: 200 }).catch(() => '') === value || await refresh.isVisible(), { timeout: 10000 }).toBe(true), async () => {})
        const automaticFresh = await cell.textContent({ timeout: 200 }).catch(() => '') === value
        let manualRefreshMs: number | null = null
        if (!automaticFresh) {
          // Preserve the failed automatic return; recovery is a separate action.
          await reader.screenshot({ path: info.outputPath(`${route}-needs-refresh.png`) })
          const started = performance.now()
          await refresh.click(); await ready(reader)
          await expect(cell).toHaveText(value, { timeout: 60000 })
          manualRefreshMs = performance.now() - started
        }
        const fresh = await reader.evaluate(() => (window as unknown as { targetedFreshness: { freshMs: number | null } }).targetedFreshness)
        expect(fresh.freshMs).not.toBeNull()
        output.push({ ...sample, automaticFresh, manualRefreshMs, freshMs: automaticFresh ? fresh.freshMs : null })
      } finally { await recorder.dispose() }
    }

    const measureReturn = async (name: string, path: string, root: string, button: string, selector: string, expected: string) => {
      await reader.bringToFront()
      const target = { name, path, root, frame: name === 'program' ? root : `${root} .journal-grid-frame`, leaf: '.ag-row[row-id]:not(.ag-row-loading)', footer: '.document-grid-footer' }
      const recorder = await createOpeningRecorder(reader, target)
      await reader.evaluate(installOpeningProbe, target)
      await reader.evaluate(({ selector, expected }) => {
        const state = { started: performance.now(), freshMs: null as number | null }
        Object.assign(window, { targetedFreshness: state })
        const observer = new MutationObserver(() => {
          if (document.querySelector(selector)?.textContent?.includes(expected)) { state.freshMs = performance.now() - state.started; observer.disconnect() }
        })
        observer.observe(document, { subtree: true, childList: true, characterData: true })
      }, { selector, expected })
      try {
        const sample = await recorder.measure('return-after-other-client-save', 0,
          () => reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: button, exact: true }).click(),
          () => expect(reader.locator(selector)).toBeVisible({ timeout: 30000 }), async () => {})
        let automaticFresh = false
        try { await expect(reader.locator(selector)).toContainText(expected, { timeout: 5000 }); automaticFresh = true }
        catch { /* Record stale data explicitly; this is not an acceptance pass. */ }
        let manualReloadMs: number | null = null
        if (!automaticFresh) {
          await reader.screenshot({ path: info.outputPath(`${name}-stale-return.png`) })
          const started = performance.now()
          await reader.reload()
          await expect(reader.locator(selector)).toContainText(expected, { timeout: 60000 })
          manualReloadMs = performance.now() - started
        }
        const fresh = await reader.evaluate(() => (window as unknown as { targetedFreshness?: { freshMs: number | null } }).targetedFreshness ?? { freshMs: null })
        if (automaticFresh) expect(fresh.freshMs).not.toBeNull()
        output.push({ ...sample, automaticFresh, manualReloadMs, freshMs: automaticFresh ? fresh.freshMs : null })
      } finally { await recorder.dispose() }
    }

    await reader.goto('/line-program')
    await reader.getByLabel('Поиск программы линий', { exact: true }).fill('SM-0001')
    const common = '[data-program-grid="lines"] .ag-row[data-line="SM-0001"] [col-id="common"]'
    await expect(reader.locator(common)).toContainText('0 / 80', { timeout: 60000 })
    await reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Документы', exact: true }).click()
    await expect(reader.locator('[data-document-history-grid] .ag-row').first()).toBeVisible()
    await writer.bringToFront()
    await editJournalJoint(writer, id)
    const editor = writer.getByRole('dialog').filter({ has: writer.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    await editor.getByRole('button', { name: 'Назначение контроля', exact: true }).click()
    await editor.getByText('Назначение УЗК', { exact: true }).locator('..').getByRole('button', { name: 'Да', exact: true }).click()
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden({ timeout: 60000 })
    expect(await withE2eDatabase(async db => (await db.query('select has_uzk from weld_joints where id=$1', [id])).rows[0].has_uzk)).toBe('да')
    await measureReturn('program', '/line-program', '[data-program-grid="lines"]', 'Программа линий', common, '1 / 80')

    await reader.goto('/documents')
    await expect(reader.getByText('Найдено: 100', { exact: true })).toBeVisible({ timeout: 60000 })
    await reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: 'Сварочный журнал', exact: true }).click()
    await ready(reader)
    await writer.bringToFront(); await writer.goto('/documents')
    const title = await writer.locator('[data-document-history-grid] .ag-row [col-id="title"] button').first().textContent()
    const documentRow = await documentGridRow(writer, title!)
    await revealDocumentColumn(writer, '__actions')
    await documentRow.actions.getByRole('button', { name: 'Удалить документ', exact: true }).click()
    const confirmation = writer.getByRole('dialog').filter({ has: writer.getByRole('heading', { name: 'Удалить документ', exact: true }) })
    await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(writer.getByText('Найдено: 99', { exact: true })).toBeVisible({ timeout: 60000 })
    await measureReturn('documents', '/documents', '[data-document-history-grid]', 'Документы', '[data-document-history-grid] .document-grid-footer', 'Найдено: 99')
  } finally {
    await writeFile(info.outputPath('return-freshness.json'), JSON.stringify({ browser: browser.browserType().name(), version: browser.version(), samples: output }, null, 2))
    await readerContext.close(); await writerContext.close(); await cleanupSmoothnessFixture()
  }
})
