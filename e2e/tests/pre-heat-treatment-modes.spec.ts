import { test, expect } from '@playwright/test'
import pg from 'pg'
import { eq, inArray } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints, preHeatTreatmentControls, appSettings } from '../../src/db/schema'
import { PRE_HEAT_SELECTED_TRANSITION_KEY } from '../../src/lib/release-contract'
import { initializePreHeatTreatmentMode } from '../../src/server/pre-heat-treatment-mode-transition'
import { previewNewPreHeatTreatment } from '../../src/server/new-pre-heat-treatment'
import { getPstoLineIdentityKey } from '../../src/lib/psto-line-assignment'
import { readPreHeatTreatmentChain, prepareCardPreHeatTreatment, finishCardPreHeatTreatment } from '../../src/server/pre-heat-treatment-chain'
import { lockPreHeatTreatmentFillCounters, planPreHeatTreatmentFill, savePreHeatTreatmentFillInTransaction, previewPreHeatTreatmentFill, savePreHeatTreatmentFill } from '../../src/server/pre-heat-treatment-fill'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { previewPreHeatTreatmentBatch, savePreHeatTreatmentBatch, readPreHeatTreatmentBatch } from '../../src/server/pre-heat-treatment-batch'
import { attachHeatTreatmentControlRelations } from '../../src/server/heat-treatment-control-relations'
import { buildLnkWorkflowRowsWhere, listLnkWorkflowRows } from '../../src/server/lnk-workflow-context'
import { prepareControlProcessSettingsChangeInTransaction } from '../../src/server/control-process-settings'
import { listWeldingJournalPage, listWeldColumnFilterOptions } from '../../src/server/weld-read'
import { computeStatisticsServerResult } from '../../src/server/statistics'
import { persistPreHeatTreatmentTouchedRows } from '../../src/server/pre-heat-treatment-lnk-workflow'
import { previewChainActualityInTransaction } from '../../src/server/chain-actuality'
import { updateWeldJoint, createWeldJoint } from '../../src/server/weld-mutations'
import { moveWeldJointChainRecord } from '../../src/server/weld-chain-line-move'
import { markDispatcherTaskIndexDirty, getDispatcherDirtyScopes } from '../../src/server/dispatcher-task-index-dirty'
import { asE2eOwner } from '../with-owner-access'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { selectLnkRow, lnkRow } from './lnk-grid-helpers'
import type { PreHeatTreatmentFillOptions } from '../../src/lib/pre-heat-treatment-fill'
const project = 'E2E selective preliminary NK'
let oldSettings: string | undefined
let ids: number[]
const owner = <A extends unknown[], R>(action: (...args: A) => Promise<R>) => asE2eOwner(action, 'welding.edit')
test.beforeEach(async () => {
  await withLineProgramFixture(async db => {
    oldSettings = (await db.query("select value from app_settings where key='control-processes'")).rows[0]?.value
    await db.query("insert into app_settings(key,value) values('control-processes',$1) on conflict(key) do update set value=excluded.value", [JSON.stringify({ preHeatTreatmentMode: 'selected', pvkGoodOnly: false })])
    ids = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,psto_required,pre_heat_treatment_required)
      select $1,'NK','NK-L',name,'2026-11-01','С17','да','да',true from unnest(array['F881','F881R1','F881R1','F881Y1','F881Y2','F882']) name returning id`, [project])).rows.map(row => row.id)
    await db.query("update weld_joints set officiality='неофициальный' where id=$1", [ids[2]])
    await db.query('update weld_joints set pre_heat_treatment_required=false where id=any($1::int[])', [[ids[3], ids[4]]])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    if (oldSettings) await db.query("update app_settings set value=$1 where key='control-processes'", [oldSettings])
    else await db.query("delete from app_settings where key='control-processes'")
  })
})
const chain = (id: number) => requireDb().transaction(tx => readPreHeatTreatmentChain(tx, id))
const change = owner(async (id: number, required: boolean, token: string, fill?: PreHeatTreatmentFillOptions) => requireDb().transaction(async tx => {
  if (fill) await lockPreHeatTreatmentFillCounters(tx)
  const prepared = await prepareCardPreHeatTreatment(tx, id, { required, token, ...(fill ? { fill } : {}) }, 'welding')
  await finishCardPreHeatTreatment(tx, prepared!)
}))
const previewFill = (rowIds: number[]) => requireDb().transaction(async tx => {
  await lockPreHeatTreatmentFillCounters(tx)
  const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, rowIds))
  return planPreHeatTreatmentFill(tx, await attachHeatTreatmentControlRelations(rows, tx), {})
})
const confirmed = (plan: Awaited<ReturnType<typeof planPreHeatTreatmentFill>>): PreHeatTreatmentFillOptions => ({ token: plan.token,
  confirmedGroups: plan.groups.map(g => ({ key: g.key, name: g.name, date: g.date, itemKeys: g.items.map(i => i.key) })) })
test('standalone fill uses only selected marked continuation and the requirement column filters actual flags', async () => {
  const rowIds = [ids[1], ids[3]]
  const plan = await owner(previewPreHeatTreatmentFill)({ data: { rowIds, options: {} } })
  expect(plan.selectedCount).toBe(1)
  expect(plan.errors).toEqual([])
  expect(new Set(plan.items.map(item => item.rowId))).toEqual(new Set([ids[1]]))
  await owner(savePreHeatTreatmentFill)({ data: { rowIds, options: { token: plan.token,
    confirmedGroups: plan.groups.map(g => ({ key: g.key, name: g.name, date: g.date, itemKeys: g.items.map(i => i.key) })) } } })
  expect((await snapshot()).controls.map(control => control.weld_joint_id)).toEqual([ids[1]])
  for (const [value, expectedIds] of [['да', [ids[0], ids[1], ids[2], ids[5]]], ['', [ids[3], ids[4]]]] as const) {
    const page = await owner(listWeldingJournalPage)({ data: { projectTitle: project, columnFilters: { preHeatTreatmentRequired: buildWeldColumnValueFilter([value]) } } })
    expect(page.rows.map(row => row.id).sort()).toEqual([...expectedIds].sort())
  }
  const options = await owner(listWeldColumnFilterOptions)({ data: { projectTitle: project, fieldKey: 'preHeatTreatmentRequired' } })
  expect(options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'да', count: 4 }), expect.objectContaining({ value: '', count: 2 })]))
})

for (const [path, report] of [['/journal', 'weldingJournal'], ['/lnk', 'lnk'], ['/psto', 'heatTreatment']] as const) {
  test(`${report}: preliminary column separates three states with tooltips and named filters`, async ({ page }, info) => {
    await withLineProgramFixture(async db => {
      await db.query("update weld_joints set line='NO-PSTO',psto_required=null,psto_request='Historical PSTO' where id=any($1::int[])", [[...ids.slice(0, 3), ids[5]]])
      await db.query('update weld_joints set pre_heat_treatment_required=false where id=$1', [ids[5]])
    })
    const options = await owner(listWeldColumnFilterOptions)({ data: { report, projectTitle: project, fieldKey: 'preHeatTreatmentRequired' } })
    expect(options).toHaveLength(3)
    expect(options).toEqual(expect.arrayContaining([
      { value: 'да', label: 'Отметка включена (Да)', count: 3 },
      { value: '', label: 'Отметка выключена (пусто)', count: 2 },
      { value: '—', label: 'Не применяется (—)', count: 1 },
    ]))
    await page.setViewportSize({ width: 1800, height: 1000 })
    await page.goto(path)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    const grid = page.locator(`[data-weld-report-grid="${report}"]`)
    const rows = grid.locator('.ag-grid-scrolling-rows .ag-row')
    await expect(rows).toHaveCount(6)
    const viewport = grid.locator('.ag-grid-viewport')
    const header = grid.locator('.ag-header-cell[col-id="preHeatTreatmentRequired"]')
    for (let step = 0; step < 25 && !await header.count(); step++) {
      await viewport.evaluate(async element => { element.scrollLeft += 500; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
    }
    await expect(header).toBeAttached()
    await header.evaluate(element => element.scrollIntoView({ inline: 'center', block: 'nearest' }))
    for (const [id, text, tip] of [[ids[5], '—', 'не применяется'], [ids[3], '', 'не отмечен'], [ids[0], 'Да', 'Отметка НК до ТО сохранена']] as const) {
      const cell = rows.filter({ has: page.locator(`[data-weld-field-key="preHeatTreatmentRequired"]`) })
        .and(grid.locator(`[row-id="${id}"]`)).locator('[col-id="preHeatTreatmentRequired"]')
      await expect(cell).toHaveText(text)
      await cell.hover()
      await expect(page.getByRole('tooltip')).toContainText(tip)
      await header.hover()
      await expect(page.getByRole('tooltip')).toBeHidden()
    }
    await page.screenshot({ path: info.outputPath('preliminary-column-states.png') })
    await header.locator('.ag-header-cell-filter-button').click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: НК до ТО', exact: true })
    for (const [label, count] of [['Отметка включена (Да)', 3], ['Отметка выключена (пусто)', 2], ['Не применяется (—)', 1]] as const) {
      const option = filter.getByRole('checkbox', { name: new RegExp(label.replace(/[()]/g, '\\$&')) })
      await option.check()
      await expect(rows).toHaveCount(count)
      await option.uncheck()
      await expect(rows).toHaveCount(6)
    }
    await filter.getByRole('textbox').fill('выключена')
    await expect(filter.getByRole('checkbox')).toHaveCount(1)
    await filter.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
    await expect(rows).toHaveCount(2)
    await page.screenshot({ path: info.outputPath('preliminary-column-filter.png') })
    await page.keyboard.press('Escape')
    await expect(filter).toBeHidden()
  })
}
test('new unsaved joint uses the draft line, saves its explicit choice once and defaults other independent joints off', async () => {
  const draft = { projectTitle: project, subtitleCode: 'NK', line: 'NK-L', joint: 'F883' }
  const preview = await owner(previewNewPreHeatTreatment)({ data: draft })
  expect(preview).toMatchObject({ applicable: true, inherited: false, required: false })
  const inherited = await owner(previewNewPreHeatTreatment)({ data: { ...draft, joint: 'F881R2' } })
  expect(inherited).toMatchObject({ inherited: true, required: true })
  const created = await owner(createWeldJoint)({ data: { ...draft, newPreHeatTreatmentChoice: { required: true, identityKey: preview.identityKey } } })
  expect(created.preHeatTreatmentRequired).toBe(true)
  const ordinary = await owner(createWeldJoint)({ data: { ...draft, joint: 'F884' } })
  expect(ordinary.preHeatTreatmentRequired).toBe(false)
  const before = await snapshot()
  await expect(owner(createWeldJoint)({ data: { ...draft, joint: 'F885', line: 'other', newPreHeatTreatmentChoice: { required: true, identityKey: preview.identityKey } } })).rejects.toThrow('Линия изменилась')
  const noPsto = { ...draft, joint: 'F885', line: 'other' }
  await expect(owner(createWeldJoint)({ data: { ...noPsto, newPreHeatTreatmentChoice: { required: true, identityKey: getPstoLineIdentityKey(noPsto) } } })).rejects.toThrow('ПСТО не назначено')
  expect(await snapshot()).toEqual(before)
})

test('release transition preserves masked false requirements in full mode, retains selective choices and is idempotent', async () => {
  const rollback = new Error('test rollback')
  for (const oldMode of ['allPsto', 'selected']) {
    try {
      await requireDb().transaction(async tx => {
        await tx.delete(appSettings).where(eq(appSettings.key, PRE_HEAT_SELECTED_TRANSITION_KEY))
        await tx.update(appSettings).set({ value: JSON.stringify({ preHeatTreatmentMode: oldMode, pvkGoodOnly: true }) }).where(eq(appSettings.key, 'control-processes'))
        await tx.update(weldJoints).set({ preHeatTreatmentRequired: false }).where(inArray(weldJoints.id, ids.slice(0, 3)))
        await tx.update(weldJoints).set({ preHeatTreatmentRequired: null }).where(eq(weldJoints.id, ids[5]))
        await tx.insert(preHeatTreatmentControls).values({ weldJointId: ids[5], method: 'ВИК', result: 'ремонт', conclusionName: 'Preserved historical result' })
        const result = await initializePreHeatTreatmentMode(tx)
        expect(result).toMatchObject({ skipped: false, mode: 'selected', previousFullMode: oldMode === 'allPsto' })
        const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
        expect(rows.filter(row => row.preHeatTreatmentRequired).length).toBe(oldMode === 'allPsto' ? 6 : 0)
        expect(await tx.select().from(preHeatTreatmentControls).where(eq(preHeatTreatmentControls.weldJointId, ids[5]))).toEqual([expect.objectContaining({ result: 'ремонт', conclusionName: 'Preserved historical result' })])
        expect(await initializePreHeatTreatmentMode(tx)).toEqual({ skipped: true })
        throw rollback
      })
    } catch (error) { if (error !== rollback) throw error }
  }
})
const saveFill = owner(async (rowIds: number[], options: PreHeatTreatmentFillOptions) => requireDb().transaction(async tx => {
  await lockPreHeatTreatmentFillCounters(tx)
  const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, rowIds)).for('update')
  return savePreHeatTreatmentFillInTransaction(tx, await attachHeatTreatmentControlRelations(rows, tx), options)
}))
test('bulk preview batches one line instead of rereading it for every selected chain', async () => {
  const added = await withE2eDatabase(async db => (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,psto_required,pre_heat_treatment_required)
    select $1,'NK','NK-L','F' || (9000+n)::text,'да',false from generate_series(1,500) n returning id`, [project])).rows.map(row => row.id))
  const counts: number[] = []
  for (const selection of [added.slice(0, 1), added]) {
    const original = pg.Client.prototype.query
    let count = 0
    pg.Client.prototype.query = function(this: unknown, ...args: unknown[]) {
      count++; return (original as (...args: unknown[]) => unknown).apply(this, args)
    } as typeof original
    try {
      const start = performance.now()
      const preview = await owner(previewPreHeatTreatmentBatch)({ data: { rowIds: selection, required: true } })
      expect(preview.chains).toHaveLength(selection.length)
      counts.push(count)
      console.log(JSON.stringify({ preliminaryBatch: selection.length, queries: count, milliseconds: Math.round(performance.now() - start) }))
    } finally { pg.Client.prototype.query = original }
  }
  expect(counts[1]).toBe(counts[0])
})
test('bulk marking expands and deduplicates physical chains; combined fill keeps all method prerequisites', async () => {
  await withE2eDatabase(db => db.query("update weld_joints set officiality=null,pre_heat_treatment_required=false,has_pvk='да',has_rk='да',has_uzk='да' where id=any($1::int[])", [ids]))
  const rowIds = [ids[1], ids[2], ids[5]]
  const preview = await owner(previewPreHeatTreatmentBatch)({ data: { rowIds, required: true } })
  expect(preview.selectedCount).toBe(3)
  expect(preview.affectedCount).toBe(4)
  expect(preview.chains).toHaveLength(2)
  expect(preview.chains.flatMap(c => c.rows.map(r => r.id)).sort()).toEqual([ids[0], ids[1], ids[2], ids[5]].sort())
  const plan = await owner(async () => requireDb().transaction(async tx => {
    const batch = await readPreHeatTreatmentBatch(tx, { rowIds, required: true })
    return planPreHeatTreatmentFill(tx, batch.rows.map(row => ({ ...row, preHeatTreatmentRequired: true })), {})
  }))()
  expect(plan.errors).toEqual([])
  await owner(savePreHeatTreatmentBatch)({ data: { rowIds, required: true, token: preview.token, fill: confirmed(plan) } })
  const saved = await snapshot()
  expect(saved.controls).toHaveLength(16)
  expect(saved.controls.every(control => control.result === 'годен')).toBe(true)
  expect(saved.rows.filter(row => row.pre_heat_treatment_required).map(row => row.id)).toEqual([ids[0], ids[1], ids[2], ids[5]])
  // Two expanded chains share all five documents. The preview must count every
  // removed position once, then delete only this stage in one transaction.
  const removal = await owner(previewPreHeatTreatmentBatch)({ data: { rowIds, required: false } })
  expect(removal.removals).toHaveLength(5)
  expect(removal.removals.every(doc => doc.remaining === 0)).toBe(true)
  await owner(savePreHeatTreatmentBatch)({ data: { rowIds, required: false, token: removal.token } })
  expect((await snapshot()).controls).toEqual([])
  expect((await snapshot()).documents).toEqual([])
})

