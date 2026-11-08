import { editJournalJoint, journalRow, revealJournalColumn } from '../journal-grid'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { PgDialect } from 'drizzle-orm/pg-core'
import { requireDb } from '../../src/db'
import { previewChainActualityInTransaction, setChainActualityInTransaction } from '../../src/server/chain-actuality'
import { updateWeldJoint as updateWeldJointHandler } from '../../src/server/weld-mutations'
import { asE2eOwner } from '../with-owner-access'
import { moveWeldJointChainRecord } from '../../src/server/weld-chain-line-move'
import { listWeldingJournalPage, listWeldColumnFilterOptions } from '../../src/server/weld-read'
import { computeStatisticsServerResult } from '../../src/server/statistics'
const updateWeldJoint = asE2eOwner(updateWeldJointHandler, 'welding.edit')
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import type { SystemDocumentSourcePosition } from '../../src/lib/system-document-types'

const project = 'E2E chain actuality requests'
const date = '2026-11-01'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function fixture() {
  return withLineProgramFixture(async db => {
    const ids = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,connection_type,has_vik,has_rk,has_uzk,psto_required)
      select $1,'ACT','ACT-L',name,'2026-10-01',case when n=3 then 'неофициальный' else 'действующий' end,'С17','да','да','да','да'
      from unnest(array['F771','F771R1','F771R1','F771Y1','F772']) with ordinality t(name,n) returning id`, [project])).rows.map(row => row.id as number)
    const [root, repair, repeat, coil, outside] = ids
    await db.query("update weld_joints set rk_request='ACT-NK',rk_request_date=$1,rk_result='ремонт',rk_conclusion='ACT-RESULT',rk_conclusion_date=$1 where id=$2", [date, root])
    await db.query("update weld_joints set uzk_request='ACT-NK',uzk_request_date=$1,uzk_result='ожидает НК' where id=any($2::int[])", [date, [repair, outside]])
    await db.query("update weld_joints set pvk_request='ACT-EMPTY',pvk_request_date=$1,pvk_result='ожидает НК',has_pvk='да' where id=$2", [date, repeat])
    await db.query("update weld_joints set psto_request='ACT-P1',psto_request_date=$1,psto_result='ожидает',tvmt_request='ACT-T1',tvmt_request_date=$1,tvmt_result='ожидает НК' where id=$2", [date, repair])
    const pre = (await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name)
      values($1,'РК','ACT-PRE',$3,'ожидает НК',null),($1,'УЗК','ACT-PRE',$3,'годен','ACT-PRE-RESULT'),($2,'РК','ACT-PRE',$3,'ожидает НК',null) returning id`, [repair, outside, date])).rows.map(row => row.id as number)
    const cycles = (await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_result,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion)
      values($1,2,'ACT-P2',$2,'проведено','ACT-T2',$2,'ожидает НК',null),($1,3,'ACT-P3',$2,'ожидает','ACT-T3',$2,'не годен','ACT-T-RESULT') returning id`, [repair, date])).rows.map(row => row.id as number)
    await db.query("insert into duplicate_controls(weld_joint_id,method,result,control_date,conclusion,conclusion_date) values($1,'РК','годен',$2,'ACT-DUPLICATE',$2)", [root, date])
    const docs: Record<string, number> = {}
    const add = async (title: string, type: string, rowIds: number[], positions?: SystemDocumentSourcePosition[]) => {
      const metadata = positions ? { sourceKind: positions[0].kind, sourcePositions: positions, positionCount: positions.length } : {}
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,row_count,source_metadata)
        values($1,$2,$2||'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3,$4,$5) returning id`, [type, title, date, rowIds.length, JSON.stringify(metadata)])).rows[0].id
      docs[title] = id
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [id, rowIds])
    }
    await add('ACT-NK', 'system:lnkRequest', [root, repair, outside])
    await add('ACT-EMPTY', 'system:lnkRequest', [repeat])
    await add('ACT-RESULT', 'system:lnkConclusionRk', [root])
    await add('ACT-PRE', 'system:lnkRequest', [repair, outside], pre.map((id, i) => ({ kind: 'beforeHeatTreatment', relationId: id, weldJointId: i === 2 ? outside : repair, methodCode: i === 1 ? 'УЗК' : 'РК' })))
    await add('ACT-PRE-RESULT', 'system:lnkConclusionUzk', [repair], [{ kind: 'beforeHeatTreatment', relationId: pre[1], weldJointId: repair, methodCode: 'УЗК' }])
    for (const [title, sequence, method, completed, legacy] of [
      ['ACT-P1', 1, 'ПСТО', false, false], ['ACT-T1', 1, 'ТВМТ', false, false],
      ['ACT-P2', 2, 'ПСТО', true, false], ['ACT-T2', 2, 'ТВМТ', false, true],
      ['ACT-P3', 3, 'ПСТО', false, false], ['ACT-T3', 3, 'ТВМТ', true, false],
    ] as const) {
      const positions: SystemDocumentSourcePosition[] = [{ kind: legacy ? 'pstoRepeat' : 'pstoCycle', weldJointId: repair,
        relationId: sequence === 1 ? repair : cycles[sequence - 2], sequence, ...(method === 'ТВМТ' ? { methodCode: method } : {}) }]
      await add(title, method === 'ПСТО' ? 'system:pstoRequest' : 'system:tvmtRequest', [repair], positions)
      if (completed) await add(title + '-RESULT', method === 'ПСТО' ? 'system:pstoConclusion' : 'system:tvmtConclusion', [repair], positions)
    }
    return { ids, root, repair, repeat, coil, outside, pre, cycles, docs }
  })
}

