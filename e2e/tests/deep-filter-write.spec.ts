import { expect, test, type Page, type Response } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { getReportImportTemplateFields } from '../../src/lib/report-import-template'
import { getBusinessDateIso } from '../../src/lib/business-date'
import { WELD_IMPORT_MAX_ROWS } from '../../src/lib/weld-import-limits'
import { withE2eDatabase } from '../database'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { editJournalJoint } from '../journal-grid'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import {
  cleanupWriteFixture, cloneCanonicalWriteFixture, finishWriteGinPending, prepareWriteReferences, qualifiedWriteRecord,
  resetWriteTargets, setWriteIndexes, writeBackgroundSignature, writeIndexProfile, writeJointChoiceExpression, writeJointChoiceIndex,
  writePhaseOrders, writeProjects, writeStoredFacts, writeTargets,
  type WriteTarget,
} from '../deep-filter-write-fixture'

const enabled = process.env.DEEP_FILTER_WRITE === '1'
test.skip(!enabled, 'Serial real UI save/mass-fill/replacement/new import experiment on owned disposable fixtures')
test.use({ trace: 'off', video: 'off' })
const sizes = process.env.DEEP_FILTER_WRITE_ROWS ? [Number(process.env.DEEP_FILTER_WRITE_ROWS)] : [9000, 200000]
const diagnosticSmoke = process.env.DEEP_FILTER_WRITE_SMOKE === '1'
const jointChoiceOnly = writeIndexProfile === 'joint-choice-only-v1'
const comparison = jointChoiceOnly ? 'three alternating baseline/single joint-choice Btree pairs' : 'baseline, GIN and exact-choice Btree'
const grid = (page: Page) => page.locator('[data-weld-report-grid="weldingJournal"]')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Импорт данных', exact: true })

async function ready(page: Page, count: number) {
  await expect(grid(page).locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 300000 })
  await expect(grid(page).getByText(`Найдено: ${count}`, { exact: true })).toBeVisible({ timeout: 300000 })
  await expect(grid(page).getByText('Подсчёт…', { exact: true })).toHaveCount(0)
  await expect(grid(page).getByText('Загрузка…', { exact: true })).toHaveCount(0)
}

async function reportScope(page: Page, target: WriteTarget) {
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(target.line)
  await ready(page, target.mode === 'newRecords' ? 0 : target.count)
  await page.waitForLoadState('networkidle')
}

async function assertRpcSuccess(response: Response) {
  await response.finished()
  expect(response.ok()).toBe(true)
  const payload = await deserializeRpcResponse(await response.text()) as { result?: unknown; error?: Error }
  if (payload.error) throw payload.error
  return payload.result
}

function uploadFile(name: string, headers: string[], rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Правки')
  return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer }
}

// Service timestamps legitimately change on saves; every other old fact must
// survive an unrelated isometry edit, including qualification/control fields.
function stableEditedFact(fact: Record<string, unknown>) {
  const copy = { ...fact }
  for (const key of ['isometry', 'updated_at', 'welding_updated_at', 'lnk_updated_at', 'psto_updated_at']) delete copy[key]
  return copy
}

async function dispatcherFresh() {
  return withE2eDatabase(async db => {
    const state = (await db.query(`select source_revision,computed_revision,full_rebuild,dirty_scopes,computed_at
      from dispatcher_task_index_state where id=1`)).rows[0]
    return Boolean(state && state.source_revision === state.computed_revision && !state.full_rebuild
      && state.dirty_scopes === '[]' && state.computed_at && getBusinessDateIso(state.computed_at) === getBusinessDateIso())
  })
}

async function assertNoGeneratedDocuments() {
  await withE2eDatabase(async db => {
    const counts = (await db.query(`select (select count(*)::int from generated_documents) as documents,
      (select count(*)::int from generated_document_weld_joints) as relations`)).rows[0]
    expect(counts).toEqual({ documents: 0, relations: 0 })
  })
}

