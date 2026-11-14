import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { LARGE_EXPORT_LOCK } from '../../src/server/large-export-guard'

const project = 'E2E global large export slot'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('global slot: busy feedback, small exports, release and complete manual retry', async ({ page, baseURL }) => {
  test.setTimeout(180_000)
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joints(project_title,line,joint,weld_date,connection_type,has_vik,vik_result)
      select $1,'EXPORT-SLOT','SLOT-F'||lpad(n::text,6,'0'),'2026-10-01','С17','да','годен' from generate_series(1,10001) n`, [project])
  })
  await page.goto('/journal')
  const grid = page.locator('[data-welding-journal-grid]')
  await expect(grid.locator('.ag-row[row-id]').first()).toBeVisible({ timeout: 90_000 })
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('SLOT-F')
  await expect(page.getByText('SLOT-F000001', { exact: true })).toBeVisible()
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  await expect(preview.getByRole('status')).toContainText('10001')
  let exportInput: Record<string, any> | undefined
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/report-excel') exportInput = request.postDataJSON() })
  const post = async (path: string, data: unknown) => page.request.post(path, { data,
    headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin' }, timeout: 90_000 })
  // The lock holder lives in the test process, independently of the HTTP app.
  // This verifies the database-wide boundary, not an in-memory application flag.
  await withE2eDatabase(async db => {
    await db.query('begin')
    try {
      await db.query('select pg_advisory_xact_lock($1,$2)', [...LARGE_EXPORT_LOCK])
      const denied = page.waitForResponse(response => response.url().endsWith('/api/report-excel'))
      await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
      expect((await denied).status()).toBe(429)
      await expect(page.getByText(/Сейчас в системе формируется большая выгрузка/)).toBeVisible()
      await expect(preview.getByRole('button', { name: 'Скачать Excel', exact: true })).toBeEnabled()
      expect(exportInput).toBeTruthy()
      const small = await post('/api/report-excel', { ...exportInput, columnFilters: { joint: '=SLOT-F000001' } })
      expect(small.status()).toBe(200)
      const workbook = XLSX.read(await small.body())
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })
      expect(rows).toHaveLength(2)
      expect(rows[1]).toContain('SLOT-F000001')
      const documents = await post('/api/document-history-report', { format: 'excel', source: { kind: 'generated', types: ['weldingJournal'], columnFilters: {} },
        title: 'Документы', columns: [{ key: 'title', label: 'Документ' }], search: '', rowGroupCols: [], sortModel: [] })
      expect(documents.status()).toBe(200)
    } finally { await db.query('rollback') }
  })
  // Retry is explicit. There is no auto-queued later download with changed data.
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }),
    preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()])
  expect(await download.failure()).toBeNull()
  const workbook = XLSX.read(await readFile((await download.path())!))
  const rows = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1 }).slice(1))
  expect(rows).toHaveLength(10001)
  expect(rows[0]).toContain('SLOT-F000001')
  expect(rows.at(-1)).toContain('SLOT-F010001')
  await withE2eDatabase(async db => {
    await db.query('begin')
    try { expect((await db.query('select pg_try_advisory_xact_lock($1,$2) acquired', [...LARGE_EXPORT_LOCK])).rows[0].acquired).toBe(true) }
    finally { await db.query('rollback') }
  })
})

test('document exports share the slot and a generation failure releases it for a complete retry', async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  const title = 'E2E document export slot'
  const ids = await withE2eDatabase(async db => (await db.query(`insert into generated_documents(type,title,file_name,mime_type)
    select 'weldingJournal',$1||'-'||lpad(n::text,5,'0'),'slot.xlsx','application/octet-stream'
    from generate_series(1,10001) n returning id`, [title])).rows.map(row => row.id))
  const input = { format: 'excel', source: { kind: 'generated', types: ['weldingJournal'], columnFilters: {} },
    title: 'Документы', columns: [{ key: 'title', label: 'Документ' }], search: title,
    rowGroupCols: [], sortModel: [{ colId: 'title', sort: 'asc' }] }
  const post = () => page.request.post('/api/document-history-report', { data: input,
    headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin' }, timeout: 90_000 })
  try {
    await withE2eDatabase(async db => {
      await db.query('begin')
      try {
        await db.query('select pg_advisory_xact_lock($1,$2)', [...LARGE_EXPORT_LOCK])
        expect((await post()).status()).toBe(429)
      } finally { await db.query('rollback') }
    })
    // A real serialization error after acquiring the slot must roll back the
    // reader transaction. An oversized cell must never produce a partial file.
    await withE2eDatabase(db => db.query('update generated_documents set title=$2 where id=$1', [ids[0], title + 'x'.repeat(32768)]))
    const failed = await post()
    expect(failed.status()).toBe(400)
    expect(await failed.text()).toContain('Текст ячейки превышает допустимый размер Excel')
    await withE2eDatabase(async db => {
      await db.query('begin')
      try { expect((await db.query('select pg_try_advisory_xact_lock($1,$2) acquired', [...LARGE_EXPORT_LOCK])).rows[0].acquired).toBe(true) }
      finally { await db.query('rollback') }
      await db.query('update generated_documents set title=$2 where id=$1', [ids[0], title + '-00001'])
    })
    const retry = await post()
    expect(retry.status()).toBe(200)
    const workbook = XLSX.read(await retry.body())
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })
    expect(rows).toHaveLength(10002)
    expect(rows[1]).toEqual([title + '-00001'])
    expect(rows.at(-1)).toEqual([title + '-10001'])
  } finally {
    await withE2eDatabase(db => db.query('delete from generated_documents where id=any($1::int[])', [ids]))
  }
})
