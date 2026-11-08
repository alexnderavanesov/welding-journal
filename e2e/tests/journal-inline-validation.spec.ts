import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'
import { saveJournalCellEdits, pasteJournalCells } from '../../src/server/journal-inline-edit'
import { readJournalGrid } from '../../src/server/journal-grid'
import { FIELD_BY_KEY, type WeldFieldKey } from '../../src/lib/weld-fields'
import { JOURNAL_INLINE_FIELDS } from '../../src/lib/journal-inline-edit'
import { journalRow, revealJournalColumn } from '../journal-grid'
import { runWithAccess } from '../../src/server/access-context'

const project = 'E2E journal unrelated fields'
const save = asE2eOwner(saveJournalCellEdits, 'welding.edit')
const paste = asE2eOwner(pasteJournalCells, 'welding.edit')
const read = asE2eOwner(readJournalGrid, 'welding.view')
const snapshot = () => withE2eDatabase(async db => (await db.query('select *, xmin::text version from weld_joints where project_title=$1 order by id', [project])).rows.map(row => ({
  ...row, sheet: row.sheet == null ? null : Number(row.sheet), revision_number: row.revision_number == null ? null : Number(row.revision_number),
})))
const technical = new Set(['version', 'updated_at', 'welding_updated_at', 'lnk_updated_at', 'psto_updated_at'])
const business = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !technical.has(key)))
const fieldValue = (key: WeldFieldKey) => FIELD_BY_KEY.get(key)!.kind === 'number' ? 2.5 : `Значение ${key}`
const history = () => withE2eDatabase(async db => {
  const result: Record<string, unknown[]> = {}
  for (const table of ['pre_heat_treatment_controls', 'psto_repeat_cycles', 'duplicate_controls']) result[table] = (await db.query(
    `select h.* from ${table} h join weld_joints w on w.id=h.weld_joint_id where w.project_title=$1 order by h.id`, [project],
  )).rows
  return result
})
const range = async (columns: WeldFieldKey[]) => {
  const query = { report: 'weldingJournal' as const, columnFilters: { projectTitle: project }, groupBy: [],
    sort: { fieldKey: 'id' as const, direction: 'asc' as const } }
  const result = await read({ ...query, route: [], start: 0, end: 100 })
  return { ...query, revision: result.revision, anchor: 'line' as const, parts: [{ route: [], start: 0, end: 7, columns }] }
}

async function seed() {
  await withLineProgramFixture(async db => {
    const program = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'NEUTRAL','L','II','Б(а)',0,0) returning id`, [project])).rows[0].id
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,material_group,welding_method,
      officiality,revision_actuality,has_vik,isometry,welding_journal_note,final_status)
      select $1,$2,'NEUTRAL','L','F'||n,'С17','М01','РД','действующий','актуальная','да','ISO','Note','ожидает сварку'
      from generate_series(1,7) n`, [program, project])
    // Independent counterexamples, not one row whose first error masks the rest.
    const rows = (await db.query('select id from weld_joints where project_title=$1 order by id', [project])).rows
    await db.query("update weld_joints set joint='ОП-8',connection_type='Т1',material_group='М01 + М05',welding_method='РАД+РД',stamp_1_z_fact='OLD' where id=$1", [rows[0].id])
    await db.query("update weld_joints set weld_date='2999-01-01',stamp_1_k='MISSING' where id=$1", [rows[1].id])
    await db.query("update weld_joints set joint='F3R2',d1=57,d2=57,uzk_result='ремонт',has_uzk='да' where id=$1", [rows[2].id])
    await db.query("update weld_joints set weld_date='2026-07-01',stamp_1_k=null where id=$1", [rows[3].id])
    await db.query("update weld_joints set joint='F5R0',material_group='М01 + М05 + М11' where id=$1", [rows[4].id])
    await db.query("update weld_joints set connection_type='У19',layered_control_assigned=true,has_pvk='да',pvk_result='ремонт' where id=$1", [rows[5].id])
    await db.query("update weld_joints set has_vik='отменен',vik_request='OLD',vik_request_date='2026-07-01',vik_result='ожидает НК',psto_result='ожидает заявку',psto_date='2026-07-01',heat_treatment_diagram='OLD' where id=$1", [rows[6].id])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,conclusion_name,conclusion_date,result)
      values($1,'РК','PRE','2026-06-01','PRE-C','2026-06-02','ремонт')`, [rows[6].id])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,psto_result,heat_treatment_diagram)
      values($1,2,'RP','2026-07-02','2026-07-03','проведено','RP-C')`, [rows[6].id])
    await db.query(`insert into duplicate_controls(weld_joint_id,method,control_date,conclusion,conclusion_date,result)
      values($1,'РК','2026-07-04','DUP-C','2026-07-05','годен')`, [rows[6].id])
  })
}
test.afterEach(async ({ page }) => { await page.close(); await cleanupLineProgramProjects([project]) })