async function snapshot() {
  return withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    pre: (await db.query('select p.* from pre_heat_treatment_controls p join weld_joints w on w.id=p.weld_joint_id where w.project_title=$1 order by p.id', [project])).rows,
    cycles: (await db.query('select p.* from psto_repeat_cycles p join weld_joints w on w.id=p.weld_joint_id where w.project_title=$1 order by p.id', [project])).rows,
    documents: (await db.query("select * from generated_documents where title like 'ACT-%' order by id")).rows,
    links: (await db.query("select r.* from generated_document_weld_joints r join generated_documents d on d.id=r.document_id where d.title like 'ACT-%' order by r.document_id,r.weld_joint_id")).rows,
    duplicates: (await db.query('select d.* from duplicate_controls d join weld_joints w on w.id=d.weld_joint_id where w.project_title=$1 order by d.id', [project])).rows,
  }))
}

const preview = (rowId: number, active = false) => requireDb().transaction(tx => previewChainActualityInTransaction(tx, { rowId, active }))
const save = (data: Awaited<ReturnType<typeof preview>>) => requireDb().transaction(tx => setChainActualityInTransaction(tx, { ...data, confirmed: true }))

test('inactive final status is persisted, filtered and excluded from waiting statistics, then restored on reactivation', async () => {
  const f = await fixture()
  const setActive = async (active: boolean) => {
    const confirmation = await preview(f.root, active)
    const expectedVersion = await withE2eDatabase(async db => (await db.query('select xmin::text as version from weld_joints where id=$1', [f.root])).rows[0].version)
    await updateWeldJoint({ data: { id: f.root, expectedVersion, chainActualityConfirmation: { active, token: confirmation.token, confirmed: true } } })
  }
  const read = asE2eOwner(listWeldingJournalPage, 'welding.view')
  const filter = { projectTitle: project, columnFilters: { finalStatus: '=неактуальный' } }
  await setActive(false)
  const inactive = await read({ data: filter })
  expect(inactive.rows.map(row => row.id).sort((a, b) => a - b)).toEqual([f.repair, f.repeat])
  expect(inactive.rows.every(row => row.finalStatus === 'неактуальный')).toBe(true)
  const options = await asE2eOwner(listWeldColumnFilterOptions, 'welding.view')({ data: { projectTitle: project, fieldKey: 'finalStatus' } })
  expect(options).toContainEqual({ value: 'неактуальный', label: 'неактуальный', count: 2 })
  const stored = await snapshot()
  expect(stored.rows[0].final_status).toBe('не годен')
  expect(stored.rows.slice(1, 3).map(row => row.final_status)).toEqual(['неактуальный', 'неактуальный'])
  for (const tab of ['lnk', 'psto'] as const) {
    const stats = await computeStatisticsServerResult({ tab, projectFilter: project })
    for (const ids of [stats.generalStateRowIds.waitingRequest, stats.generalStateRowIds.waitingControl,
      ...stats.summary.methods.flatMap(method => [method.rowIds.waitingRequest, method.rowIds.waitingControl]),
      stats.summary.pstoMethod.rowIds.waitingRequest, stats.summary.tvmtMethod.rowIds.waitingRequest]) {
      expect(ids).not.toContain(f.repair)
      expect(ids).not.toContain(f.repeat)
    }
  }
  await setActive(true)
  expect((await read({ data: filter })).rows).toEqual([])
  const reactivated = await read({ data: { projectTitle: project } })
  expect(reactivated.rows.find(row => row.id === f.repair)?.finalStatus).toBe('ожидает заявку до ТО')
})

