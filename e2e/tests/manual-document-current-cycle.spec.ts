import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { documentGridRow } from '../document-grid'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'

const project = 'E2E manual document current cycle'
const types = [['weldingJournal', 'ЖСР'], ['checklist', 'Чек-лист'], ['zni', 'ЗНИ']] as const
const fields = ['joint', 'pstoRequest', 'pstoDate', 'heatTreatmentDiagram', 'pstoResult',
  'tvmtRequest', 'tvmtResult', 'tvmtConclusionDate', 'tvmtConclusion']
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
let fileKey = ''

test.afterEach(async ({ page }) => {
  await page.close()
  await withE2eDatabase(db => db.query('delete from document_templates where blob_key=$1', [fileKey]))
  await cleanupLineProgramProjects([project])
  if (fileKey) await store.delete(fileKey)
})

test('ЖСР, чек-лист и ЗНИ: формирование и свежий Excel используют текущий цикл, включая пустой повтор', async ({ page }) => {
  test.setTimeout(120_000)
  expect(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH).toContain('welding-e2e-templates-')
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([fields, fields.map(() => '')]), 'Бланк')
  const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  fileKey = `e2e-current-cycle/${randomUUID()}.xlsx`
  await store.set(fileKey, data)
  const id = await withLineProgramFixture(async db => {
    expect((await db.query('select id from document_templates where id=any($1::text[])', [types.map(([type]) => type)])).rows).toEqual([])
    for (const [type] of types) await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
      values($1,$2,'current-cycle.xlsx','xlsx',$3,$4,$5)`, [type, fileKey, data.byteLength,
      JSON.stringify({ fields: [], markerCount: 0, locations: [], warnings: [] }),
      JSON.stringify({ version: 1, sheetName: 'Бланк', repeatRow: 2,
        bindings: fields.map((field, column) => ({ cell: XLSX.utils.encode_cell({ r: 1, c: column }), mode: 'row', field })) })])
    const { rows: [row] } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
      connection_type,psto_required,psto_request,psto_request_date,psto_date,heat_treatment_diagram,psto_result,
      tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion_date,tvmt_conclusion)
      values($1,'CYCLE','CYCLE-L','S1','2026-10-15','С17','да','PSTO-1','2026-10-15','2026-10-16','DIAGRAM-1','проведено',
        'TVMT-1','2026-10-16','не годен','2026-10-17','CONCLUSION-1') returning id`, [project])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,heat_treatment_diagram,
      psto_result,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion_date,tvmt_conclusion)
      values($1,2,'PSTO-2','2026-10-18','2026-10-19','DIAGRAM-2','проведено','TVMT-2','2026-10-20','годен','2026-10-21','CONCLUSION-2')`, [row.id])
    return row.id as number
  })
  const facts = () => withE2eDatabase(async db => ({
    primary: (await db.query('select psto_request,psto_date,heat_treatment_diagram,psto_result,tvmt_result,tvmt_conclusion from weld_joints where id=$1', [id])).rows,
    cycles: (await db.query('select * from psto_repeat_cycles where weld_joint_id=$1 order by sequence', [id])).rows,
  }))
  const initialFacts = await facts(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/documents')
  for (const [type, label] of types) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('tab', { name: 'Формирование', exact: true }).click()
    await page.getByLabel('Период с', { exact: true }).fill('2026-10-15')
    await page.getByLabel('по', { exact: true }).fill('2026-10-15')
    await expect(page.getByText('Лист «Бланк»: показаны первые 1 из 1', { exact: true })).toBeVisible()
    await expect(page.getByText('DIAGRAM-2', { exact: true })).toBeVisible()
    await expect(page.getByText('CONCLUSION-2', { exact: true })).toBeVisible()
    await page.getByLabel('Название документа').fill(`CYCLE-${type}`)
    await page.getByRole('button', { name: 'Сформировать', exact: true }).click()
    await expect.poll(() => withE2eDatabase(async db => (await db.query('select count(*)::int n from generated_documents where title=$1', [`CYCLE-${type}`])).rows[0].n)).toBe(1)
    await page.getByRole('tab', { name: 'История', exact: true }).click()
    const row = await documentGridRow(page, `CYCLE-${type}`)
    const pending = page.waitForEvent('download')
    await row.actions.getByTitle('Скачать Excel', { exact: true }).click()
    const file = await pending
    expect(await file.failure()).toBeNull()
    const sheet = XLSX.read(await readFile((await file.path())!), { type: 'buffer' }).Sheets['Бланк']
    expect(fields.map((_, column) => sheet[XLSX.utils.encode_cell({ r: 1, c: column })]?.v ?? '')).toEqual([
      'S1', 'PSTO-2', '19.10.2026', 'DIAGRAM-2', 'проведено', 'TVMT-2', 'годен', '21.10.2026', 'CONCLUSION-2',
    ])
  }
  expect(await facts()).toEqual(initialFacts)
  await withLineProgramFixture(async db => {
    await db.query("update psto_repeat_cycles set tvmt_result='не годен' where weld_joint_id=$1 and sequence=2", [id])
    await db.query("insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date) values($1,3,'PSTO-3','2026-10-22')", [id])
  })
  const latestFacts = await facts()
  await page.reload()
  for (const [type, label] of types) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('tab', { name: 'История', exact: true }).click()
    const row = await documentGridRow(page, `CYCLE-${type}`)
    const pending = page.waitForEvent('download')
    await row.actions.getByTitle('Скачать Excel', { exact: true }).click()
    const file = await pending
    expect(await file.failure()).toBeNull()
    const sheet = XLSX.read(await readFile((await file.path())!), { type: 'buffer' }).Sheets['Бланк']
    expect(fields.map((_, column) => sheet[XLSX.utils.encode_cell({ r: 1, c: column })]?.v ?? '')).toEqual([
      'S1', 'PSTO-3', '', '', '', '', '', '', '',
    ])
  }
  expect(await facts()).toEqual(latestFacts)
  expect(errors).toEqual([])
})