test('bulk removal rejects stale preview and preliminary rejection without changing any selected chain', async () => {
  const rowIds = [ids[1], ids[5]]
  const preview = await owner(previewPreHeatTreatmentBatch)({ data: { rowIds, required: false } })
  await withE2eDatabase(db => db.query("insert into pre_heat_treatment_controls(weld_joint_id,method,result) values($1,'ВИК','ремонт')", [ids[5]]))
  const before = await snapshot()
  await expect(owner(savePreHeatTreatmentBatch)({ data: { rowIds, required: false, token: preview.token } })).rejects.toThrow('изменились')
  const fresh = await owner(previewPreHeatTreatmentBatch)({ data: { rowIds, required: false } })
  expect(fresh.chains.some(chain => chain.reason?.includes('нельзя отключить'))).toBe(true)
  await expect(owner(savePreHeatTreatmentBatch)({ data: { rowIds, required: false, token: fresh.token } })).rejects.toThrow('нельзя отключить')
  expect(await snapshot()).toEqual(before)
})

test('LNK toolbar marks and fills all selected methods, then explicitly removes the preliminary package', async ({ page }, info) => {
  await withE2eDatabase(db => db.query("update weld_joints set pre_heat_treatment_required=false,has_rk='да',has_pvk='да' where id=$1", [ids[5]]))
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await selectLnkRow(page, 'F882')
  const menu = page.getByRole('button', { name: 'НК до ТО', exact: true })
  await menu.click()
  await page.getByRole('button', { name: 'Поставить отметку', exact: true }).click()
  const batch = page.getByRole('dialog', { name: 'Поставить отметку НК до ТО', exact: true })
  await expect(batch.getByText(/Затронуто записей: 1/)).toBeVisible()
  await batch.screenshot({ path: info.outputPath('preliminary-batch-mark.png') })
  await batch.getByRole('button', { name: 'Поставить и заполнить как «Годен»', exact: true }).click()
  const fill = page.getByRole('dialog', { name: 'Заполнить недостающий НК до ТО', exact: true })
  await fill.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true }).click()
  await expect(fill).toBeHidden()
  expect((await snapshot()).controls).toHaveLength(3)
  await menu.click()
  await page.getByRole('button', { name: 'Снять отметку', exact: true }).click()
  const remove = page.getByRole('dialog', { name: 'Снять отметку НК до ТО', exact: true })
  await expect(remove.getByText('Удалится целиком', { exact: true })).toHaveCount(4)
  await remove.getByRole('button', { name: 'Подтвердить снятие и удаление', exact: true }).click()
  await expect(remove).toBeHidden()
  expect((await snapshot()).controls).toEqual([])
})
async function snapshot() { return withE2eDatabase(async db => ({
  rows: (await db.query('select id,pre_heat_treatment_required,updated_at from weld_joints where project_title=$1 order by id', [project])).rows,
  controls: (await db.query('select p.* from pre_heat_treatment_controls p join weld_joints w on w.id=p.weld_joint_id where w.project_title=$1 order by p.id', [project])).rows,
  documents: (await db.query('select distinct d.id,d.title,d.row_count,d.source_metadata,d.updated_at from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 order by d.id', [project])).rows,
})) }