async function verify(f: Awaited<ReturnType<typeof fixture>>, before: Awaited<ReturnType<typeof snapshot>>) {
  const after = await snapshot()
  expect(after.rows.map(row => row.revision_actuality)).toEqual(['не актуален', 'не актуален', 'не актуален', null, null])
  expect(after.rows[0].rk_result).toBe('ремонт')
  expect(after.rows[0].rk_request).toBe('ACT-NK')
  expect(after.rows[1]).toMatchObject({ uzk_request: null, uzk_request_date: null, uzk_result: null, psto_request: null, tvmt_request: null, has_uzk: 'да', psto_required: 'да' })
  expect(after.rows[2].pvk_request).toBeNull()
  expect(after.rows.slice(3)).toEqual(before.rows.slice(3))
  expect(after.pre[0]).toMatchObject({ request_name: null, request_date: null, result: null })
  expect(after.pre.slice(1)).toEqual(before.pre.slice(1))
  expect(after.cycles[0]).toMatchObject({ psto_request: 'ACT-P2', psto_result: 'проведено', tvmt_request: null, tvmt_result: null })
  expect(after.cycles[1]).toMatchObject({ psto_request: null, psto_result: null, tvmt_request: 'ACT-T3', tvmt_result: 'не годен', tvmt_conclusion: 'ACT-T-RESULT' })
  expect(after.duplicates).toEqual(before.duplicates)
  for (const title of ['ACT-RESULT', 'ACT-PRE-RESULT', 'ACT-P2', 'ACT-P2-RESULT', 'ACT-T3', 'ACT-T3-RESULT']) {
    expect(after.documents.find(doc => doc.title === title)).toEqual(before.documents.find(doc => doc.title === title))
  }
  for (const title of ['ACT-EMPTY', 'ACT-P1', 'ACT-T1', 'ACT-T2', 'ACT-P3']) expect(after.documents.some(doc => doc.title === title)).toBe(false)
  expect(after.links.filter(link => link.document_id === f.docs['ACT-NK']).map(link => link.weld_joint_id)).toEqual([f.root, f.outside])
  expect(JSON.parse(after.documents.find(doc => doc.title === 'ACT-PRE')!.source_metadata).sourcePositions.map((p: SystemDocumentSourcePosition) => p.relationId)).toEqual(f.pre.slice(1))
  return after
}

