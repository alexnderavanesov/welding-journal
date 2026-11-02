import { expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import * as XLSX from 'xlsx'
import { and, eq, isNotNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { cleanupLineProgramProjects, withLineProgramFixture } from './line-program-fixtures'
import { withE2eDatabase } from './database'
import { createDocumentTemplateFileStore } from '../src/server/document-template-files'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../src/server/system-document-index'
import * as schema from '../src/db/schema'

// Shared, isolated setup for Chrome and installed Safari. Only setup imports
// current server handlers; every measured operation uses the HTTP bundle.
export const project = 'E2E Deep Report Opening'
export const total = process.env.DEEP_OPENING_JOINT_COUNT === '200000' ? 200_000 : 9000
export const documentCount = Number(process.env.DEEP_OPENING_DOCUMENT_COUNT ?? 250)
export const rounds = Number(process.env.DEEP_OPENING_ROUNDS ?? 3)
export const repeatRounds = Number(process.env.DEEP_OPENING_REPEAT_ROUNDS ?? 20)
export const firstJoint = 'F99000001', firstLine = 'OPEN-0000', manualTitle = 'DEEP-DOC-00001'
let templateKey = ''
export let templateBytes = 0
let previousOther: string | undefined

export async function setupDeepOpeningFixture() {
  console.log('DEEP_OPENING_FIXTURE', JSON.stringify({ state: 'start', joints: total, documentCount }))
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect([undefined, '9000', '200000']).toContain(process.env.DEEP_OPENING_JOINT_COUNT)
  expect(Number.isInteger(documentCount) && documentCount >= 100 && documentCount <= total).toBe(true)
  expect(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20).toBe(true)
  expect(Number.isInteger(repeatRounds) && repeatRounds >= 1 && repeatRounds <= 100).toBe(true)
  // The runner owns a disposable directory, never the working template store.
  const directory = process.env.DOCUMENT_TEMPLATE_STORAGE_PATH
  if (!directory || !directory.includes('welding-e2e-templates-')) throw new Error('Expected the runner-owned disposable template directory')
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Журнал сварки — измерительный шаблон', '', '', ''], ['Стык', 'Линия', 'Проект', 'Изометрия'], ['', '', '', ''],
  ])
  sheet['!cols'] = [{ wpx: 120 }, { wpx: 180 }, { wpx: 280 }, { wpx: 180 }]
  sheet['!merges'] = [XLSX.utils.decode_range('A1:D1')]
  XLSX.utils.book_append_sheet(workbook, sheet, 'Журнал')
  // A real multi-sheet workbook with ordinary reference text, not random
  // padding. Explicitly report its bytes so small/large templates aren't mixed.
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(Array.from({ length: 600 }, (_, i) =>
    [`Примечание ${i + 1}`, `Поле ${i % 20 + 1}`, 'Контроль заполнения формы', 'Сварочные соединения'])), 'Инструкция')
  const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  templateBytes = data.byteLength
  templateKey = `e2e-deep-opening/${randomUUID()}.xlsx`
  await createDocumentTemplateFileStore(directory).set(templateKey, data)
  await withLineProgramFixture(async db => {
    expect((await db.query('select id from document_templates')).rows).toHaveLength(0)
    previousOther = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}') on conflict(key) do update set value=excluded.value`)
    await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
      values('weldingJournal',$1,'opening.xlsx','xlsx',$2,$3,$4)`, [templateKey, templateBytes,
      JSON.stringify({ sheetNames: ['Журнал', 'Инструкция'], fields: [], markerCount: 0, locations: [], warnings: [] }),
      JSON.stringify({ version: 1, sheetName: 'Журнал', repeatRow: 3, bindings: [
        { cell: 'A3', mode: 'row', field: 'joint' }, { cell: 'B3', mode: 'row', field: 'line' },
        { cell: 'C3', mode: 'row', field: 'projectTitle' }, { cell: 'D3', mode: 'row', field: 'isometry' },
      ] })])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,isometry,officiality,revision_actuality,
      connection_type,d1,t1,wdi,has_vik,vik_result,vik_request,vik_request_date,psto_required)
      select $1,'OPENING','OPEN-'||lpad(((n-1)/100)::text,4,'0'),'F99'||lpad(n::text,6,'0'),
        '2026-10-01','BEFORE','действующий','актуальная','С17',108,4,1,'да','годен',
        case when n<=$3 then 'DEEP-REQ-'||lpad(n::text,5,'0') end,
        case when n<=$3 then date '2026-10-02' end,'да'
      from generate_series(1,$2::int) n`, [project, total, documentCount])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [project])
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','DEEP-DOC-'||lpad(n::text,5,'0'),'opening.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1 from generate_series(1,$1::int) n`, [documentCount])
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d join weld_joints w
        on w.project_title=$1 and w.joint='F99'||lpad(substring(d.title from 10)::int::text,6,'0')
      where d.type='weldingJournal' and d.title like 'DEEP-DOC-%'`, [project])
    for (const table of ['weld_joints', 'weld_joint_program_states', 'generated_documents', 'generated_document_weld_joints']) await db.query(`analyze ${table}`)
  })
  // Fixture-only parity with documents-grid.spec.ts. A raw INSERT does not
  // execute the ordinary save's system-document synchronization. Use a real
  // Drizzle transaction after the fixture transaction commits; never nest a
  // second BEGIN inside withLineProgramFixture's connection-owned BEGIN.
  await withE2eDatabase(db => drizzle(db, { schema }).transaction(async tx => {
    const documentRows = await tx.select().from(schema.weldJoints)
      .where(and(eq(schema.weldJoints.projectTitle, project), isNotNull(schema.weldJoints.vikRequest)))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, documentRows, new Map())
  }))
  console.log('DEEP_OPENING_FIXTURE', JSON.stringify({ state: 'ready', joints: total, documentCount, templateBytes }))
}

export async function cleanupDeepOpeningFixture() {
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    await db.query('delete from document_templates where blob_key=$1', [templateKey])
    if (previousOther === undefined) await db.query("delete from app_settings where key='other'")
    else await db.query("update app_settings set value=$1 where key='other'", [previousOther])
  })
  if (templateKey) await createDocumentTemplateFileStore(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH!).delete(templateKey)
}