test('chain preview is read only; shared documents, empty documents, rejection and stale versions are handled atomically', async () => {
  const before = await snapshot(), context = await chain(ids[0])
  expect(context.chain.ids).toEqual(ids.slice(0, 3))
  expect(await snapshot()).toEqual(before)
  const plan = await previewFill([ids[0], ids[1], ids[5]])
  expect(plan.errors).toEqual([])
  expect(plan.groups).toHaveLength(2)
  await saveFill([ids[0], ids[1], ids[5]], confirmed(plan))
  const filled = await snapshot()
  expect(filled.controls).toHaveLength(3)
  expect(filled.documents).toHaveLength(2)
  await expect(change(ids[0], false, context.token)).rejects.toThrow('изменились')
  const current = await chain(ids[0])
  expect(current.affectedDocuments.every(document => document.remaining === 1)).toBe(true)
  await withE2eDatabase(db => db.query("update pre_heat_treatment_controls set result='ремонт' where weld_joint_id=$1", [ids[1]]))
  await expect(change(ids[0], false, (await chain(ids[0])).token)).rejects.toThrow('нельзя отключить')
  await withE2eDatabase(db => db.query("update pre_heat_treatment_controls set result='годен' where weld_joint_id=$1", [ids[1]]))
  await change(ids[0], false, (await chain(ids[0])).token)
  const after = await snapshot()
  expect(after.controls.map(row => row.weld_joint_id)).toEqual([ids[5]])
  expect(after.documents.every(doc => JSON.parse(doc.source_metadata).sourcePositions.every((p: { weldJointId: number }) => p.weldJointId === ids[5]))).toBe(true)
  expect(after.rows.slice(0, 5).every(row => row.pre_heat_treatment_required === false)).toBe(true)
  await change(ids[0], true, (await chain(ids[0])).token)
  expect((await snapshot()).controls).toEqual(after.controls)
  expect((await chain(ids[3])).required).toBe(false)
  await change(ids[5], false, (await chain(ids[5])).token)
  expect((await snapshot()).documents).toHaveLength(0)
})