test('whole-chain deactivation removes only pending positions atomically, with stale document/result checks and no request restoration', async () => {
  const f = await fixture(), before = await snapshot(), initial = await preview(f.root)
  expect(initial.total).toBe(3)
  expect(initial.pendingRequestCount).toBe(7)
  expect(initial.requestRemovals.find(item => item.title === 'ACT-NK')).toMatchObject({ remaining: 2 })
  expect(initial.requestRemovals.find(item => item.title === 'ACT-EMPTY')).toMatchObject({ remaining: 0 })
  expect(await snapshot()).toEqual(before)
  await expect(requireDb().transaction(tx => setChainActualityInTransaction(tx, { ...initial, confirmed: false }))).rejects.toThrow('подтвердите')
  // Change another position in a shared document without touching this chain.
  await withE2eDatabase(db => db.query('update generated_documents set updated_at=updated_at+interval \'1 second\' where id=$1', [f.docs['ACT-NK']]))
  await expect(save(initial)).rejects.toThrow('изменились')
  const current = await preview(f.root), beforeRollback = await snapshot()
  let failedAfterWrites = false
  await expect(requireDb().transaction(tx => setChainActualityInTransaction(new Proxy(tx, { get(target, key) {
    if (key === 'execute') return (...args: Parameters<typeof tx.execute>) => {
      const statement = typeof args[0] === 'string' ? args[0] : new PgDialect().sqlToQuery(args[0].getSQL()).sql
      if (statement.includes('"dispatcher_state"')) { failedAfterWrites = true; throw new Error('forced invalidation failure') }
      return target.execute(...args)
    }
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
  } }), { ...current, confirmed: true }))).rejects.toThrow('forced invalidation failure')
  expect(failedAfterWrites).toBe(true)
  expect(await snapshot()).toEqual(beforeRollback)
  await save(current)
  const after = await verify(f, beforeRollback)
  await save(await preview(f.repair, true))
  const restored = await snapshot()
  expect(restored.rows.every(row => row.revision_actuality === null)).toBe(true)
  expect(restored.documents).toEqual(after.documents)
  expect(restored.pre).toEqual(after.pre)
  expect(restored.cycles).toEqual(after.cycles)

  // A result arriving after the warning must survive, even if a legacy writer
  // omitted the parent timestamp: the current pending plan is in the token.
  await withLineProgramFixture(db => db.query("update weld_joints set uzk_request='ACT-LATE',uzk_request_date=$1,uzk_result='ожидает НК' where id=$2", [date, f.repair]))
  const stale = await preview(f.repair)
  await withE2eDatabase(db => db.query("update weld_joints set uzk_result='годен',uzk_conclusion='ACT-LATE-RESULT' where id=$1", [f.repair]))
  await expect(save(stale)).rejects.toThrow('изменились')
  expect((await snapshot()).rows[1]).toMatchObject({ revision_actuality: null, uzk_request: 'ACT-LATE', uzk_result: 'годен' })
  await save(await preview(f.repair))
  expect((await snapshot()).rows[1]).toMatchObject({ revision_actuality: 'не актуален', uzk_request: 'ACT-LATE', uzk_result: 'годен' })
})

test('mixed legacy actuality removes pending requests from already inactive members too', async () => {
  const f = await fixture()
  await withE2eDatabase(db => db.query("update weld_joints set revision_actuality='не актуален' where id=$1", [f.repeat]))
  const before = await snapshot(), current = await preview(f.repair)
  expect(current.changedCount).toBe(2)
  expect(current.pendingRequestCount).toBe(7)
  await save(current)
  await verify(f, before)
  const unchanged = await snapshot()
  expect(await save(await preview(f.root))).toEqual({ changedCount: 0, removedRequestPositions: 0 })
  expect(await snapshot()).toEqual(unchanged)
})

