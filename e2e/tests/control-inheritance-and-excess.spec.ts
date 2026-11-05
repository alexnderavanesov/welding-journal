import { expect, test, type Page } from '@playwright/test'
import { asE2eOwner } from '../with-owner-access'
import { previewLnkOfficialityChange, applyLnkOfficialityChange } from '@/server/lnk-officiality-workflow'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { createWeldJoints, updateWeldJoint, updateWeldJoints } from '@/server/weld-mutations'
import { massFillWeldJoints, replaceWeldJoints } from '@/server/weld-import'
import { changeProgramApprovalsInTransaction } from '@/server/line-program-approvals'
import { getProgramRepairAssignmentIssues, attachProgramRepairRequirements, buildProgramRepairTasks } from '@/lib/line-program-repair-requirements'
import { getProgramRemovalHints } from '@/lib/line-program-excess'
import { calculateLineProgram } from '@/lib/line-program-calculation'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { linePrograms } from '@/db/schema'
import { loadLineProgramRows, loadLineProgramOverviews, toLineProgramRecord } from '@/server/line-program'
import { getDispatcherTaskIndexSnapshot } from '@/server/dispatcher-task-index'
import { attachDispatcherTaskCodesToPage } from '@/server/weld-read'

const PROJECT = 'E2E inheritance and additional 04Nov'
const continuation = asE2eOwner(createWeldJoints, 'welding.edit')
const update = asE2eOwner(updateWeldJoint, 'welding.edit')
const previewOfficiality = asE2eOwner(previewLnkOfficialityChange, 'lnk.edit'), applyOfficiality = asE2eOwner(applyLnkOfficialityChange, 'lnk.edit')
const batch = asE2eOwner(updateWeldJoints, 'welding.edit')
const mass = asE2eOwner(massFillWeldJoints, 'welding.import')
const replace = asE2eOwner(replaceWeldJoints, 'welding.import')
const versions = (ids: number[]) => withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids])).rows as Array<{id: number; version: string}>)
const snapshot = (id: number) => withE2eDatabase(async db => (await db.query('select * from weld_joints where id=$1', [id])).rows[0])
test.afterEach(() => cleanupLineProgramProjects([PROJECT]))

async function seed(name: string) {
  return withLineProgramFixture(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'INH',$2,'II','A',50,50) returning id`, [PROJECT, name])
    const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      category,group_name,weld_control_percent,pvk_control_percent,has_vik,has_rk,stamp_1_k,stamp_1_k_fact,officiality,revision_actuality,
      welding_method,material_group,d1,d2,t1,t2,wdi,isometry,spool)
      select $1,$2,'INH',$3,'F840'||n,'2026-09-01','С17','II','A',50,50,'да',case when n<=2 then 'да' else null end,
      'INH-A','INH-A','действующий','актуальная','РД','М01',108,108,4,4,0.42,'ISO-INH','S1' from generate_series(1,4) n returning id,joint`, [line.id, PROJECT, name])
    if (!(await db.query("select 1 from welder_stamps where naks_stamp='INH-A'")).rowCount) await db.query(`insert into welder_stamps
      (naks_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits)
      values('INH-A','Inheritance','РД','М01','1','1000','1','100','2026-01-01','2026-12-31',
      '[{"id":"inh","weldType":"РД","materialGroups":"М01","diameterFrom":"1","diameterTo":"1000","thicknessFrom":"1","thicknessTo":"100","validFrom":"2026-01-01","validTo":"2026-12-31","archived":false}]')`)
    return { id: Number(line.id), rows: rows.sort((a, b) => a.id - b.id) as Array<{id: number; joint: string}> }
  })
}
async function modal(page: Page, name: string) {
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await expect(program.getByLabel('Итоги раздела')).toBeVisible()
  await program.getByLabel('Поиск программы линий').fill(name)
  const card = program.getByTestId('line-program-card')
  await expect(card).toHaveCount(1)
  await card.click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Назначения', exact: true }).click()
  return page.getByRole('dialog', { name: `Назначения · ${name}` })
}

