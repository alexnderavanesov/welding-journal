import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { eq, sql } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { normalizeRequestConclusionSettings } from '../../src/lib/request-conclusion-settings'
import { getSystemDocumentNumber } from '../../src/lib/system-document-types'
import { buildInitialSystemDocumentSequenceQuery, readRequestConclusionSettings, readSystemDocumentNextNumbers } from '../../src/server/system-document-sequences'
import { initializeSystemDocumentIndexesInTransaction, syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { openDocumentOperation, confirmDocumentOperation } from '../document-operation-ui'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { previewSheetText } from '../document-sheet'

// Author-only precommit regressions. The main runner owns the disposable DB,
// server and template directory; this file must never bootstrap any of them.
test.describe.configure({ mode: 'serial' })
const date = '2026-10-13'
let project = ''
let savedSettings: Array<{ key: string; value: string; updated_at: Date }> | undefined
let fileKey = ''
const receipts = new Set<string>()
const store = () => createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())

test.beforeEach(async () => {
  savedSettings = undefined
  fileKey = ''
  receipts.clear()
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  expect(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH).toContain('welding-e2e-templates-')
  project = `E2E-stage-naming-${randomUUID()}`
  await withE2eDatabase(async db => {
    savedSettings = (await db.query("select key,value,updated_at from app_settings where key like 'system-document-next-number:%' or key='request-conclusion'")).rows
    await db.query("delete from app_settings where key like 'system-document-next-number:%' or key='request-conclusion'")
    await db.query("insert into app_settings(key,value) values('request-conclusion',$1),('system-document-next-number:lnkRequest','126')", [JSON.stringify(normalizeRequestConclusionSettings({
      lnkRequest: { systemPattern: `${project}-{{№}}` },
      lnkRequestBeforeHeatTreatment: { systemPattern: `${project}-{{№}}` },
    }))])
  })
  // Keep the ordinary first-read index initialization outside preservation
  // snapshots, including when this spec is run alone on an empty test DB.
  await requireDb().transaction(initializeSystemDocumentIndexesInTransaction)
})

test.afterEach(async ({ page }) => {
  await page.close()
  if (!savedSettings) return // A failed safety check must not trigger cleanup.
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    if (receipts.size) await db.query('delete from document_operation_receipts where id=any($1::text[])', [[...receipts]])
    if (fileKey) await db.query('delete from document_templates where blob_key=$1', [fileKey])
    await db.query('begin')
    try {
      await db.query("delete from app_settings where key like 'system-document-next-number:%' or key='request-conclusion'")
      for (const item of savedSettings!) await db.query('insert into app_settings(key,value,updated_at) values($1,$2,$3)', [item.key, item.value, item.updated_at])
      await db.query('commit')
    } catch (error) { await db.query('rollback'); throw error }
  })
  if (fileKey) await store().delete(fileKey)
})

async function writeRules(value: unknown) {
  const rules = normalizeRequestConclusionSettings(value)
  await withE2eDatabase(db => db.query("update app_settings set value=$1,updated_at=now() where key='request-conclusion'", [JSON.stringify(rules)]))
  return rules
}

async function seedPrimaryRequest(title: string) {
  const row = await withE2eDatabase(async db => (await db.query(`insert into weld_joints
    (project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
    values($1,'STAGE','MAIN','PRIMARY','2026-10-01','действующий','актуальная','да',$2,$3) returning id`, [project, title, date])).rows[0])
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.id, row.id))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  return row.id as number
}

async function seedBeforeRequest(title: string, count = 2) {
  return withE2eDatabase(async db => {
    const controls: Array<{ id: number; weld_joint_id: number; method: string }> = []
    for (let index = 1; index <= count; index++) {
      const row = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,psto_required,has_vik)
        values($1,'STAGE',$2,$3,'2026-10-01','действующий','актуальная','да','да') returning id`, [project, `PRE-${index}`, `PRE-${index}`])).rows[0]
      controls.push((await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date)
        values($1,'ВИК',$2,$3) returning id,weld_joint_id,method`, [row.id, title, date])).rows[0])
    }
    const positions = controls.map(control => ({ kind: 'beforeHeatTreatment', weldJointId: control.weld_joint_id, relationId: control.id, methodCode: control.method }))
    const metadata = { sourceKind: 'beforeHeatTreatment', sourcePositions: positions, methodCodes: ['ВИК'],
      positionCount: count, projects: [project], subtitleCodes: ['STAGE'], lines: controls.map((_, i) => `PRE-${i + 1}`) }
    const document = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
      values('system:lnkRequest',$1,'stage-request.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$2,$2,$3,$4) returning id`,
    [title, date, count, JSON.stringify(metadata)])).rows[0]
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [document.id, controls.map(control => control.weld_joint_id)])
    return controls
  })
}