test('card confirmation saves with other edits atomically and rejects stale requests or a non-journal scope', async () => {
  const f = await fixture()
  const version = () => withE2eDatabase(async db => (await db.query('select xmin::text as version from weld_joints where id=$1', [f.root])).rows[0].version as string)
  const current = await preview(f.root)
  const data = { id: f.root, expectedVersion: await version(), weldingJournalNote: 'Согласовано в карточке',
    chainActualityConfirmation: { active: false, token: current.token, confirmed: true as const } }
  const before = await snapshot()
  await expect(updateWeldJoint({ data: { ...data, mutationScope: 'lnk' } })).rejects.toThrow('только в карточке')
  expect(await snapshot()).toEqual(before)
  await withE2eDatabase(db => db.query("update generated_documents set updated_at=updated_at+interval '1 second' where id=$1", [f.docs['ACT-NK']]))
  const afterOtherUser = await snapshot()
  await expect(updateWeldJoint({ data })).rejects.toThrow('изменились')
  expect(await snapshot()).toEqual(afterOtherUser)
  const confirmed = await preview(f.root)
  const saved = await updateWeldJoint({ data: { ...data, chainActualityConfirmation: { ...data.chainActualityConfirmation, token: confirmed.token } } })
  expect(saved).toMatchObject({ revisionActuality: 'не актуален', weldingJournalNote: data.weldingJournalNote, rkResult: 'ремонт', rkRequest: 'ACT-NK' })
  const after = await snapshot()
  expect(after.rows.slice(0, 3).every(row => row.revision_actuality === 'не актуален')).toBe(true)
  expect(after.rows[1].uzk_request).toBeNull()
  expect(after.rows[2].pvk_request).toBeNull()
  expect(after.rows.slice(3)).toEqual(before.rows.slice(3))
  for (const doc of before.documents.filter(doc => doc.title.includes('RESULT'))) {
    expect(after.documents.find(candidate => candidate.id === doc.id)).toMatchObject({ title: doc.title, type: doc.type, file_name: doc.file_name, specialists: doc.specialists, specialists_revision: doc.specialists_revision })
  }
})

test('card applies confirmed actuality together with a whole-chain line move', async () => {
  const rows = await withLineProgramFixture(async db => (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,officiality,has_vik,has_rk)
    values($1,'ACT','MOVE-FROM','S881','С17','действующий','да','да'),($1,'ACT','MOVE-FROM','S881R1','С17','действующий','да','да') returning id,xmin::text as version`, [project])).rows as { id: number; version: string }[])
  const current = await preview(rows[0].id)
  const saved = await asE2eOwner(moveWeldJointChainRecord, 'welding.edit')({
    id: rows[0].id, expectedVersion: rows[0].version, line: 'MOVE-TO',
    chainActualityConfirmation: { active: false, token: current.token, confirmed: true },
    weldChainLineMovePlan: { expectedRowIds: rows.map(row => row.id), expectedVersions: rows, decisions: [] },
  })
  expect(saved).toHaveLength(2)
  expect(saved.every(row => row.line === 'MOVE-TO' && row.revisionActuality === 'не актуален')).toBe(true)
})

test('pending request removal batches SQL across a larger chain and paginates its preview', async () => {
  const counts: { members: number; preview: number; save: number }[] = []
  for (const extra of [0, 200]) {
    const f = await fixture()
    if (extra) await withE2eDatabase(async db => {
      const ids = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,has_uzk,uzk_request,uzk_request_date)
        select $1,'ACT','ACT-L','F771R1','2026-10-01','неофициальный','да','ACT-NK',$2 from generate_series(1,$3) returning id`, [project, date, extra])).rows.map(row => row.id)
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [f.docs['ACT-NK'], ids])
    })
    const expectedVersion = await withE2eDatabase(async db => (await db.query('select xmin::text as version from weld_joints where id=$1', [f.root])).rows[0].version as string)
    const originalQuery = pg.Client.prototype.query
    let queries = 0
    pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
      queries++; return (originalQuery as (...args: unknown[]) => unknown).apply(this, args)
    } as typeof originalQuery
    try {
      const current = await preview(f.root), previewQueries = queries
      expect(current.total).toBe(extra + 3)
      expect(current.rows).toHaveLength(Math.min(100, extra + 3))
      expect(current.pendingRequestCount).toBe(extra + 7)
      const saved = await updateWeldJoint({ data: { id: f.root, expectedVersion,
        chainActualityConfirmation: { active: false, token: current.token, confirmed: true } } })
      expect(saved.revisionActuality).toBe('не актуален')
      counts.push({ members: extra + 3, preview: previewQueries, save: queries - previewQueries })
    } finally { pg.Client.prototype.query = originalQuery }
    await cleanupLineProgramProjects([project])
  }
  expect(counts[1].preview).toBe(counts[0].preview)
  expect(counts[1].save).toBe(counts[0].save)
  console.log({ chainActualityPendingRequestSql: counts })
})