test('late enable and quick fill are a single transaction, with cancellation and stale plan checks', async () => {
  await change(ids[0], false, (await chain(ids[0])).token)
  const before = await snapshot(), context = await chain(ids[0])
  const plan = await requireDb().transaction(async tx => {
    await lockPreHeatTreatmentFillCounters(tx)
    return planPreHeatTreatmentFill(tx, context.rows.map(row => ({ ...row, preHeatTreatmentRequired: true })), {})
  })
  // The unofficial repeat has no surviving rejected result. The planner must
  // report this business error instead of silently skipping that position.
  expect(plan.errors.join(' ')).toContain('официальность')
  expect(await snapshot()).toEqual(before)
  await withE2eDatabase(db => db.query('update weld_joints set officiality=null where id=$1', [ids[2]]))
  const fresh = await chain(ids[0])
  const ready = await requireDb().transaction(async tx => {
    await lockPreHeatTreatmentFillCounters(tx)
    return planPreHeatTreatmentFill(tx, fresh.rows.map(row => ({ ...row, preHeatTreatmentRequired: true })), {})
  })
  expect(ready.errors).toEqual([])
  const broken = { ...confirmed(ready), confirmedGroups: [] }
  const beforeSave = await snapshot()
  await expect(change(ids[0], true, fresh.token, broken)).rejects.toThrow('Состав')
  expect(await snapshot()).toEqual(beforeSave)
  await change(ids[0], true, fresh.token, confirmed(ready))
  expect((await snapshot()).controls).toHaveLength(3)
})