const facts = () => withE2eDatabase(async db => ({
  rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
  controls: (await db.query('select c.* from pre_heat_treatment_controls c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by c.id', [project])).rows,
  documents: (await db.query(`select d.* from generated_documents d where d.id in
    (select a.document_id from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1) order by d.id`, [project])).rows,
  links: (await db.query(`select a.document_id,a.weld_joint_id from generated_document_weld_joints a
    join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 order by a.document_id,a.weld_joint_id`, [project])).rows,
}))
const counters = () => readSystemDocumentNextNumbers(requireDb(), ['lnkRequest', 'lnkRequest:beforeHeatTreatment'])

test('equal stage formulas: reset pre-TO, split preview and first actual save agree without a repeated conflict', async ({ page }) => {
  // Independent acceptance oracle: 001 is occupied on this date by main;
  // splitting pre-TO 005 retains 005 and allocates the first free full name 002.
  const occupied = `${project}-001`, original = `${project}-005`, free = `${project}-002`
  const primaryId = await seedPrimaryRequest(occupied)
  const controls = await seedBeforeRequest(original)
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (!request.url().includes('/_serverFn/')) return
    const name = rpcName(request.url()).split('_')[0]
    calls.push(name)
    if (name === 'applyDocumentOperation') {
      // Only the operation UUID is present in this request: weld/document IDs
      // are numeric. Keep its receipt cleanup scoped to this browser's writes.
      for (const id of request.postData()?.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi) ?? []) receipts.add(id)
    }
  })
  await page.goto('/settings')
  await page.getByRole('main').getByRole('button', { name: 'Документы', exact: true }).click()
  await page.getByRole('button', { name: /Заявка ЛНК Шаблон заявки/ }).click()
  await expect(page.getByText('Основной: 126', { exact: true })).toBeVisible()
  await expect(page.getByText('До ТО: 126', { exact: true })).toBeVisible()
  const before = await facts()
  await page.getByRole('button', { name: 'Обнулить счетчик', exact: true }).click()
  await page.getByRole('button', { name: 'До ТО', exact: true }).click()
  const reset = page.getByRole('dialog')
  await expect(reset).toContainText('Заявка ЛНК · До ТО')
  await reset.getByRole('button', { name: 'Обнулить счетчик', exact: true }).click()
  await expect(page.getByText('До ТО: 1', { exact: true })).toBeVisible()
  expect(await counters()).toEqual({ lnkRequest: 126, 'lnkRequest:beforeHeatTreatment': 1 })
  expect(await facts()).toEqual(before)

  const dialog = await openDocumentOperation(page, [original], 'Заявка ЛНК')
  await dialog.getByRole('combobox', { name: 'Разделение выбранных документов' }).selectOption('line')
  await dialog.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  const names = dialog.getByRole('textbox', { name: /^Название:/ })
  await expect(names).toHaveCount(2)
  await expect(names.nth(0)).toHaveValue(original)
  await expect(names.nth(1)).toHaveValue(free)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(await counters()).toEqual({ lnkRequest: 126, 'lnkRequest:beforeHeatTreatment': 1 })
  await confirmDocumentOperation(dialog) // One confirmation, no retry/re-preview workaround.
  expect(calls.filter(name => name === 'applyDocumentOperation')).toHaveLength(1)
  expect(calls.filter(name => name === 'getDocumentOperationResult')).toHaveLength(0)
  expect(receipts.size).toBe(1)
  expect(await counters()).toEqual({ lnkRequest: 126, 'lnkRequest:beforeHeatTreatment': 3 })
  const after = await facts()
  expect(after.rows.find(row => row.id === primaryId)).toEqual(before.rows.find(row => row.id === primaryId))
  const primaryDocument = before.documents.find(document => document.title === occupied)!
  expect(after.documents.find(document => document.id === primaryDocument.id)).toEqual(primaryDocument)
  expect(after.controls.map(control => control.id)).toEqual(controls.map(control => control.id))
  expect(after.controls.map(control => control.request_name)).toEqual([original, free])
  const unchangedControlFacts = (items: typeof before.controls) => items.map(({ request_name, updated_at, ...record }) => record)
  expect(unchangedControlFacts(after.controls)).toEqual(unchangedControlFacts(before.controls))
  expect(after.documents.map(document => document.title).sort()).toEqual([occupied, original, free].sort())
  for (const control of after.controls) {
    const document = after.documents.find(item => item.title === control.request_name)!
    expect(after.links.filter(link => link.document_id === document.id)).toEqual([{ document_id: document.id, weld_joint_id: control.weld_joint_id }])
    expect(JSON.parse(document.source_metadata).sourceKind).toBe('beforeHeatTreatment')
  }
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  for (const title of [occupied, original, free]) await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

