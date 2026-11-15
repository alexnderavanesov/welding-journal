import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'
import { DOCUMENT_TEMPLATE_TYPES } from '../../src/lib/document-template-model'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'

test('template list and first constructor: one and fifteen files, bounded requests', async ({ page }, info) => {
  test.skip(!process.env.TEMPLATE_LOADING_LABEL, 'Explicit local before/after measurement')
  test.setTimeout(180000)
  expect(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH).toContain('welding-e2e-templates-')
  const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Стык', 'Линия'], ['', ''], ...Array.from({ length: 100 }, (_, i) => [`Подпись ${i}`, '']),
  ]), 'Бланк')
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const ids = DOCUMENT_TEMPLATE_TYPES.map(item => item.id).slice(0, 15)
  expect(ids).toContain('weldingJournal')
  const measures: unknown[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.assign(window, { templateReadyMs: null, templateLongTasks: [] as number[] })
    new MutationObserver(() => {
      const state = window as unknown as { templateReadyMs: number | null }
      if (state.templateReadyMs !== null) return
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Открыть конструктор')
      if (button && !button.disabled) state.templateReadyMs = performance.now()
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] })
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
      (window as unknown as { templateLongTasks: number[] }).templateLongTasks.push(...list.getEntries().map(entry => entry.duration))
    }).observe({ type: 'longtask' })
  })
  try {
    await withE2eDatabase(async db => { expect((await db.query('select id from document_templates')).rows).toHaveLength(0) })
    for (const count of [1, 15]) {
      for (const id of ids.slice(count === 1 ? 0 : 1, count)) {
        const key = `${id}/performance.xlsx`
        await store.set(key, new Uint8Array(bytes).buffer)
        await withE2eDatabase(db => db.query(`insert into document_templates
          (id,blob_key,file_name,file_type,file_size,metadata,options,constructor_config)
          values($1,$2,'performance.xlsx','xlsx',$3,$4,'{}',$5)`, [id, key, bytes.byteLength,
          JSON.stringify({ sheetNames: ['Бланк'], fields: [], markerCount: 0, locations: [], warnings: [] }),
          JSON.stringify({ version: 1, sheetName: 'Бланк', repeatRow: 2, bindings: [{ cell: 'A2', mode: 'row', field: 'joint' }] }),
        ]))
      }
      for (let round = 0; round < 5; round++) {
        const rpc: string[] = []
        const payloads: Promise<number>[] = []
        const onRequest = (request: import('@playwright/test').Request) => { const name = rpcName(request.url()); if (name) rpc.push(name) }
        const onResponse = (response: import('@playwright/test').Response) => {
          if (/^(getRemoteDocumentTemplateInventory|getRemoteDocumentTemplate)_/.test(rpcName(response.url()))) payloads.push(response.body().then(body => body.byteLength))
        }
        page.on('request', onRequest); page.on('response', onResponse)
        await page.goto('/settings')
        const button = page.getByRole('button', { name: 'Открыть конструктор', exact: true })
        await expect(button).toBeEnabled()
        const start = performance.now()
        await button.click()
        const builder = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Конструктор шаблона', exact: true }) })
        await expect(builder.getByRole('cell', { name: 'Ячейка A2', exact: true })).toBeVisible()
        const constructorMs = performance.now() - start
        await page.waitForLoadState('networkidle')
        const metrics = await page.evaluate(() => ({
          readyMs: (window as unknown as { templateReadyMs: number }).templateReadyMs,
          longTasks: (window as unknown as { templateLongTasks: number[] }).templateLongTasks,
        }))
        expect(rpc.filter(name => name === 'getRemoteDocumentTemplateInventory_createServerFn_handler')).toHaveLength(1)
        expect(rpc.filter(name => name === 'getRemoteDocumentTemplate_createServerFn_handler').length).toBeLessThanOrEqual(1)
        measures.push({ files: count, fileBytes: bytes.byteLength, round, ...metrics, constructorMs,
          templateBytes: (await Promise.all(payloads)).reduce((sum, n) => sum + n, 0), rpc })
        page.off('request', onRequest); page.off('response', onResponse)
        if (round === 0) await page.screenshot({ path: info.outputPath(`constructor-${count}.png`) })
      }
    }
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await withE2eDatabase(db => db.query('delete from document_templates where id=any($1::text[])', [ids]))
    for (const id of ids) await store.delete(`${id}/performance.xlsx`)
    await writeFile(info.outputPath('template-loading.json'), JSON.stringify(measures, null, 2))
  }
})