test('quick fill preserves an unfamiliar historical result and rolls back other selected joints', async () => {
  await withE2eDatabase(db => db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result)
    values($1,'ВИК','OLD-RESULT','2026-11-01','не годен')`, [ids[5]]))
  const before = await snapshot()
  const plan = await previewFill([ids[0], ids[5]])
  expect(plan.errors.join(' ')).toContain('уже сохранён результат')
  expect(plan.items.some(item => item.rowId === ids[5])).toBe(false)
  expect(plan.items.some(item => item.rowId === ids[0])).toBe(true)
  await expect(saveFill([ids[0], ids[5]], confirmed(plan))).rejects.toThrow('уже сохранён результат')
  expect(await snapshot()).toEqual(before)
})

for (const moveLine of [false, true]) for (const deactivate of [false, true]) test(`card can confirm preliminary cleanup without losing a shared request (move=${moveLine}, deactivate=${deactivate})`, async () => {
  const target = ids[5], outside = ids[0]
  const fixture = await withE2eDatabase(async db => {
    const members: { id: number; version: string }[] = []
    if (moveLine) members.push((await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,has_vik,psto_required,pre_heat_treatment_required)
      values($1,'NK','NK-L','F882R1','С17','да','да',true) returning id,xmin::text as version`, [project])).rows[0])
    const controls = (await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result)
      select unnest($1::int[]),'ВИК','COMBINED-PRE','2026-11-01','ожидает НК' returning id,weld_joint_id`, [[target, outside]])).rows
    const metadata = { sourceKind: 'beforeHeatTreatment', positionCount: 2, sourcePositions: controls.map(control => ({
      kind: 'beforeHeatTreatment', relationId: control.id, weldJointId: control.weld_joint_id, methodCode: 'ВИК',
    })) }
    const document = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,row_count,source_metadata)
      values('system:lnkRequest','COMBINED-PRE','combined.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-11-01',2,$1) returning id`, [JSON.stringify(metadata)])).rows[0].id
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [document, [target, outside]])
    const version = (await db.query('select xmin::text as version from weld_joints where id=$1', [target])).rows[0].version as string
    members.unshift({ id: target, version })
    return { controls, document, version, members }
  })
  const preliminary = await chain(target)
  const actuality = await requireDb().transaction(tx => previewChainActualityInTransaction(tx, { rowId: target, active: false }))
  expect(actuality.pendingRequestCount).toBe(1)
  expect(preliminary.affectedDocuments[0].remaining).toBe(1)
  const before = await snapshot()
  const data = { id: target, expectedVersion: fixture.version,
    preHeatTreatmentConfirmation: { required: false, token: preliminary.token },
    ...(deactivate ? { chainActualityConfirmation: { active: false, token: actuality.token, confirmed: true as const } } : {}),
  }
  const savedRows = moveLine ? await owner(moveWeldJointChainRecord)({ ...data, line: 'NK-MOVED',
    weldChainLineMovePlan: { expectedRowIds: fixture.members.map(member => member.id), expectedVersions: fixture.members, decisions: [] },
  }) : [await owner(updateWeldJoint)({ data })]
  const saved = savedRows.find(row => row.id === target)!
  expect(saved).toMatchObject({ preHeatTreatmentRequired: false, ...(deactivate ? { revisionActuality: 'не актуален' } : {}) })
  expect(saved.line).toBe(moveLine ? 'NK-MOVED' : 'NK-L')
  expect(savedRows.every(row => row.preHeatTreatmentRequired === false && (!deactivate || row.revisionActuality === 'не актуален'))).toBe(true)
  const after = await snapshot()
  expect(after.controls).toEqual(before.controls.filter(control => control.weld_joint_id !== target))
  const unaffected = (row: { id: number }) => !fixture.members.some(member => member.id === row.id)
  expect(after.rows.filter(unaffected)).toEqual(before.rows.filter(unaffected))
  expect(after.documents).toHaveLength(1)
  expect(after.documents[0]).toMatchObject({ id: fixture.document, title: 'COMBINED-PRE', row_count: 1 })
  expect(JSON.parse(after.documents[0].source_metadata).sourcePositions).toEqual([
    { kind: 'beforeHeatTreatment', relationId: fixture.controls[1].id, weldJointId: outside, methodCode: 'ВИК' },
  ])
  expect(await withE2eDatabase(async db => (await db.query('select weld_joint_id from generated_document_weld_joints where document_id=$1', [fixture.document])).rows))
    .toEqual([{ weld_joint_id: outside }])
})

