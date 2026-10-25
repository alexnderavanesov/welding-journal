// Opt-in: consumes an already downloaded local inventory, never contacts prod.
import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { downloadPreviewExcel } from '../document-sheet'
import { DOCUMENT_TEMPLATE_TYPES, type StoredDocumentTemplate } from '../../src/lib/document-template-model'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { loadSystemDocumentSummaries, syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { createWeldingJournalBlobFromTemplate } from '../../src/lib/document-template-workbook'
import { readHistoryDocumentWorkbook } from '../../src/lib/history-document-preview'
import { buildPreviewFrameHtml, PREVIEW_FRAME_SANDBOX } from '../../src/lib/document-preview-frame'

test('local production-template copy: constructor bindings and filled Excel', async ({ page }, info) => {
  test.skip(!process.env.LOCAL_TEMPLATE_AUDIT)
  test.setTimeout(180000)
  const inventory = JSON.parse(await readFile(process.env.LOCAL_TEMPLATE_AUDIT!, 'utf8')) as {
    templates: Array<StoredDocumentTemplate & { fileDataBase64: string }>; missing: unknown[]
  }
  expect(inventory.missing).toEqual([])
  expect(inventory.templates).toHaveLength(16)
  const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
  const project = 'E2E real template audit'
  const keys: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const snapshot = () => withE2eDatabase(async db => (await db.query('select id,constructor_config,options,updated_at from document_templates order by id')).rows)
  await loadSystemDocumentSummaries('lnkConclusion')
  try {
    await withE2eDatabase(async db => {
      expect((await db.query('select id from document_templates')).rows).toEqual([])
      for (const t of inventory.templates) {
        const key = `real-template-audit/${randomUUID()}.xlsx`
        const bytes = Buffer.from(t.fileDataBase64, 'base64')
        await store.set(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
        keys.push(key)
        const { sheetNames, fields, markerCount, locations, warnings } = t
        await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,options,constructor_config)
          values($1,$2,$3,$4,$5,$6,$7,$8)`, [t.id, key, t.fileName, t.fileType, bytes.length,
          JSON.stringify({ sheetNames, fields, markerCount, locations, warnings }), JSON.stringify(t.options), JSON.stringify(t.constructorConfig)])
      }
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
        has_vik,vik_request,vik_request_date,d1,t1,d2,t2,welding_method,vik_result,vik_conclusion,vik_conclusion_date)
        values($1,'PREVIEW','LINE','F001','2026-10-01','действующий','актуальная','да','E2E-PREVIEW-REAL-REQUEST',
        '2026-10-02',159,10,159,10,'РАД','годен','E2E-PREVIEW-REAL-VIK','2026-10-03')`, [project])
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
        values('checklist','E2E-PREVIEW-REAL-CHECK','check.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1) returning id`)).rows[0].id
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        select $1,id from weld_joints where project_title=$2 and joint='F001'`, [id, project])
    })
    await requireDb().transaction(async tx => {
      const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    })
    const original = await snapshot()
    // Inspect the filled local copies, including JPEG (checklist), BMP (ZNI)
    // and PNG (PSTO). No production page, record or service is accessed.
    const layouts = []
    for (const template of inventory.templates) {
      const bytes = Buffer.from(template.fileDataBase64, 'base64')
      const blob = await createWeldingJournalBlobFromTemplate({ ...template, fileData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }, [
        { projectTitle: 'Проект проверки', subtitleCode: '330-ТКМ5', line: 'LINE-1', joint: 'F001', d1: '159', t1: '10', d2: '159', t2: '10', weldingMethod: 'РАД', weldDate: '2026-10-01', vikResult: 'годен', vikConclusion: 'E2E-PREVIEW-REAL-VIK', vikConclusionDate: '2026-10-03' },
      ])
      const workbook = await readHistoryDocumentWorkbook(await blob.arrayBuffer())
      await page.setContent(`<iframe sandbox="${PREVIEW_FRAME_SANDBOX}" style="width:100%;height:950px;border:0"></iframe>`)
      await page.locator('iframe').evaluate((el, html) => { (el as HTMLIFrameElement).srcdoc = html }, buildPreviewFrameHtml(workbook.page(0, 0, 0, template.id)))
      const frame = page.frameLocator('iframe')
      await expect(frame.locator('table')).toBeVisible()
      const count = workbook.sheets[0].images.length
      await expect(frame.locator('img')).toHaveCount(count)
      if (['checklist', 'zni', 'pstoConclusion'].includes(template.id)) expect(count).toBeGreaterThan(0)
      for (const image of await frame.locator('img').all()) await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
      for (const picture of await frame.locator('[data-excel-picture]').all()) {
        expect(await picture.evaluate(el => {
          const image = el.getBoundingClientRect(), paper = el.closest('[data-document-preview-page]')!.getBoundingClientRect()
          return image.left >= paper.left - 1 && image.right <= paper.right + 1 && image.top >= paper.top - 1 && image.bottom <= paper.bottom + 1
        })).toBe(true)
      }
      const layout = await frame.locator('table').evaluate(table => ({ width: table.getBoundingClientRect().width, height: table.getBoundingClientRect().height,
        maxRow: Math.max(...Array.from(table.querySelectorAll('tr'), row => row.getBoundingClientRect().height)) }))
      layouts.push({ id: template.id, images: count, ...layout })
      await page.locator('iframe').evaluate((el: HTMLIFrameElement) => {
        const paper = el.contentDocument!.querySelector<HTMLElement>('[data-document-preview-page]')!
        paper.style.zoom = String(Math.min(1, (el.clientWidth - 32) / paper.offsetWidth))
      })
      await page.screenshot({ path: info.outputPath(`${template.id}-sheet.png`) })
    }
    await writeFile(info.outputPath('sheet-layouts.json'), JSON.stringify(layouts, null, 2))
    await page.goto('/settings')
    for (const t of inventory.templates) {
      const profile = DOCUMENT_TEMPLATE_TYPES.find(profile => profile.id === t.id)!
      const category = t.id.startsWith('lnkConclusion') ? 'Заключения ЛНК' : t.id.startsWith('layered') ? 'Послойный НК' : profile.label
      await page.getByRole('button', { name: new RegExp(`^${category} `) }).click()
      if (category === 'Заключения ЛНК' || category === 'Послойный НК') await page.getByRole('tab', { name: profile.label.replace(/^Заключение /, ''), exact: true }).click()
      await page.getByRole('button', { name: 'Открыть конструктор', exact: true }).click()
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Конструктор шаблона', exact: true }) })
      for (const b of t.constructorConfig!.bindings) await expect(dialog.getByRole('button', { name: new RegExp(`^${b.cell} `) }).first()).toBeVisible()
      await expect(dialog.getByText(/^Ошибок: /)).toHaveCount(0)
      if (t.id === 'lnkConclusionVik' || t.id === 'checklist') await dialog.screenshot({ path: info.outputPath(`${t.id}-constructor.png`) })
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
    }
    expect(await snapshot()).toEqual(original)
    await page.goto('/documents')
    for (const [view, title] of [['Чек-лист', 'E2E-PREVIEW-REAL-CHECK'], ['Заключения ЛНК', 'E2E-PREVIEW-REAL-VIK']]) {
      await page.getByRole('button', { name: view, exact: true }).click()
      await page.getByRole('button', { name: title, exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
      await expect(modal.frameLocator('iframe').getByText(/F001/).first()).toBeVisible()
      await modal.screenshot({ path: info.outputPath(`${title}-sheet.png`) })
      const file = await downloadPreviewExcel(page, modal)
      await writeFile(info.outputPath(`${title}.xlsx`), file.bytes)
      expect(file.text).toContain('F001')
      expect(file.text).toContain('159')
      expect(file.text.replace(/\s/g, '')).toContain('E2E-PREVIEW-REAL-VIK')
      await modal.screenshot({ path: info.outputPath(`${title}.png`) })
      await page.keyboard.press('Escape')
      await expect(modal).toBeHidden()
    }
    expect(errors).toEqual([])
  } finally {
    await withE2eDatabase(db => db.query('delete from document_templates where blob_key=any($1::text[])', [keys]))
    await cleanupLineProgramProjects([project])
    await Promise.all(keys.map(key => store.delete(key)))
  }
})