async function installNumberTemplate() {
  await withE2eDatabase(async db => {
    expect((await db.query("select id from document_templates where id='lnkRequest'")).rows).toHaveLength(0)
  })
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['Номер документа', 'Название', 'Стык'], ['', '', '']])
  sheet['!cols'] = [{ wch: 22 }, { wch: 80 }, { wch: 15 }]
  XLSX.utils.book_append_sheet(workbook, sheet, 'Номер')
  const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  fileKey = `e2e-stage-naming/${randomUUID()}.xlsx`
  await store().set(fileKey, data)
  await withE2eDatabase(db => db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
    values('lnkRequest',$1,'number.xlsx','xlsx',$2,$3,$4)`, [fileKey, data.byteLength,
    JSON.stringify({ sheetNames: ['Номер'], fields: [], markerCount: 0, locations: [], warnings: [] }),
    JSON.stringify({ version: 1, sheetName: 'Номер', repeatRow: 2, bindings: [
      { cell: 'A2', mode: 'row', field: '__systemDocumentNumber' },
      { cell: 'B2', mode: 'row', field: '__systemDocumentTitle' },
      { cell: 'C2', mode: 'row', field: 'joint' },
    ] }),
  ]))
}

async function assertPreviewNumber(page: Page, title: string) {
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  await page.getByRole('button', { name: title, exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  const text = await previewSheetText(modal)
  // Exact cell text checks the number: the unchanged title also
  // contains 1233 and must not hide a misprinted 012 in column A.
  await expect(modal.frameLocator('iframe').getByText('1233', { exact: true })).toBeVisible()
  expect(text).not.toMatch(/\b012\b/)
  const downloaded = page.waitForEvent('download')
  await modal.getByRole('button', { name: 'Скачать Excel' }).click()
  const workbook = XLSX.read(await readFile((await (await downloaded).path())!), { type: 'buffer' })
  expect(String(workbook.Sheets['Номер'].A2?.v)).toBe('1233')
  expect(workbook.Sheets['Номер'].B2?.v).toBe(title)
}

test('changing only pre-TO formula cannot reinterpret an old primary 1233 as 012 in preview or Excel', async ({ page }) => {
  const pattern = `${project}-НК-{{№}}`, title = `${project}-НК-1233`
  await writeRules({ lnkRequest: { systemPattern: pattern }, lnkRequestBeforeHeatTreatment: { systemPattern: pattern } })
  await seedPrimaryRequest(title)
  await installNumberTemplate()
  const before = await facts()
  const reference = { type: 'lnkRequest' as const, title, date }
  expect(getSystemDocumentNumber(reference, await readRequestConclusionSettings(requireDb()))).toBe('1233')
  await assertPreviewNumber(page, title)
  const beforeCounters = await counters()
  const beforeRules = await readRequestConclusionSettings(requireDb())

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Заявки и заключения', exact: true }).click()
  const requestsCard = page.getByRole('heading', { name: 'Заявки ЛНК', exact: true }).locator('..')
  const beforeCard = requestsCard.getByText('До ТО', { exact: true }).locator('..')
  await beforeCard.getByRole('button', { name: 'Раскрыть', exact: true }).click()
  await beforeCard.getByRole('button', { name: 'Добавить текст', exact: true }).click()
  await beforeCard.getByRole('textbox', { name: 'Текст части 3', exact: true }).fill('33')
  await beforeCard.getByRole('button', { name: 'Сохранить правило', exact: true }).click()
  await expect(beforeCard.getByRole('button', { name: 'Сохранить правило', exact: true })).toBeDisabled()
  const afterRules = await readRequestConclusionSettings(requireDb())
  expect(afterRules.lnkRequest).toEqual(beforeRules.lnkRequest)
  expect(afterRules.lnkRequestBeforeHeatTreatment.systemPattern).toBe(`${pattern}33`)
  // Literal expected number comes from the document issued before this edit,
  // not from the parser/allocator under test. The old union-MIN returned 012.
  expect(getSystemDocumentNumber(reference, afterRules)).toBe('1233')
  await assertPreviewNumber(page, title)
  expect(await facts()).toEqual(before)
  expect(await counters()).toEqual(beforeCounters)
})

test('PostgreSQL recognition prioritizes the source stage over shared history and keeps unambiguous legacy fallback', async () => {
  const main = `${project}-MAIN-{{№}}`, own = `${project}-ARCH-{{№}}`, sharedHistory = `${own}33`
  const rules = await writeRules({
    lnkRequest: { systemPattern: main, systemPatternHistory: [sharedHistory] },
    lnkRequestBeforeHeatTreatment: { systemPattern: own, systemPatternHistory: [sharedHistory] },
  })
  const primaryId = await seedPrimaryRequest(`${project}-MAIN-008`)
  const [control] = await seedBeforeRequest(`${project}-ARCH-12333`, 1)
  // Execute the actual production aggregate. Scoped CTEs expose only this
  // fixture's real DB rows, so another test's large counters cannot mask a
  // wrong stage number via the aggregate MAX. No regex/priority SQL is mocked.
  const maximum = async (before: boolean, currentRules = rules) => {
    const query = buildInitialSystemDocumentSequenceQuery(currentRules, ['lnkRequest'])!
    const result = await requireDb().execute(sql`with
      "weld_joints" as (select * from public.weld_joints where id=${primaryId} and ${!before}),
      "pre_heat_treatment_controls" as (select * from public.pre_heat_treatment_controls where id=${control.id} and ${before})
      ${query}`)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].sequenceId).toBe('lnkRequest')
    return Number(result.rows[0].maxNumber)
  }
  expect(await maximum(false)).toBe(8)
  // This row was issued with the explicit pre-TO ARCH-{{№}} formula, not the
  // shared historic ARCH-{{№}}33 formula. The latter would misread it as 123.
  expect(await maximum(true)).toBe(12333)
  expect(getSystemDocumentNumber({ type: 'lnkRequest', sourceKind: 'beforeHeatTreatment', title: `${project}-ARCH-12333`, date }, rules)).toBe('12333')
  await withE2eDatabase(db => db.query('update pre_heat_treatment_controls set request_name=$1 where id=$2', [`${project}-MAIN-009`, control.id]))
  expect(await maximum(true)).toBe(9) // Old pre-TO formula had no literal ДО-ТО.
  expect(getSystemDocumentNumber({ type: 'lnkRequest', sourceKind: 'beforeHeatTreatment', title: `${project}-MAIN-009`, date }, rules)).toBe('009')

  const pattern = `${project}-НК-{{№}}`, history = [`${project}-SHARED-{{№}}`]
  const edited = await writeRules({
    lnkRequest: { systemPattern: pattern, systemPatternHistory: history },
    lnkRequestBeforeHeatTreatment: { systemPattern: `${pattern}33`, systemPatternHistory: history },
  })
  await withE2eDatabase(async db => {
    await db.query('update weld_joints set vik_request=$1 where id=$2', [`${project}-НК-1233`, primaryId])
    await db.query('update pre_heat_treatment_controls set request_name=$1 where id=$2', [`${project}-НК-00433`, control.id])
  })
  // Same histories do not make the other stage's current pattern authoritative.
  expect(await maximum(false, edited)).toBe(1233) // Not 12 from the pre-TO suffix.
  expect(await maximum(true, edited)).toBe(4) // Not 433 from the main fallback.
})