test('preliminary candidate SQL excludes off chains before pagination, even explicitly included rows', async () => {
  const rows = await owner(listLnkWorkflowRows)({ scope: 'preHeatTreatmentRequestCandidates', rowIds: ids,
    includeRowIds: [ids[3], ids[4]], limit: 1, offset: 0 })
  expect(rows.some(row => row.id === ids[3] || row.id === ids[4])).toBe(false)
  expect(rows.every(row => row.preHeatTreatmentRequired === true)).toBe(true)
})

test('card shows root inheritance and explicit preview, cancellation writes nothing', async ({ page }, info) => {
  await withE2eDatabase(db => db.query("update weld_joints set weld_date='2026-11-02' where id=$1", [ids[1]]))
  const filledIds = [ids[0], ids[1], ids[5]]
  await saveFill(filledIds, confirmed(await previewFill(filledIds)))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await editJournalJoint(page, 'F881')
  await page.getByRole('button', { name: 'Назначение контроля', exact: true }).click()
  const checkbox = page.getByRole('checkbox', { name: 'Требуется НК до ТО' })
  await expect(checkbox).toBeChecked()
  const before = await snapshot()
  await checkbox.click()
  const dialog = page.getByRole('dialog', { name: 'Отключить НК до ТО', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/Состав цепочки/)).toContainText('F881R1')
  const documents = dialog.locator('section').filter({ has: page.getByRole('heading', { name: /Что произойдёт с документами/ }) })
  await expect(documents.getByText('Сохранится', { exact: true })).toHaveCount(2)
  await expect(documents.getByText('Удалится целиком', { exact: true })).toHaveCount(2)
  await expect(documents.getByRole('columnheader', { name: 'Документ', exact: true })).toBeVisible()
  await dialog.screenshot({ path: info.outputPath('preliminary-disable-documents.png') })
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await snapshot()).toEqual(before)
})