for (const path of ['/journal', '/lnk', '/psto']) test(`${path}: actuality is absent from the menu and joint picture; only the journal card saves it`, async ({ page }, info) => {
  const f = await fixture()
  await page.goto(path)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(page.locator('[data-weld-report-grid] .journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: 'F771', exact: true }).click({ button: 'right' })
  await expect(page.getByRole('button', { name: 'Актуальность стыка', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Картина стыка', exact: true }).click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F771', exact: true }) })
  await expect(picture).toBeVisible()
  await expect(picture.getByRole('button', { name: /Сделать.*неактуаль|Вернуть актуальность/ })).toHaveCount(0)
  if (path !== '/journal') return
  await picture.getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  const actuality = editor.getByRole('combobox', { name: 'Актуальность по ИЗМу', exact: true })
  const open = async () => {
    await actuality.click()
    await page.getByRole('option', { name: 'Не актуален', exact: true }).click()
  }
  await open()
  const dialog = page.getByRole('dialog', { name: 'Сделать цепочку неактуальной', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('Из заявок будут удалены позиции без результата: 7')
  await dialog.screenshot({ path: info.outputPath('actuality-warning-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.getByRole('checkbox').scrollIntoViewIfNeeded()
  await dialog.screenshot({ path: info.outputPath('actuality-warning-narrow.png') })
  await page.setViewportSize({ width: 1600, height: 1000 })
  const before = await snapshot()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(actuality).toHaveValue('active')
  expect(await snapshot()).toEqual(before)
  const confirm = async () => {
    await open()
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Подтвердить актуальность цепочки', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(actuality).toHaveValue('inactive')
  }
  await confirm()
  expect(await snapshot()).toEqual(before)
  await actuality.click()
  await page.getByRole('option', { name: 'Актуален', exact: true }).click()
  const restore = page.getByRole('dialog', { name: 'Вернуть актуальность цепочке', exact: true })
  await expect(restore).toContainText('Снятые ранее позиции заявок автоматически не восстанавливаются.')
  await restore.getByRole('checkbox').check()
  await restore.screenshot({ path: info.outputPath('actuality-restore-desktop.png') })
  await restore.getByRole('button', { name: 'Отмена', exact: true }).click()
  await editor.getByRole('button', { name: 'Закрыть', exact: true }).click()
  expect(await snapshot()).toEqual(before)
  await editJournalJoint(page, f.root)
  await confirm()
  await page.screenshot({ path: info.outputPath('card-actuality-confirmed-draft.png') })
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  await verify(f, before)
  // Editing from the joint picture focuses the journal on that one record.
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(journalRow(page, f.repair)).toBeVisible()
  await revealJournalColumn(page, 'finalStatus')
  await expect(journalRow(page, f.repair).locator('[col-id="finalStatus"]')).toHaveText('неактуальный')
  await expect(journalRow(page, f.root).locator('[col-id="finalStatus"]')).toHaveText('не годен')
})
