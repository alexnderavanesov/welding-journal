import { expect, test, type Page, type Request, type Response } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { createOpeningRecorder, installOpeningProbe } from '../deep-report-opening-probe'
import { documentGridRow, revealDocumentColumn } from '../document-grid'
import { auditSqlCount } from '../audit-sql'
import { deserializeRpcPayload, rpcName } from '../rpc'

const enabled = process.env.TARGETED_OPENING_MEASUREMENTS === '1'
test.skip(!enabled, 'Opt-in local measurement of returning after another client saves')
test.use({ trace: 'retain-on-failure', video: 'off' })

async function viewSnapshot(page: Page, root: string, selector: string) {
  return page.evaluate(({ root, selector }) => {
    const element = document.querySelector(root)
    const visibleText = (role: string) => [...document.querySelectorAll(`[role="${role}"]`)]
      .filter(node => node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible')
      .map(node => node.textContent)
    return { target: document.querySelector(selector)?.textContent?.trim() ?? null,
      rows: [...element?.querySelectorAll('.ag-row[row-id]') ?? []].slice(0, 100).map(row => ({
        id: row.getAttribute('row-id'), line: row.getAttribute('data-line'),
        values: Object.fromEntries(['isometry', 'common', 'title'].map(column =>
          [column, row.querySelector(`[col-id="${column}"]`)?.textContent?.trim() ?? null])),
      })), updating: element?.querySelector('.journal-grid-frame')?.hasAttribute('data-journal-updating') ?? false,
      alerts: visibleText('alert'),
      statuses: visibleText('status') }
  }, { root, selector })
}

test('five sections: automatic freshness and separate recovery after another client saves', async ({ browser }, info) => {
  // Test infrastructure allowance, not a product latency target.
  test.setTimeout(600000)
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
    const measureReturn = async (name: string, path: string, root: string, button: string, selector: string,
      expected: string, before: Awaited<ReturnType<typeof viewSnapshot>>, mutation: object) => {
      await reader.bringToFront()
      const isReport = ['journal', 'lnk', 'psto'].includes(name)
      const target = { name, path, root, frame: name === 'program' ? root : `${root} .journal-grid-frame`,
        leaf: '.ag-row[row-id]:not(.ag-row-loading)', footer: isReport ? '[data-journal-footer]' : '.document-grid-footer' }
      const recorder = await createOpeningRecorder(reader, target)
      await reader.evaluate(installOpeningProbe, target)
      type RpcCall = { phase: 'automatic' | 'recovery'; name: string; data?: unknown; startedMs: number; finishedMs?: number; status?: number; failure?: string }
      const calls: RpcCall[] = [], byRequest = new Map<Request, RpcCall>()
      let phase: RpcCall['phase'] = 'automatic'
      const started = performance.now()
      const onRequest = (request: Request) => {
        const name = rpcName(request.url())
        if (!name) return
        const call: RpcCall = { phase, name, startedMs: performance.now() - started }
        try {
          const encoded = request.postData() ?? new URL(request.url()).searchParams.get('payload')
          if (encoded) call.data = deserializeRpcPayload(encoded)
        } catch { /* Retain request identity/completion even if payload decoding fails. */ }
        calls.push(call); byRequest.set(request, call)
      }
      const onResponse = (response: Response) => { const call = byRequest.get(response.request()); if (call) call.status = response.status() }
      const onFinished = (request: Request) => { const call = byRequest.get(request); if (call) call.finishedMs = performance.now() - started }
      const onFailed = (request: Request) => {
        onFinished(request)
        const call = byRequest.get(request); if (call) call.failure = request.failure()?.errorText ?? 'failed'
      }
      reader.on('request', onRequest); reader.on('response', onResponse)
      reader.on('requestfinished', onFinished); reader.on('requestfailed', onFailed)
      const refreshRpc = isReport ? /^readJournalGrid(?:Blocks)?_/ : name === 'program' ? /^getLineProgramSection_/ : /^listRemoteGeneratedDocumentHistoryGrid_/
      const waitUntilReady = async () => {
        await expect(reader.locator(root)).toBeVisible({ timeout: 60000 })
        // A cached first row is not completion of the new visit's refresh.
        await expect.poll(() => {
          const reads = calls.filter(call => call.phase === phase && refreshRpc.test(call.name))
          return reads.length > 0 && reads.every(call => call.finishedMs !== undefined)
        }, { timeout: 60000, message: `${name}: finish the actual ${phase} visit read` }).toBe(true)
        if (isReport) await ready(reader)
        else if (name === 'program') {
          await expect(reader.getByTestId('line-program').getByRole('status')).toHaveCount(0, { timeout: 60000 })
          await expect(reader.getByRole('button', { name: 'Расчёт итогов раздела', exact: true })).toBeEnabled({ timeout: 60000 })
        } else {
          await expect(reader.locator(target.frame)).not.toHaveAttribute('data-journal-updating', '', { timeout: 60000 })
          await expect(reader.locator(`${root} .ag-row-loading`)).toHaveCount(0, { timeout: 60000 })
          await expect(reader.locator(`${root} .document-grid-footer`)).not.toContainText('Загрузка…', { timeout: 60000 })
        }
        await expect(reader.locator(selector)).toBeVisible({ timeout: 60000 })
      }
      const assertFresh = async () => {
        if (isReport) {
          await expect(reader.locator(selector)).toHaveText(expected, { timeout: 60000 })
          await expect(reader.getByRole('button', { name: 'Обновить таблицу', exact: true })).toBeHidden()
        } else {
          await expect(reader.locator(selector)).toContainText(expected, { timeout: 60000 })
          if ('deletedDocumentId' in mutation && typeof mutation.deletedDocumentId === 'string') {
            await expect(reader.locator(`${root} .ag-row[row-id="${mutation.deletedDocumentId}"]`)).toHaveCount(0)
          }
        }
      }
      const diagnostic: Record<string, unknown> = { surface: name, before, mutation, expected, automaticFresh: false, requests: calls }
      output.push(diagnostic)
      let failure: unknown
      const sqlBefore = await auditSqlCount()
      try {
        try {
          diagnostic.automatic = await recorder.measure('return-after-other-client-save', 0,
            () => reader.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name: button, exact: true }).click(),
            waitUntilReady, assertFresh)
          diagnostic.automaticFresh = true
        } catch (error) {
          failure = error; diagnostic.automaticError = String(error)
        }
        const sqlAfter = await auditSqlCount()
        diagnostic.automaticSqlStatements = sqlBefore !== undefined && sqlAfter !== undefined ? sqlAfter - sqlBefore : null
        diagnostic.afterAutomatic = await viewSnapshot(reader, root, selector)
        // Record the acceptance failure before trying recovery; recovery cannot
        // turn this visit into a passing automatic-freshness check.
        expect.soft(diagnostic.automaticFresh, `${name}: automatic return must expose current data; ${String(failure ?? '')}`).toBe(true)
        expect.soft(recorder.errors, `${name}: browser errors`).toEqual([])
        if (failure) {
          await reader.screenshot({ path: info.outputPath(`${name}-stale-return.png`) })
          const recoverySqlBefore = await auditSqlCount()
          phase = 'recovery'
          try {
            diagnostic.recovery = await recorder.measure('manual-recovery-after-failed-automatic-return', 0,
              () => isReport ? reader.getByRole('button', { name: 'Обновить таблицу', exact: true }).click() : reader.reload(),
              waitUntilReady, assertFresh)
          } catch (error) {
            diagnostic.recoveryError = String(error)
            expect.soft(false, `${name}: manual recovery failed: ${String(error)}`).toBe(true)
          } finally {
            diagnostic.afterRecovery = await viewSnapshot(reader, root, selector)
            const recoverySqlAfter = await auditSqlCount()
            diagnostic.recoverySqlStatements = recoverySqlBefore !== undefined && recoverySqlAfter !== undefined ? recoverySqlAfter - recoverySqlBefore : null
          }
        }
      } finally {
        diagnostic.rpcCounts = Object.fromEntries(['automatic', 'recovery'].map(part => [part,
          calls.filter(call => call.phase === part).reduce<Record<string, number>>((counts, call) => {
            counts[call.name] = (counts[call.name] ?? 0) + 1; return counts
          }, {})]))
        reader.off('request', onRequest); reader.off('response', onResponse)
        reader.off('requestfinished', onFinished); reader.off('requestfailed', onFailed)
        // Preserve the snapshot, error and RPCs even when measure throws before
        // publishing its usual successful timing sample.
        await recorder.dispose()
        await writeFile(info.outputPath('return-freshness.json'), JSON.stringify({ protocol: 'automatic-return-acceptance-v2', browser: browser.browserType().name(), version: browser.version(), samples: output }, null, 2))
      }
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
      const root = `[data-weld-report-grid="${report}"]`
      const selector = `${root} .ag-row[row-id="${id}"] [col-id="isometry"]`
      const before = await viewSnapshot(reader, root, selector)
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

      await measureReturn(route, `/${route}`, root, name, selector, value, before, { id, field: 'isometry', value })
    }

    await reader.goto('/line-program')
    await reader.getByLabel('Поиск программы линий', { exact: true }).fill('SM-0001')
    const common = '[data-program-grid="lines"] .ag-row[data-line="SM-0001"] [col-id="common"]'
    await expect(reader.locator(common)).toContainText('0 / 80', { timeout: 60000 })
    const programBefore = await viewSnapshot(reader, '[data-program-grid="lines"]', common)
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
    await measureReturn('program', '/line-program', '[data-program-grid="lines"]', 'Программа линий', common, '1 / 80', programBefore,
      { id, line: 'SM-0001', field: 'hasUzk', value: 'да' })

    await reader.goto('/documents')
    await expect(reader.getByText('Найдено: 100', { exact: true })).toBeVisible({ timeout: 60000 })
    const documentsBefore = await viewSnapshot(reader, '[data-document-history-grid]', '[data-document-history-grid] .document-grid-footer')
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
    await measureReturn('documents', '/documents', '[data-document-history-grid]', 'Документы', '[data-document-history-grid] .document-grid-footer', 'Найдено: 99', documentsBefore,
      { deletedDocumentId: documentRow.id, title })
  } finally {
    await writeFile(info.outputPath('return-freshness.json'), JSON.stringify({ protocol: 'automatic-return-acceptance-v2', browser: browser.browserType().name(), version: browser.version(), samples: output }, null, 2))
    await readerContext.close(); await writerContext.close(); await cleanupSmoothnessFixture()
  }
})