test('LNK quick fill preserves explicit dates and names across regrouping and saves only selected joints', async ({ page }, info) => {
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await selectLnkRow(page, 'F882')
  await lnkRow(page, 'F882').getByRole('button', { name: 'F882', exact: true }).click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'НК до ТО', exact: true }).hover()
  await page.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Заполнить недостающий НК до ТО', exact: true })
  const requestKey = `${ids[5]}:request:all`, resultKey = `${ids[5]}:result:ВИК`
  await expect(dialog.getByLabel(`Дата ${requestKey}`, { exact: true })).toHaveValue('2026-11-01')
  const requestName = dialog.getByLabel(`Название ${requestKey}`, { exact: true })
  const originalInput = await requestName.elementHandle()
  const details = dialog.locator('details').filter({ has: page.getByText(/Состав создаваемых документов/) })
  await details.locator('summary').click()
  await requestName.fill('E2E PRE manual request')
  await expect(dialog.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true })).toBeEnabled()
  expect(await originalInput!.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true)
  await expect(details).toHaveAttribute('open', '')
  await dialog.getByLabel(`Название ${resultKey}`, { exact: true }).fill('E2E PRE manual conclusion')
  await dialog.getByLabel(`Дата ${resultKey}`, { exact: true }).fill('2026-11-02')
  await dialog.getByLabel('Разделение: Заявки', { exact: true }).selectOption('joint')
  await dialog.getByLabel('Разделение: Заключения ВИК', { exact: true }).selectOption('project')
  const save = dialog.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true })
  await expect(save).toBeEnabled()
  await expect(dialog.getByLabel(`Название ${requestKey}`, { exact: true })).toHaveValue('E2E PRE manual request')
  expect((await snapshot()).controls).toHaveLength(0)
  await dialog.screenshot({ path: info.outputPath('preliminary-fill-confirmed.png') })
  await save.click()
  await expect(dialog).toBeHidden()
  const after = await snapshot()
  expect(after.controls).toHaveLength(1)
  expect(after.controls[0]).toMatchObject({ weld_joint_id: ids[5], request_name: 'E2E PRE manual request', conclusion_name: 'E2E PRE manual conclusion', result: 'годен' })
  expect(after.documents).toHaveLength(2)
  const conflict = await requireDb().transaction(async tx => {
    await lockPreHeatTreatmentFillCounters(tx)
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.id, ids[0]))
    return planPreHeatTreatmentFill(tx, await attachHeatTreatmentControlRelations(rows, tx), {
      overrides: { [`${ids[0]}:request:all`]: { name: 'E2E PRE manual request' } },
    })
  })
  expect(conflict.issues).toContainEqual(expect.objectContaining({ itemKey: `${ids[0]}:request:all`, field: 'name', message: expect.stringContaining('уже занято') }))
})