test('all eleven fields fill and clear without changing legacy parameters, controls or history', async () => {
  await seed()
  const original = await snapshot()
  const originalHistory = await history()
  for (const field of JOURNAL_INLINE_FIELDS) {
    const before = await snapshot()
    await save({ edits: before.map(row => ({ id: row.id, version: row.version, values: { [field]: fieldValue(field) } })) })
    const filled = await snapshot(), column = FIELD_BY_KEY.get(field)!.dbName
    for (const [i, row] of filled.entries()) expect(business(row)).toEqual({ ...business(before[i]), [column]: fieldValue(field) })
    await save({ edits: filled.map(row => ({ id: row.id, version: row.version, values: { [field]: null } })) })
    const cleared = await snapshot()
    for (const [i, row] of cleared.entries()) expect(business(row)).toEqual({ ...business(filled[i]), [column]: null })
  }
  const editedColumns = new Set<string>([...JOURNAL_INLINE_FIELDS].map(field => FIELD_BY_KEY.get(field)!.dbName))
  for (const [i, row] of (await snapshot()).entries()) {
    expect(Object.fromEntries(Object.entries(business(row)).filter(([key]) => !editedColumns.has(key))))
      .toEqual(Object.fromEntries(Object.entries(business(original[i])).filter(([key]) => !editedColumns.has(key))))
  }
  expect(await history()).toEqual(originalHistory)
})

test('range writes remain atomic, reject forbidden fields and stale clients, and serialize simultaneous edits', async () => {
  await seed()
  const columns = [...JOURNAL_INLINE_FIELDS]
  const selection = await range(columns)
  // Opening the report legitimately publishes calculated statuses first.
  // Compare the saved snapshot immediately before the edit, not seed values.
  const before = await snapshot(), originalHistory = await history()
  await paste({ range: selection, values: before.map(() => columns.map(field => String(fieldValue(field)))) })
  for (const [i, row] of (await snapshot()).entries()) expect(business(row)).toEqual({ ...business(before[i]),
    ...Object.fromEntries(columns.map(field => [FIELD_BY_KEY.get(field)!.dbName, fieldValue(field)])) })
  await expect(paste({ range: selection, values: [['stale']] })).rejects.toThrow()
  const fresh = await range(columns)
  const invalid = before.map(() => columns.map(field => String(fieldValue(field))))
  invalid[6][columns.indexOf('sheet')] = 'не число'
  const filled = await snapshot()
  await expect(paste({ range: fresh, values: invalid })).rejects.toThrow('число')
  expect(await snapshot()).toEqual(filled)
  await expect(save({ edits: filled.slice(0, 2).map((row, index) => ({ id: row.id, version: row.version,
    values: { sheet: index ? 1e20 : 1, weldingJournalNote: 'Must roll back' },
  })) })).rejects.toThrow()
  expect(await snapshot()).toEqual(filled)
  for (const field of ['spool', 'materialGroup', 'connectionType', 'stamp1K', 'weldDate', 'hasRk', 'vikResult', 'pstoResult', 'revisionActuality', 'jsrDocument']) {
    await expect(save({ edits: [{ id: filled[0].id, version: filled[0].version, values: { [field]: null } }] })).rejects.toThrow('нельзя редактировать')
  }
  const results = await Promise.allSettled(['A', 'B'].map(value => save({ edits: filled.slice(0, 2).map(row => ({
    id: row.id, version: row.version, values: { responsible: value },
  })) })))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  const concurrent = await snapshot()
  expect(concurrent[0].responsible).toBe(concurrent[1].responsible)
  await paste({ range: await range(columns), values: [['']] })
  for (const [i, row] of (await snapshot()).entries()) expect(business(row)).toEqual({ ...business(before[i]),
    ...Object.fromEntries(columns.map(field => [FIELD_BY_KEY.get(field)!.dbName, null])) })
  expect(await history()).toEqual(originalHistory)
})