async function initializeEmptyDocumentReferences(page: Page, observed: string) {
  const headers = { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true' }
  // Ordinary first reads initialize these persisted helpers. Warm them before
  // cloning the empty-document fixture and before the settings baseline so a
  // first import's lazy initialization cannot favour a later index phase.
  for (const type of ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion']) {
    const response = await page.request.post(siblingRpcUrl(observed, 'listSystemDocumentHistoryGrid_createServerFn_handler'), {
      headers: { ...headers, 'content-type': 'application/json' },
      data: await serializeRpcData({ type, startRow: 0, endRow: 1, rowGroupCols: [], groupKeys: [], sortModel: [], columnFilters: {} }),
    })
    expect(response.ok()).toBe(true)
    const payload = await deserializeRpcResponse(await response.text()) as { result: unknown; error?: Error }
    if (payload.error) throw payload.error
    expect(payload.result).toMatchObject({ rows: [], rowCount: 0, total: 0 })
  }
  const response = await page.request.get(siblingRpcUrl(observed, 'getSystemDocumentSequences_createServerFn_handler'), { headers })
  expect(response.ok()).toBe(true)
  const payload = await deserializeRpcResponse(await response.text()) as { result: Record<string, number>; error?: Error }
  if (payload.error) throw payload.error
  expect(Object.keys(payload.result)).toHaveLength(15)
  expect(Object.values(payload.result).every(value => value === 1)).toBe(true)
  const counters = await withE2eDatabase(async db => (await db.query(
    "select key,value from app_settings where key like 'system-document-next-number:%' order by key",
  )).rows)
  const expectedNames = ['lnkConclusionOther', 'lnkConclusionPvk:beforeHeatTreatment', 'lnkConclusionPvk:main',
    'lnkConclusionRk:beforeHeatTreatment', 'lnkConclusionRk:main', 'lnkConclusionUzk:beforeHeatTreatment', 'lnkConclusionUzk:main',
    'lnkConclusionVik:beforeHeatTreatment', 'lnkConclusionVik:main', 'lnkRequest:beforeHeatTreatment', 'lnkRequest:main',
    'pstoConclusion', 'pstoRequest', 'tvmtConclusion', 'tvmtRequest']
  expect(counters).toEqual(expectedNames.map(name => ({ key: `system-document-next-number:${name}`, value: '1' })))
  await assertNoGeneratedDocuments()
  return { systemRegistries: 4, counters, documents: 0, relations: 0 }
}

for (const total of sizes) test(`${total} welds: ordinary UI writes with ${comparison}`, async ({ page }, info) => {
  test.setTimeout(3_600_000)
  page.setDefaultTimeout(30000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  const appOrigin = new URL(String(info.project.use.baseURL)).origin
  expect(appOrigin).toBe('http://127.0.0.1:3100')
  expect([9000, 200000]).toContain(total)
  expect(WELD_IMPORT_MAX_ROWS).toBe(500)
  expect(writeTargets).toHaveLength(7)
  expect(writeTargets.every(target => target.count <= WELD_IMPORT_MAX_ROWS)).toBe(true)
  const phaseOrders = diagnosticSmoke ? [['baseline'] as const] : writePhaseOrders
  const samples: object[] = [], phases: object[] = [], downloads: object[] = [], progress: object[] = [], errors: string[] = []
  const stage = (step: string, context: object = {}) => {
    const entry = { at: new Date().toISOString(), step, ...context }
    progress.push(entry)
    console.log('DEEP_FILTER_WRITE', JSON.stringify(entry))
  }
  let ownership: Awaited<ReturnType<typeof prepareWriteReferences>> | undefined
  let observed = '', initialBackground: unknown, initialSettings: unknown, documentReferences: unknown, actualProjects: number | undefined
  const save = () => writeFile(info.outputPath(`deep-filter-write-${total}.json`), JSON.stringify({
    protocol: writeIndexProfile, total, projects: actualProjects, indexProfile: writeIndexProfile, diagnosticSmoke, phaseOrders,
    index: jointChoiceOnly ? { name: writeJointChoiceIndex, expression: writeJointChoiceExpression, otherExperimentalIndexes: 0 } : undefined,
    importRowLimit: WELD_IMPORT_MAX_ROWS, samples, phases, downloads, progress, errors, initialBackground, documentReferences,
    limits: 'Single-user UI writes, full preview and production validators. Committed fixture reset/VACUUM/DDL/build/ANALYZE are outside measurements and disclosed per phase. Commit latency is click-to-successful mutation response; grid and dispatcher waits are separate. New inserts have fresh sequence IDs in each phase, old IDs remain stable. '
      + (jointChoiceOnly ? 'Only one normalized joint Btree is added; no GIN or pg_trgm setup is used. ' : 'Pending-list merge cost is recorded after each complete phase. ')
      + 'No sustained multiuser/vacuum claim.',
  }, null, 2))
  const settings = () => withE2eDatabase(async db => (await db.query('select key,value from app_settings order by key')).rows)
  try {
    ownership = await prepareWriteReferences(total)
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
    await page.addInitScript(({ origin, hiddenFieldKeys }) => {
      // Phase preparation visits about:blank, whose opaque origin cannot use
      // localStorage. Only the verified owned app origin receives view state;
      // genuine application errors still reach the strict pageerror assertion.
      if (window.location.origin !== origin) return
      localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
        activePreset: 'custom', hiddenFieldKeys, customHiddenFieldKeys: hiddenFieldKeys, collapsedSections: [], savedViews: [],
      }))
    }, { origin: appOrigin, hiddenFieldKeys: WELD_FIELDS
      .filter(field => !['projectTitle', 'line', 'joint', 'isometry', 'weldDate'].includes(field.key)).map(field => field.key) })
    await page.goto('/journal')
    await ready(page, 1)
    await page.waitForLoadState('networkidle')
    expect(observed).not.toBe('')
    stage('initialize empty document references')
    documentReferences = await initializeEmptyDocumentReferences(page, observed)
    // Only this setup prototype is created through a direct HTTP RPC. Every
    // measured operation below uses the visible editor/import dialog.
    const createdResponse = await page.request.post(siblingRpcUrl(observed, 'createWeldJoint_createServerFn_handler'), {
      data: await serializeRpcData({ ...qualifiedWriteRecord, line: writeTargets[0].line, joint: 'F7000001' }),
      headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' }, timeout: 240000,
    })
    expect(createdResponse.ok()).toBe(true)
    const prototype = await deserializeRpcResponse(await createdResponse.text()) as { result: { id: number }; error?: Error }
    if (prototype.error) throw prototype.error
    expect(prototype.result.id).toBeGreaterThan(0)
    await page.goto('about:blank')
    const fixtureShape = await cloneCanonicalWriteFixture(prototype.result.id, total)
    actualProjects = fixtureShape.projects
    await page.goto('/journal')
    await reportScope(page, writeTargets[0])
    await expect.poll(dispatcherFresh, { timeout: 300000 }).toBe(true)
    initialBackground = await writeBackgroundSignature()
    initialSettings = await settings()
    const initialTargets = new Map<string, Awaited<ReturnType<typeof writeStoredFacts>>>()
    for (const target of writeTargets) initialTargets.set(target.line, await writeStoredFacts(target.line))

    for (let round = 0; round < phaseOrders.length; round++) for (const phase of phaseOrders[round]) {
      stage('phase preparation', { phase, round })
      await page.goto('about:blank')
      await resetWriteTargets()
      const indexes = await setWriteIndexes(phase)
      await page.goto('/journal')
      await reportScope(page, writeTargets[0])
      await expect.poll(dispatcherFresh, { timeout: 300000 }).toBe(true)
      expect(await writeBackgroundSignature()).toEqual(initialBackground)
      expect(await settings()).toEqual(initialSettings)
      await assertNoGeneratedDocuments()
      for (const target of writeTargets) {
        const current = await writeStoredFacts(target.line), initial = initialTargets.get(target.line)!
        expect(current.map(row => row.id)).toEqual(initial.map(row => row.id))
        expect(current.map(row => stableEditedFact(row.fact))).toEqual(initial.map(row => stableEditedFact(row.fact)))
        expect(current.every(row => row.fact.isometry === target.initial)).toBe(true)
      }
      const before = await auditSqlCount(), detailsBefore = await auditSqlDetails()
      for (const target of writeTargets) {
        const operation = { phase, round, mode: target.mode, count: target.count }
        stage('report scope', operation)
        await reportScope(page, target)
        const previous = await writeStoredFacts(target.line)
        let previewMs: number | undefined, downloadMs: number | undefined, fileBytes: number | undefined
        let mutationName: string, click: () => Promise<unknown>
        const changed = `AFTER-${target.mode}-${target.count}`
        if (target.mode === 'save') {
          await editJournalJoint(page, previous[0].id)
          const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
          await editor.getByLabel('Изометрия', { exact: true }).fill(changed)
          mutationName = 'updateWeldJoint'
          click = () => editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
        } else {
          await page.getByRole('button', { name: 'Импорт', exact: true }).click()
          const modal = dialog(page)
          const modeLabel = target.mode === 'massFill' ? 'Массовое заполнение' : target.mode === 'replaceData' ? 'Замена данных' : 'Импорт данных'
          await modal.getByRole('button', { name: modeLabel, exact: true }).click()
          stage('download template', operation)
          const startDownload = performance.now()
          const [download] = await Promise.all([page.waitForEvent('download'), modal.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()])
          expect(await download.failure()).toBeNull()
          const template = XLSX.read(await readFile((await download.path())!), { type: 'buffer', cellStyles: true })
          const table = XLSX.utils.sheet_to_json<unknown[]>(template.Sheets[template.SheetNames[0]], { header: 1 })
          const downloadedHeaders = table[0].map(String)
          downloads.push({ phase, round, mode: target.mode, count: target.count, headers: downloadedHeaders.slice(0, 200),
            sheets: template.SheetNames.slice(0, 5), names: template.Workbook?.Names?.map(entry => entry.Name).slice(0, 20),
            hiddenColumns: template.Sheets[template.SheetNames[0]]['!cols']?.flatMap((column, index) => column.hidden ? [{ index, header: downloadedHeaders[index] }] : []).slice(0, 20) })
          downloadMs = performance.now() - startDownload
          let file: ReturnType<typeof uploadFile>
          if (target.mode === 'newRecords') {
            const fields = getReportImportTemplateFields('weldingJournal')
            const rows = Array.from({ length: target.count }, (_, n) => {
              const data: Record<string, unknown> = { ...qualifiedWriteRecord, line: target.line,
                joint: `F${(target.count === 100 ? 8100000 : 8200000) + n + 1}`, isometry: changed }
              return fields.map(field => data[field.key] ?? '')
            })
            file = uploadFile(`new-${target.count}.xlsx`, fields.map(field => field.label), rows)
          } else {
            const headers = downloadedHeaders, idColumn = headers.indexOf('ID записи'), versionColumn = headers.indexOf('__Версия записи')
            expect(idColumn).toBeGreaterThanOrEqual(0)
            const ids = table.slice(1).map(row => Number(row[idColumn]))
            expect(ids.slice().sort((a, b) => a - b)).toEqual(previous.map(row => row.id))
            if (target.mode === 'replaceData') {
              expect(versionColumn).toBeGreaterThanOrEqual(0)
              const versions = new Map(table.slice(1).map(row => [Number(row[idColumn]), String(row[versionColumn])]))
              for (const row of previous) expect(versions.get(row.id)).toBe(row.version)
              file = uploadFile(`${target.mode}-${target.count}.xlsx`, ['ID записи', '__Версия записи', 'Изометрия'],
                ids.map(id => [id, versions.get(id), changed]))
            } else {
              // Mass fill deliberately has no file version column. Its real
              // preview captures current-row versions from the loaded scope.
              expect(versionColumn).toBe(-1)
              file = uploadFile(`${target.mode}-${target.count}.xlsx`, ['ID записи', 'Изометрия'], ids.map(id => [id, changed]))
            }
          }
          fileBytes = file.buffer.byteLength
          stage('preview upload', operation)
          const previewStart = performance.now()
          await modal.locator('input[type=file]').setInputFiles(file)
          const verb = target.mode === 'massFill' ? 'Заполнить' : target.mode === 'replaceData' ? 'Заменить' : 'Импортировать'
          const apply = modal.getByRole('button', { name: `${verb} ${target.count} строк`, exact: true })
          await expect(apply).toBeEnabled({ timeout: 240000 })
          await expect(modal.locator('[id^="import-error-"]')).toHaveCount(0)
          await expect(modal.getByText(/Строк с ошибками: 0\. Сообщений: 0\./)).toBeVisible()
          previewMs = performance.now() - previewStart
          mutationName = target.mode === 'massFill' ? 'massFillWeldJoints' : target.mode === 'replaceData' ? 'replaceWeldJoints' : 'importWeldJoints'
          click = () => apply.click()
        }
        // Subscribe before clicking. A subsequent grid response must be from
        // the normal mutation invalidation, not a test-forced manual refresh.
        const mutation = page.waitForResponse(response => rpcName(response.url()).startsWith(mutationName + '_'), { timeout: 300000 })
        const nextGrid = page.waitForResponse(response => /^readJournalGrid(?:Blocks)?_/.test(rpcName(response.url())), { timeout: 300000 })
        // Keep both waits observed if an earlier click/save assertion fails;
        // awaiting them below still propagates any real response failure.
        void mutation.catch(() => {})
        void nextGrid.catch(() => {})
        stage('apply', operation)
        const started = performance.now()
        await click()
        const response = await mutation
        const result = await assertRpcSuccess(response)
        const commitMs = performance.now() - started
        if (target.mode === 'massFill' || target.mode === 'replaceData') {
          const payload = deserializeRpcPayload(response.request().postData()!) as { data: { expectedVersions: Array<{ id: number; version: string }> } }
          expect(payload.data.expectedVersions.slice().sort((a, b) => a.id - b.id)).toEqual(previous.map(row => ({ id: row.id, version: row.version })))
        }
        await assertRpcSuccess(await nextGrid)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await ready(page, target.count)
        const gridMs = performance.now() - started
        await expect.poll(dispatcherFresh, { timeout: 300000 }).toBe(true)
        const dispatcherMs = performance.now() - started
        const after = await writeStoredFacts(target.line)
        expect(after).toHaveLength(target.count)
        expect(after.every(row => row.fact.isometry === changed)).toBe(true)
        if (target.mode !== 'newRecords') {
          expect(after.map(row => row.id)).toEqual(previous.map(row => row.id))
          expect(after.map(row => stableEditedFact(row.fact))).toEqual(previous.map(row => stableEditedFact(row.fact)))
          after.forEach((row, index) => expect(row.version).not.toBe(previous[index].version))
        } else {
          expect(result).toMatchObject({ inserted: target.count })
          expect(after.every(row => row.fact.stamp_1_k === qualifiedWriteRecord.stamp1K
            && row.fact.stamp_1_k_fact === qualifiedWriteRecord.stamp1KFact && row.fact.material_group === 'М01')).toBe(true)
        }
        samples.push({ phase, round, mode: target.mode, count: target.count, previewMs, downloadMs, fileBytes,
          commitMs, gridMs, dispatcherMs, requestBytes: response.request().postDataBuffer()?.byteLength })
        stage('completed', operation)
        await save()
      }
      await page.waitForLoadState('networkidle')
      const after = await auditSqlCount(), detailsAfter = await auditSqlDetails()
      const ginPending = await finishWriteGinPending(phase)
      phases.push({ phase, round, ...indexes, ginPending,
        statements: before === undefined || after === undefined ? undefined : after - before, detailsBefore, detailsAfter })
      expect(await writeBackgroundSignature()).toEqual(initialBackground)
      expect(await settings()).toEqual(initialSettings)
      await assertNoGeneratedDocuments()
      await save()
    }
    expect(phases).toHaveLength(phaseOrders.reduce((count, order) => count + order.length, 0))
    expect(samples).toHaveLength(phases.length * writeTargets.length)
    expect(errors).toEqual([])
  } catch (error) {
    stage('failed', { message: error instanceof Error ? error.message : String(error) })
    await page.screenshot({ path: info.outputPath(`deep-filter-write-${total}-failure.png`), fullPage: true, timeout: 5000 }).catch(() => {})
    throw error
  } finally {
    await page.goto('about:blank').catch(() => {})
    try { await save() } finally { if (ownership) await cleanupWriteFixture(ownership.ownedExtension) }
  }
})