test('fill highlights exact chronology fields, keeps healthy positions valid and shows document columns', async ({ page }, info) => {
  await withE2eDatabase(async db => {
    await db.query("update weld_joints set has_uzk='да' where id=any($1::int[])", [[ids[0], ids[5]]])
    for (const [id, date] of [[ids[0], '2026-11-03'], [ids[5], '2026-11-01']] as const) {
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,conclusion_name,conclusion_date,result)
        values($1,'ВИК','Существующая заявка ВИК','2026-11-01','Существующее заключение ВИК',$2,'годен')`, [id, date])
    }
  })
  const before = await snapshot()
  const plan = await previewFill([ids[0], ids[5]])
  expect(plan.issues).toContainEqual(expect.objectContaining({ rowId: ids[0], itemKey: `${ids[0]}:result:УЗК`, field: 'date' }))
  expect(plan.issues.some(issue => issue.rowId === ids[5])).toBe(false)
  expect(plan.errors.every(error => !error.includes('F882'))).toBe(true)
  const duplicateNames = await requireDb().transaction(async tx => {
    await lockPreHeatTreatmentFillCounters(tx)
    const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, [ids[0], ids[5]]))
    return planPreHeatTreatmentFill(tx, await attachHeatTreatmentControlRelations(rows, tx), {
      splitModes: { lnkRequest: 'joint' },
      overrides: Object.fromEntries([ids[0], ids[5]].map(id => [`${id}:request:all`, { name: 'Одинаковое имя разных заявок' }])),
    })
  })
  expect(duplicateNames.issues.filter(issue => issue.field === 'name')).toHaveLength(2)

  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await selectLnkRow(page, 'F881')
  await lnkRow(page, 'F881').getByRole('button', { name: 'F881', exact: true }).click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'НК до ТО', exact: true }).hover()
  await page.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Заполнить недостающий НК до ТО', exact: true })
  const date = dialog.getByLabel(`Дата ${ids[0]}:result:УЗК`, { exact: true })
  await expect(date).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByLabel(`Дата ${ids[0]}:request:all`, { exact: true })).not.toHaveAttribute('aria-invalid')
  await dialog.getByRole('button', { name: /Стык F881: УЗК до ТО.*не может быть раньше ВИК/ }).click()
  await expect(date).toBeFocused()
  await dialog.locator('summary').filter({ hasText: 'Существующие сведения' }).click()
  await expect(dialog.getByRole('cell', { name: 'Существующее заключение ВИК', exact: true })).toBeVisible()
  await expect(dialog.getByRole('cell', { name: '03.11.2026', exact: true })).toBeVisible()
  await dialog.screenshot({ path: info.outputPath('preliminary-fill-highlighted.png') })
  await dialog.getByRole('cell', { name: 'Существующее заключение ВИК', exact: true }).scrollIntoViewIfNeeded()
  await dialog.screenshot({ path: info.outputPath('preliminary-existing-documents.png') })
  await date.fill('2026-11-03')
  await expect(date).not.toHaveAttribute('aria-invalid')
  await expect(dialog.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await snapshot()).toEqual(before)
})

test('card enable with quick fill remains a draft until card save', async ({ page }) => {
  await change(ids[5], false, (await chain(ids[5])).token)
  const before = await snapshot()
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await editJournalJoint(page, 'F882')
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await editor.getByRole('button', { name: 'Назначение контроля', exact: true }).click()
  await editor.getByRole('checkbox', { name: 'Требуется НК до ТО' }).click()
  const enable = page.getByRole('dialog', { name: 'Включить НК до ТО', exact: true })
  await enable.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true }).click()
  const fill = page.getByRole('dialog', { name: 'Заполнить недостающий НК до ТО', exact: true })
  await fill.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true }).click()
  await expect(fill).toBeHidden()
  expect(await snapshot()).toEqual(before)
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  const after = await snapshot()
  expect(after.controls).toHaveLength(1)
  expect(after.controls[0]).toMatchObject({ weld_joint_id: ids[5], result: 'годен' })
  expect(after.rows.find(row => row.id === ids[5])?.pre_heat_treatment_required).toBe(true)
})


test('no-PSTO line keeps history and requirement; cleanup preserves a primary rejection', async () => {
  const plan = await previewFill([ids[5]])
  await saveFill([ids[5]], confirmed(plan))
  await withE2eDatabase(db => db.query("update weld_joints set psto_required='отменен',vik_result='ремонт',vik_request='MAIN',vik_conclusion='MAIN-C' where id=$1", [ids[5]]))
  const historical = await chain(ids[5])
  expect(historical.required).toBe(true)
  await expect(change(ids[5], true, historical.token)).rejects.toThrow('ПСТО не назначено')
  expect((await owner(listLnkWorkflowRows)({ scope: 'preHeatTreatmentRequestCandidates', rowIds: [ids[5]] })).map(row => row.id)).not.toContain(ids[5])
  await change(ids[5], false, historical.token)
  expect((await snapshot()).controls).toHaveLength(0)
  const primary = await withE2eDatabase(db => db.query('select vik_result,vik_request,vik_conclusion from weld_joints where id=$1', [ids[5]]))
  expect(primary.rows[0]).toEqual({ vik_result: 'ремонт', vik_request: 'MAIN', vik_conclusion: 'MAIN-C' })
})

test('concurrent quick fills cannot duplicate documents or partially overwrite facts', async () => {
  const plan = await previewFill([ids[5]])
  const attempts = await Promise.allSettled([saveFill([ids[5]], confirmed(plan)), saveFill([ids[5]], confirmed(plan))])
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
  const state = await snapshot()
  expect(state.controls).toHaveLength(1)
  expect(state.documents).toHaveLength(2)
})


test('both preliminary waiting statuses are stored, filterable and counted in statistics', async () => {
  const read = asE2eOwner(listWeldingJournalPage, 'welding.view')
  for (const [status, bucket] of [['ожидает заявку до ТО', 'waitingRequest'], ['ожидает НК до ТО', 'waitingControl']] as const) {
    await requireDb().transaction(async tx => {
      if (bucket === 'waitingControl') await tx.insert(preHeatTreatmentControls).values({ weldJointId: ids[5], method: 'ВИК', requestName: 'STAT-PRE', requestDate: '2026-11-01', result: 'ожидает НК' })
      const rows = await attachHeatTreatmentControlRelations(await tx.select().from(weldJoints).where(eq(weldJoints.id, ids[5])), tx)
      const saved = await persistPreHeatTreatmentTouchedRows(tx, rows)
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(saved, new Map()) })
    })
    const page = await read({ data: { projectTitle: project, columnFilters: { joint: '=F882', finalStatus: `=${status}` } } })
    expect(page.rows.map(row => row.id)).toEqual([ids[5]])
    expect(page.rows[0].finalStatus).toBe(status)
    const options = await asE2eOwner(listWeldColumnFilterOptions, 'welding.view')({ data: { projectTitle: project, fieldKey: 'finalStatus' } })
    expect(options.some(option => option.value === status && option.count > 0)).toBe(true)
    const stats = await computeStatisticsServerResult({ tab: 'general', projectFilter: project.toLowerCase(), unit: 'joints' })
    expect(stats.generalStateRowIds[bucket]).toContain(ids[5])
    const stored = await withE2eDatabase(db => db.query('select final_status from weld_joints where id=$1', [ids[5]]))
    expect(stored.rows[0].final_status).toBe(status)
  }
})