test('view-only access cannot save or paste; history records only the submitted field', async () => {
  await seed()
  const [row] = await snapshot(), edits = [{ id: row.id, version: row.version, values: { weldingJournalNote: 'Audit note' } }]
  const identity = { id: 'readonly-fixture', name: 'Reader', email: 'reader@example.test', title: '',
    role: 'user' as const, permissions: ['welding.view' as const], revision: 1 }
  await expect(runWithAccess(identity, 'test', [], () => saveJournalCellEdits({ edits }))).rejects.toThrow('прав')
  await expect(runWithAccess(identity, 'test', [], () => pasteJournalCells({ range: null as never, values: [['']] }))).rejects.toThrow('прав')
  expect((await snapshot())[0]).toEqual(row)
  await save({ edits })
  const audit = await withE2eDatabase(async db => (await db.query(
    "select changes from audit_changes where entity='weld_joints' and entity_id=$1 order by id desc limit 1", [String(row.id)],
  )).rows[0])
  expect(audit.changes).toEqual({ weldingJournalNote: { before: 'Note', after: 'Audit note' } })
})

test('inline edits preserve existing layered history and refresh only a title that uses the edited field', async () => {
  await seed()
  const target = (await snapshot())[5], type = 'layeredPvkEdges'
  const previousTemplate = await withE2eDatabase(async db => {
    const old = (await db.query('select * from document_templates where id=$1', [type])).rows[0]
    await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
      values($1,'inline-fixture','fixture.xlsx','xlsx',0,'{}',$2) on conflict(id) do update set constructor_config=excluded.constructor_config`,
    [type, JSON.stringify({ nameConfig: { parts: [{ type: 'field', field: 'isometry' }] } })])
    // A second historical assignment must not be removed by an annotation.
    for (const number of [null, 78]) {
      const document = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,
        row_count,wdi_total,document_number,source_metadata,specialists_revision)
        values($1,$2,$3,'legacy/type','2025-01-01','2025-01-02',2,null,$4,'{"kind":"layeredControl","version":2}',3) returning id`,
      [type, `Historical ${number}`, `Historical ${number}.xlsx`, number])).rows[0]
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [document.id, target.id])
    }
    return old
  })
  const docs = () => withE2eDatabase(async db => (await db.query(`select d.*,a.created_at assignment_created_at from generated_documents d
    join generated_document_weld_joints a on a.document_id=d.id where a.weld_joint_id=$1 order by d.id`, [target.id])).rows)
  try {
    const before = await docs()
    await save({ edits: [{ id: target.id, version: target.version, values: { weldingJournalNote: 'Unrelated note' } }] })
    expect(await docs()).toEqual(before)
    const fresh = (await snapshot())[5]
    await save({ edits: [{ id: fresh.id, version: fresh.version, values: { isometry: 'ISO-UPDATED' } }] })
    const after = await docs()
    expect(after).toHaveLength(2)
    expect(after[0]).toEqual({ ...before[0], title: 'ISO-UPDATED', file_name: 'ISO-UPDATED.xlsx', updated_at: after[0].updated_at })
    expect(after[1]).toEqual(before[1])
    expect(business((await snapshot())[5])).toEqual({ ...business(target), welding_journal_note: 'Unrelated note', isometry: 'ISO-UPDATED' })
  } finally {
    await withE2eDatabase(async db => {
      await db.query('delete from generated_documents where id in (select document_id from generated_document_weld_joints where weld_joint_id=$1)', [target.id])
      if (previousTemplate) await db.query('update document_templates set constructor_config=$2 where id=$1', [type, previousTemplate.constructor_config])
      else await db.query('delete from document_templates where id=$1', [type])
    })
  }
})

test('every inline editor fills and clears an existing invalid joint without a card', async ({ page }) => {
  await seed()
  const [first] = await snapshot()
  await page.addInitScript(() => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
  })))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  const frame = page.locator('.journal-grid-frame')
  await expect(page.getByText('Найдено: 7', { exact: true })).toBeVisible()
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  for (const field of JOURNAL_INLINE_FIELDS) {
    await revealJournalColumn(page, field)
    const cell = journalRow(page, first.id).locator(`[col-id="${field}"]`)
    await cell.dblclick()
    const editor = page.getByTestId('journal-inline-editor')
    await editor.getByRole('textbox').fill(String(fieldValue(field)))
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect.poll(async () => (await snapshot())[0][FIELD_BY_KEY.get(field)!.dbName]).toBe(fieldValue(field))
    await expect(frame).toHaveAttribute('aria-busy', 'false')
    await cell.click(); await page.keyboard.press('Delete')
    await expect.poll(async () => (await snapshot())[0][FIELD_BY_KEY.get(field)!.dbName]).toBeNull()
    await expect(frame).toHaveAttribute('aria-busy', 'false')
  }
})