test('программа и карточка: второй Да запрещён, Доп с основанием не вытесняет норму и не создаёт согласование', async ({ page }) => {
  const line = await seed('INHERIT-UI'), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const editor = await modal(page, 'INHERIT-UI')
  await expect(editor.getByLabel('F8401 · УЗК', { exact: true }).locator('option[value="да"]')).toBeDisabled()
  await expect(editor.getByRole('button', { name: /Согласовать/ })).toHaveCount(0)
  await editor.getByLabel('F8403 · РК', { exact: true }).selectOption('дополнительный')
  await expect(editor.getByRole('button', { name: 'Проверить изменения', exact: true })).toBeDisabled()
  await expect(editor.getByLabel('F8403 · РК · Основание к назначению', { exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Сохранить назначения', exact: true })).toHaveCount(0)
  await editor.getByLabel('F8403 · РК · Основание к назначению', { exact: true }).fill('ТР-04-11')
  await editor.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  await expect.poll(async () => (await snapshot(line.rows[2].id)).has_rk).toBe('дополнительный')
  await withE2eDatabase(async client => {
    const db = drizzle(client), [storedLine] = await db.select().from(linePrograms).where(eq(linePrograms.id, line.id))
    const rows = await loadLineProgramRows(db, storedLine), groups = calculateLineProgram(rows, 50, 50)
    expect(groups[0].common).toMatchObject({ required: 2, missing: 0, excessRowIds: [] })
    expect(getProgramRemovalHints(line.id, rows, groups, new Set()).size).toBe(0)
    expect((await loadLineProgramOverviews(db, [toLineProgramRecord(storedLine)]))[0].overview).toMatchObject({ approved: 0, additional: 1, common: { excess: 0 } })
    expect((await client.query("select 1 from dispatcher_accepted_warnings where kind='line-program-control' and weld_joint_id=any($1::int[])", [line.rows.map(row => row.id)])).rowCount).toBe(0)
  })
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await page.goto('/journal')
  await editJournalJoint(page, 'F8401')
  const card = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  await card.getByRole('button', { name: 'Назначение контроля', exact: true }).click()
  const uzk = card.getByText('Назначение УЗК', { exact: true }).locator('..')
  await expect(uzk.getByRole('button', { name: 'Да', exact: true })).toBeDisabled()
  await expect(uzk.getByRole('button', { name: 'Дополнительный', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
  await page.screenshot({ path: 'outputs/control-inheritance-card.png' })
})

test('наследование: негодный Доп и отмена копируются точно; карточка, импорт и замена защищают цепочку и откатывают всю операцию', async ({ page }) => {
  const line = await seed('INHERIT-CHAIN'), source = line.rows[0], peer = line.rows[3]
  await withLineProgramFixture(db => db.query(`update weld_joints set has_uzk='дополнительный',has_pvk='отменен',
    vik_result='годен',vik_request='INH-VIK',vik_request_date='2026-09-01',vik_conclusion='INH-VIK-C',vik_conclusion_date='2026-09-01',
    uzk_result='ремонт',uzk_request='INH-UZK',uzk_request_date='2026-09-01',uzk_conclusion='INH-UZK-C',uzk_conclusion_date='2026-09-01'
    where id=$1`, [source.id]))
  const [child] = await continuation({ data: { source: (await versions([source.id]))[0], targetJoints: ['F8401R1'] } })
  expect(await snapshot(child.id)).toMatchObject({ has_rk: 'да', has_uzk: 'дополнительный', has_pvk: 'отменен', uzk_control_basis: null, pvk_control_basis: null, uzk_result: 'ожидает заявку', uzk_request: null, uzk_conclusion: null })
  const editor = await modal(page, 'INHERIT-CHAIN')
  for (const [method, current] of [['РК', 'да'], ['УЗК', 'дополнительный'], ['ПВК', 'отменен']]) {
    const field = editor.getByLabel(`F8401R1 · ${method}`, { exact: true })
    await expect(field).toHaveValue(current)
    for (const value of ['', 'да', 'дополнительный', 'отменен'].filter(value => value !== current)) await expect(field.locator(`option[value="${value}"]`)).toBeDisabled()
  }
  const before = await snapshot(child.id), peerBefore = await snapshot(peer.id), expected = await versions([child.id, peer.id])
  for (const patch of [{ hasRk: null }, { hasUzk: 'да' }, { hasPvk: 'да' }]) {
    await expect(update({ data: { id: child.id, expectedVersion: expected.find(row => row.id === child.id)!.version, ...patch } })).rejects.toThrow(/унаследован/)
  }
  for (const write of [
    () => batch({ data: { records: [{ id: peer.id, isometry: 'ROLLBACK' }, { id: child.id, hasPvk: null }], expectedVersions: expected } }),
    () => mass({ data: { records: [{ id: peer.id, isometry: 'ROLLBACK' }, { id: child.id, hasUzk: 'да' }], expectedVersions: expected } }),
    () => replace({ data: { records: [{ id: child.id, hasRk: null }], deleteIds: [peer.id], expectedVersions: expected } }),
  ]) await expect(write()).rejects.toThrow()
  expect(await snapshot(child.id)).toEqual(before)
  expect(await snapshot(peer.id)).toEqual(peerBefore)
  await update({ data: { id: child.id, expectedVersion: (await versions([child.id]))[0].version, weldingJournalNote: 'Старые основания не изменяем' } })
  const targets = await versions([source.id]), plan = await previewOfficiality({ data: { targets, officiality: 'unofficial' } })
  await applyOfficiality({ data: { targets, officiality: 'unofficial', expectedPlanKey: plan.planKey } })
  await update({ data: { id: child.id, expectedVersion: (await versions([child.id]))[0].version, hasRk: null, hasUzk: null, hasPvk: null } })
  await withE2eDatabase(async client => {
    const db = drizzle(client), [storedLine] = await db.select().from(linePrograms).where(eq(linePrograms.id, line.id))
    const rows = await loadLineProgramRows(db, storedLine)
    expect(buildProgramRepairTasks(rows, new Set()).filter(task => task.row.id === child.id)).toEqual([])
    const contextual = attachProgramRepairRequirements(rows, new Set()).find(row => row.id === child.id)!
    expect(getProgramRepairAssignmentIssues(contextual)).toEqual([])
  })
})

test('сервер: нельзя создать пару через частичное изменение или возродить отдельное согласование', async () => {
  const line = await seed('INHERIT-GUARDS'), row = line.rows[0], before = await snapshot(row.id)
  await expect(mass({ data: { records: [{ id: row.id, hasUzk: 'да' }], expectedVersions: await versions([row.id]) } })).rejects.toThrow(/Дополнительный/)
  await expect(replace({ data: { records: [{ id: row.id, hasUzk: 'да' }], deleteIds: [], expectedVersions: await versions([row.id]) } })).rejects.toThrow(/Дополнительный/)
  expect(await snapshot(row.id)).toEqual(before)
  const tx = new Proxy({}, { get() { throw new Error('Retired approval must not access the database') } })
  await expect(changeProgramApprovalsInTransaction(tx as never, {} as never)).rejects.toThrow(/больше не используется/)
})

test('катушка Y: Доп и Отменен копируются с основаниями без запрета снятия; ремонт наследует назначения самой стороны Y', async ({ page }) => {
  const line = await seed('INHERIT-COIL'), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // Four official cutouts permit the ordinary coil transition. These are
  // completed historical controls; all continuation creation and edits below
  // go through the real workflows, without an early-coil approval.
  await withLineProgramFixture(db => db.query(`update weld_joints w set
    joint=case when s.n=1 then 'F8401' else 'F8401W'||(s.n-1) end,
    weld_date=date '2026-09-01'+(s.n-1),final_status='не годен',has_rk='да',has_uzk='дополнительный',has_pvk='отменен',
    uzk_control_basis='Доп УЗК исходного соединения №41',pvk_control_basis='Отмена ПВК исходного соединения №42',
    vik_result='годен',vik_request='COIL-V-'||s.n,vik_request_date=date '2026-09-01'+(s.n-1),
    vik_conclusion='COIL-VC-'||s.n,vik_conclusion_date=date '2026-09-01'+(s.n-1),
    rk_result='вырез',rk_request='COIL-R-'||s.n,rk_request_date=date '2026-09-01'+(s.n-1),
    rk_conclusion='COIL-RC-'||s.n,rk_conclusion_date=date '2026-09-01'+(s.n-1),
    uzk_result='годен',uzk_request='COIL-U-'||s.n,uzk_request_date=date '2026-09-01'+(s.n-1),
    uzk_conclusion='COIL-UC-'||s.n,uzk_conclusion_date=date '2026-09-01'+(s.n-1)
    from (select id,ordinality::int n from unnest($1::int[]) with ordinality t(id,ordinality)) s
    where w.id=s.id`, [line.rows.map(row => row.id)]))
  const source = line.rows[3], sourceBefore = await snapshot(source.id)
  const sides = await continuation({ data: { source: (await versions([source.id]))[0], targetJoints: ['F8401Y1', 'F8401Y2'] } })
  expect(sides.map(row => row.joint).sort()).toEqual(['F8401Y1', 'F8401Y2'])
  const side = sides.find(row => row.joint === 'F8401Y1')!, other = sides.find(row => row.joint === 'F8401Y2')!
  for (const row of sides) expect(await snapshot(row.id)).toMatchObject({
    has_rk: 'да', has_uzk: 'дополнительный', has_pvk: 'отменен',
    uzk_control_basis: 'Доп УЗК исходного соединения №41', pvk_control_basis: 'Отмена ПВК исходного соединения №42',
    weld_date: null, rk_request: null, rk_conclusion: null, uzk_request: null, uzk_conclusion: null,
  })
  const otherBefore = await snapshot(other.id)
  const assertNoMissingInheritance = async (ids: number[]) => {
    expect((await getDispatcherTaskIndexSnapshot({ ensureFresh: true })).isFresh).toBe(true)
    const stored = await withE2eDatabase(async db => (await db.query(
      "select weld_joint_id from dispatcher_row_tasks where weld_joint_id=any($1::int[]) and code='СП-08'", [ids],
    )).rows)
    expect(stored).toEqual([])
    const visible = await attachDispatcherTaskCodesToPage(ids.map(id => ({ id, dispatcherTasks: '' })))
    for (const row of visible) expect(String(row.dispatcherTasks).split(', ')).not.toContain('СП-08')
  }
  const editor = await modal(page, 'INHERIT-COIL')
  for (const method of ['РК', 'УЗК', 'ПВК']) {
    const field = editor.getByLabel(`F8401Y1 · ${method}`, { exact: true })
    await expect(field.locator('option[value=""]')).toBeEnabled()
    await field.selectOption('')
  }
  await editor.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  await expect.poll(() => snapshot(side.id)).toMatchObject({ has_rk: null, has_uzk: null, has_pvk: null })
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await assertNoMissingInheritance([side.id, other.id])

  // The copied basis never exempts a fresh manual assignment from validation.
  // Explicit blank bases exercise the server even if the editor retains text.
  const cleared = await snapshot(side.id)
  for (const patch of [
    { hasUzk: 'дополнительный', uzkControlBasis: null },
    { hasPvk: 'отменен', pvkControlBasis: null },
  ]) await expect(update({ data: { id: side.id, expectedVersion: (await versions([side.id]))[0].version, ...patch } })).rejects.toThrow(/основан/i)
  expect(await snapshot(side.id)).toEqual(cleared)
  const ownEditor = await modal(page, 'INHERIT-COIL')
  for (const [method, assignment, basis] of [
    ['УЗК', 'дополнительный', 'Доп УЗК новой стороны Y1 №51'],
    ['ПВК', 'отменен', 'Отмена ПВК новой стороны Y1 №52'],
  ]) {
    await ownEditor.getByLabel(`F8401Y1 · ${method}`, { exact: true }).selectOption(assignment)
    const input = ownEditor.getByLabel(`F8401Y1 · ${method} · Основание к назначению`, { exact: true })
    await input.fill('')
    await expect(ownEditor.getByRole('button', { name: 'Проверить изменения', exact: true })).toBeDisabled()
    await input.fill(basis)
  }
  await ownEditor.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await ownEditor.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  await expect.poll(() => snapshot(side.id)).toMatchObject({
    has_rk: null, has_uzk: 'дополнительный', has_pvk: 'отменен',
    uzk_control_basis: 'Доп УЗК новой стороны Y1 №51', pvk_control_basis: 'Отмена ПВК новой стороны Y1 №52',
  })
  await ownEditor.getByRole('button', { name: 'Закрыть назначения' }).click()
  await update({ data: { id: side.id, expectedVersion: (await versions([side.id]))[0].version,
    weldDate: '2026-09-05', stamp1K: 'INH-A', stamp1KFact: 'INH-A', officiality: 'действующий' } })
  // Record this new physical joint's own completed VIK and rejected UZK.
  await withLineProgramFixture(db => db.query(`update weld_joints set
    final_status='не годен',
    vik_result='годен',vik_request='Y1-V',vik_request_date='2026-09-05',vik_conclusion='Y1-VC',vik_conclusion_date='2026-09-05',
    uzk_result='ремонт',uzk_request='Y1-U',uzk_request_date='2026-09-05',uzk_conclusion='Y1-UC',uzk_conclusion_date='2026-09-05'
    where id=$1`, [side.id]))
  const sideBeforeRepair = await snapshot(side.id)
  const [repair] = await continuation({ data: { source: (await versions([side.id]))[0], targetJoints: ['F8401Y1R1'] } })
  expect(await snapshot(repair.id)).toMatchObject({
    has_vik: 'да', has_rk: null, has_uzk: 'дополнительный', has_pvk: 'отменен',
    uzk_control_basis: 'Доп УЗК новой стороны Y1 №51', pvk_control_basis: 'Отмена ПВК новой стороны Y1 №52',
    uzk_request: null, uzk_conclusion: null, uzk_result: 'ожидает заявку',
  })
  const inherited = await snapshot(repair.id)
  for (const patch of [{ hasUzk: null }, { hasPvk: null }, { hasUzk: 'да' }, { hasPvk: 'да' }]) {
    await expect(update({ data: { id: repair.id, expectedVersion: (await versions([repair.id]))[0].version, ...patch } })).rejects.toThrow(/унаследован/)
  }
  expect(await snapshot(repair.id)).toEqual(inherited)
  const repairEditor = await modal(page, 'INHERIT-COIL')
  for (const [method, current] of [['УЗК', 'дополнительный'], ['ПВК', 'отменен']]) {
    const field = repairEditor.getByLabel(`F8401Y1R1 · ${method}`, { exact: true })
    await expect(field).toHaveValue(current)
    for (const value of ['', 'да', 'дополнительный', 'отменен'].filter(value => value !== current)) await expect(field.locator(`option[value="${value}"]`)).toBeDisabled()
  }
  await assertNoMissingInheritance([side.id, other.id, repair.id])
  expect(await snapshot(source.id)).toEqual(sourceBefore)
  expect(await snapshot(side.id)).toEqual(sideBeforeRepair)
  expect(await snapshot(other.id)).toEqual(otherBefore)
  expect(errors).toEqual([])
})

test('неактуальность официального родителя не снимает наследование; старый пропуск остаётся исправимым и виден в обоих индексах СП-08', async ({ page }) => {
  const line = await seed('INHERIT-OBSOLETE'), source = line.rows[0]
  await withLineProgramFixture(db => db.query(`update weld_joints set
    vik_result='годен',vik_request='INH-OLD-V',vik_request_date='2026-09-01',vik_conclusion='INH-OLD-VC',vik_conclusion_date='2026-09-01',
    rk_result='ремонт',rk_request='INH-OLD-R',rk_request_date='2026-09-01',rk_conclusion='INH-OLD-RC',rk_conclusion_date='2026-09-01'
    where id=$1`, [source.id]))
  const [child] = await continuation({ data: { source: (await versions([source.id]))[0], targetJoints: ['F8401R1'] } })
  await update({ data: { id: source.id, expectedVersion: (await versions([source.id]))[0].version, revisionActuality: 'не актуален' } })
  const before = await snapshot(child.id)
  for (const hasRk of [null, 'дополнительный', 'отменен']) {
    await expect(update({ data: { id: child.id, expectedVersion: (await versions([child.id]))[0].version, hasRk, rkControlBasis: 'Попытка изменения' } })).rejects.toThrow(/унаследован/)
  }
  expect(await snapshot(child.id)).toEqual(before)
  const editor = await modal(page, 'INHERIT-OBSOLETE')
  const field = editor.getByLabel('F8401R1 · РК', { exact: true })
  await expect(field).toHaveValue('да')
  for (const value of ['', 'дополнительный', 'отменен']) await expect(field.locator(`option[value="${value}"]`)).toBeDisabled()
  await editor.getByRole('button', { name: 'Закрыть назначения' }).click()

  // Reproduce an already stored gap; ordinary edits must neither fill it nor fail.
  await withLineProgramFixture(db => db.query('update weld_joints set has_rk=null where id=$1', [child.id]))
  await update({ data: { id: child.id, expectedVersion: (await versions([child.id]))[0].version, weldingJournalNote: 'Несвязанное исправление' } })
  expect((await snapshot(child.id)).has_rk).toBeNull()
  const assertSp08 = async (present: boolean) => {
    expect((await getDispatcherTaskIndexSnapshot({ ensureFresh: true })).isFresh).toBe(true)
    const stored = await withE2eDatabase(async db => (await db.query('select code from dispatcher_row_tasks where weld_joint_id=$1', [child.id])).rows.map(row => row.code))
    const [visible] = await attachDispatcherTaskCodesToPage([{ id: child.id, dispatcherTasks: '' }])
    expect(stored.includes('СП-08')).toBe(present)
    expect(String(visible.dispatcherTasks).split(', ').includes('СП-08')).toBe(present)
  }
  await assertSp08(true)
  const restore = await modal(page, 'INHERIT-OBSOLETE')
  await restore.getByLabel('F8401R1 · РК', { exact: true }).selectOption('да')
  await restore.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await restore.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  await expect.poll(async () => (await snapshot(child.id)).has_rk).toBe('да')
  await assertSp08(false)
})
