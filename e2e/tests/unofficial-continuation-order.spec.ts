import { expect, test } from '@playwright/test'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { previewLnkOfficialityChange, applyLnkOfficialityChange } from '@/server/lnk-officiality-workflow'
import { createWeldJoints, createWeldJoint, updateWeldJoint } from '@/server/weld-mutations'
import { createEarlyCoilDecision } from '@/server/early-coil-workflow'
import { getDispatcherTaskIndexSnapshot } from '@/server/dispatcher-task-index'
import { readJournalGrid as rawReadJournalGrid } from '@/server/journal-grid'
import { journalRow } from '../journal-grid'
import { rpcName } from '../rpc'
import { getLnkResultRestrictionReasons } from '@/lib/lnk-result-policy'

const project = 'E2E unofficial continuation order'
const create = asE2eOwner(createWeldJoints, 'welding.edit')
const manualCreate = asE2eOwner(createWeldJoint, 'welding.edit'), update = asE2eOwner(updateWeldJoint, 'welding.edit')
const earlyCoil = asE2eOwner(createEarlyCoilDecision, 'welding.edit')
const previewOfficiality = asE2eOwner(previewLnkOfficialityChange, 'lnk.edit'), applyOfficiality = asE2eOwner(applyLnkOfficialityChange, 'lnk.edit')
const readJournalGrid = asE2eOwner(rawReadJournalGrid, 'welding.view')
test.afterEach(async ({ page }) => { await page.close(); await cleanupLineProgramProjects([project]) })

async function seed({ count = 2, joint = 'F4/1', support = false, differentDates = false } = {}) {
  return withLineProgramFixture(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'VIDEO','330-P12-04-000','II','Б(а)',20,20) returning id`, [project])
    const ancestors = joint === 'F4/1R1' ? [['F4/1', 'ремонт']] : joint === 'F4/1R2'
      ? [['F4/1', 'ремонт'], ['F4/1R1', 'ремонт']] : joint === 'F4/1W1R1'
        ? [['F4/1', 'вырез'], ['F4/1W1', 'ремонт']] : []
    for (const [name, result] of ancestors) await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      d1,d2,category,group_name,weld_control_percent,pvk_control_percent,has_rk,rk_result)
      values($1,$2,'VIDEO','330-P12-04-000',$3,'2026-09-01','С17',219,219,'II','Б(а)',20,20,'да',$4)`, [line.id, project, name, result])
    const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,weld_date,connection_type,
      material_group,welding_method,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,
      has_vik,vik_result,has_rk,rk_result,has_uzk,uzk_result,weld_length,has_pvk,pvk_result,isometry)
      select $1,$2,'VIDEO','330-P12-04-000',$3,'неофициальный',date '2026-09-06'+case when $6 then n else 0 end,
        case when $5 then 'Т1' else 'С17' end,'М01','РД',219,case when $5 then null else 219 end,6,case when $5 then null else 6 end,'II','Б(а)',20,20,
        'да','годен',case when $5 then null else 'да' end,case when $5 then null when n%2=1 then 'ремонт' else 'вырез' end,
        case when $5 then 'да' end,case when $5 then 'ремонт' end,case when $5 then 600.123456789 end,'да','годен','ATTEMPT-'||n
      from generate_series(1,$4::int) n returning id,xmin::text version`, [line.id, project, joint, count, support, differentDates])
    return rows as { id: number; version: string }[]
  })
}

const facts = () => withE2eDatabase(async db => (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows)
const current = (id: number) => withE2eDatabase(async db => (await db.query('select id,xmin::text version from weld_joints where id=$1', [id])).rows[0] as { id: number; version: string })

for (const connectionType of ['С17', 'У19', 'Т1']) for (const mode of ['repair', 'unofficial'] as const) {
  test(`старое основание НК: ${connectionType} ${mode} наследует назначения через два продолжения, ручное изменение проверяется`, async () => {
    const support = connectionType === 'Т1', joint = support ? 'ОП-4' : 'F4/1'
    const [source] = await seed({ count: 1, support, joint })
    await withLineProgramFixture(db => db.query(`update weld_joints set connection_type=$2,officiality=$3,
      has_rk=case when $4::bool then null else 'дополнительный' end,rk_result=null,
      has_uzk='да',uzk_result='ремонт',has_pvk=$5,pvk_result=null where id=$1`,
    [source.id, connectionType, mode === 'unofficial' ? 'неофициальный' : null, support, support && mode === 'repair' ? 'дополнительный' : 'отменен']))
    const before = await facts(), sourceBefore = before[0]
    const target = mode === 'repair' ? `${joint}R1` : joint
    const [first] = await create({ data: { source: await current(source.id), targetJoints: [target] } })
    expect(first).toMatchObject({ joint: target, hasRk: support ? null : 'дополнительный', hasPvk: sourceBefore.has_pvk, rkControlBasis: null, pvkControlBasis: null })
    await withLineProgramFixture(db => db.query("update weld_joints set weld_date='2026-09-20',uzk_result='ремонт' where id=$1", [first.id]))
    const [second] = await create({ data: { source: await current(first.id), targetJoints: [`${joint}R${mode === 'repair' ? 2 : 1}`] } })
    expect(second).toMatchObject({ hasRk: first.hasRk, hasPvk: first.hasPvk, rkControlBasis: null, pvkControlBasis: null })
    await update({ data: { id: second.id, expectedVersion: (await current(second.id)).version, weldingJournalNote: 'Unrelated correction' } })
    const method = support ? 'hasPvk' : 'hasRk', basis = support ? 'pvkControlBasis' : 'rkControlBasis'
    const state = second[method] === 'отменен' ? 'дополнительный' : 'отменен'
    await expect(update({ data: { id: second.id, expectedVersion: (await current(second.id)).version, [method]: state } })).rejects.toThrow('унаследован')
    await expect(update({ data: { id: second.id, expectedVersion: (await current(second.id)).version, [method]: state, [basis]: 'ТР № 7' } })).rejects.toThrow('унаследован')
    // The official immediate parent locks its assignment even with a new basis.
    // Making that parent unofficial releases inheritance, not manual basis validation.
    const targets = [await current(first.id)], plan = await previewOfficiality({ data: { targets, officiality: 'unofficial' } })
    await applyOfficiality({ data: { targets, officiality: 'unofficial', expectedPlanKey: plan.planKey } })
    if (mode === 'repair') {
      // R2 becomes R1: the original official root is now its direct parent.
      // Removing an intermediate repair must not release that root's assignment.
      expect((await facts()).find(row => row.id === second.id).joint).toBe(`${joint}R1`)
      await expect(update({ data: { id: second.id, expectedVersion: (await current(second.id)).version, [method]: state, [basis]: 'ТР № 7' } })).rejects.toThrow(`официального предшественника ${joint}`)
      expect((await facts()).find(row => row.id === source.id)).toEqual(sourceBefore)
      expect(await facts()).toHaveLength(3)
      return
    }
    await expect(update({ data: { id: second.id, expectedVersion: (await current(second.id)).version, [method]: state } })).rejects.toThrow('Основание')
    await expect(manualCreate({ data: { projectTitle: project, subtitleCode: 'VIDEO', line: '330-P12-04-000', joint: support ? 'ОП-100' : 'F100', connectionType,
      [method]: state, ...{ inheritedControlAssignmentSource: first } } })).rejects.toThrow('Основание')
    await update({ data: { id: second.id, expectedVersion: (await current(second.id)).version, [method]: state, [basis]: 'ТР № 7' } })
    await expect(update({ data: { id: second.id, expectedVersion: (await current(second.id)).version, [basis]: '' } })).rejects.toThrow('Основание')
    expect((await facts()).find(row => row.id === source.id)).toEqual(sourceBefore)
    expect(await facts()).toHaveLength(3)
  })
}

test('старое основание НК: досрочная катушка сохраняет автоматическое наследование без изменения источника', async () => {
  const [source] = await seed({ count: 1 })
  await withLineProgramFixture(db => db.query("update weld_joints set officiality=null,has_rk='дополнительный',rk_result=null,has_uzk='да',uzk_result='ремонт',has_pvk='отменен',pvk_result=null where id=$1", [source.id]))
  const before = (await facts())[0]
  const result = await earlyCoil({ data: { sourceRowId: source.id, expectedVersion: (await current(source.id)).version } })
  expect(result.createdRows.map(row => row.joint)).toEqual(['F4/1Y1', 'F4/1Y2'])
  for (const row of result.createdRows) {
    expect(row).toMatchObject({ hasRk: 'дополнительный', hasPvk: 'отменен', rkControlBasis: null, pvkControlBasis: null })
    // Y sides are new physical joints: copying does not lock their assignments.
    await update({ data: { id: row.id, expectedVersion: (await current(row.id)).version, hasRk: null, hasPvk: null } })
    expect((await facts()).find(stored => stored.id === row.id)).toMatchObject({ has_rk: null, has_pvk: null })
  }
  expect((await facts()).find(row => row.id === source.id)).toEqual(before)
})

for (const sourceIndex of [0, 1]) test(`два неофициальных F4/1: создание из записи ${sourceIndex + 1} не блокируется устранением дублей задач`, async () => {
  const ids = await seed(), before = await facts()
  const created = await create({ data: { source: ids[sourceIndex], targetJoints: ['F4/1'] } })
  expect(created).toHaveLength(1)
  const stored = await withE2eDatabase(async db => (await db.query(`select joint,officiality,isometry from weld_joints where project_title=$1 order by id`, [project])).rows)
  expect(stored).toEqual([
    { joint: 'F4/1', officiality: 'неофициальный', isometry: 'ATTEMPT-1' },
    { joint: 'F4/1', officiality: 'неофициальный', isometry: 'ATTEMPT-2' },
    { joint: 'F4/1', officiality: null, isometry: `ATTEMPT-${sourceIndex + 1}` },
  ])
  expect((await facts()).filter(row => ids.some(source => source.id === row.id))).toEqual(before)
})

for (const joint of ['F4/1', 'F4/1R1', 'F4/1R2', 'F4/1W1R1']) test(`пять неофициальных ${joint}: разные даты и результаты сохраняют номер, историю и выбранный источник`, async () => {
  const ids = await seed({ count: 5, joint, differentDates: true }), before = await facts()
  const [created] = await create({ data: { source: ids[3], targetJoints: [joint] } })
  // Assigned controls start with a derived waiting label, not an inherited
  // result. No request, conclusion or weld date has actually been recorded.
  expect(created).toMatchObject({ joint, officiality: null, isometry: 'ATTEMPT-4', weldDate: null,
    rkResult: 'ожидает заявку', vikResult: 'ожидает заявку', pvkResult: 'ожидает заявку',
    rkRequest: null, rkConclusion: null, vikRequest: null, vikConclusion: null, pvkRequest: null, pvkConclusion: null })
  expect((await facts()).filter(row => row.id !== created.id)).toEqual(before)
  await expect(create({ data: { source: await current(ids[4].id), targetJoints: [joint] } })).rejects.toThrow(/изменилось|больше не требуется|уже создан/)
  expect(await facts()).toHaveLength(before.length + 1)
  const snapshot = await getDispatcherTaskIndexSnapshot({ ensureFresh: true })
  expect(snapshot.isFresh).toBe(true)
  expect(snapshot.repeatedJointTasks.filter(task => task.row.projectTitle === project && ['create', 'coil', 'rename', 'duplicate-check'].includes(task.kind))).toEqual([])
  const persisted = await withE2eDatabase(async db => (await db.query(`select t.code from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id where w.project_title=$1 and t.code in ('СП-07','СП-09')`, [project])).rows)
  expect(persisted).toEqual([])
  const report = await readJournalGrid({ columnFilters: { search: project }, groupBy: [], route: [], start: 0, end: 100 })
  expect(report.rows).toHaveLength(before.length + 1)
  for (const row of report.rows) expect(row.dispatcherTasks ?? '').not.toMatch(/СП-07|СП-09/)
})

test('несколько неофициальных Т: официальное продолжение сохраняет длину и не добавляет R/W', async () => {
  const joint = 'ОП-4'
  const ids = await seed({ count: 4, support: true, joint }), before = await facts()
  const [created] = await create({ data: { source: ids[2], targetJoints: [joint] } })
  expect(created).toMatchObject({ joint, officiality: null, isometry: 'ATTEMPT-3', weldLength: '600.123456789', hasRk: null })
  expect((await facts()).filter(row => row.id !== created.id)).toEqual(before)
})

for (const support of [false, true]) test(`старые неофициальные тёзки с пробелами: ${support ? 'Т' : 'С'} сохраняет физический корень нового R1`, async () => {
  const joint = support ? 'ОП-4' : 'F4/1'
  const ids = await seed({ count: 3, support, joint })
  await withLineProgramFixture(db => db.query("update weld_joints set officiality=' НЕОФИЦИАЛЬНЫЙ ' where project_title=$1", [project]))
  const historical = await facts()
  const [official] = await create({ data: { source: await current(ids[1].id), targetJoints: [joint] } })
  await withLineProgramFixture(db => db.query(`update weld_joints set weld_date='2026-09-20',
    rk_result=case when $2::bool then null else 'ремонт' end,
    uzk_result=case when $2::bool then 'ремонт' else null end where id=$1`, [official.id, support]))
  const [repair] = await create({ data: { source: await current(official.id), targetJoints: [`${joint}R1`] } })
  expect(repair.joint).toBe(`${joint}R1`)
  expect(await withE2eDatabase(async db => (await db.query(`select source_row_id,physical_root_id
    from weld_joint_program_states where weld_joint_id=$1`, [repair.id])).rows[0]))
    .toEqual({ source_row_id: official.id, physical_root_id: official.id })
  expect((await facts()).filter(row => ids.some(source => source.id === row.id))).toEqual(historical)
})

test('НК до ТО у последней из нескольких неофициальных попыток: продолжение сохраняет историю контроля', async () => {
  const ids = await seed({ count: 4 })
  await withLineProgramFixture(async db => {
    await db.query(`update weld_joints set psto_required='да',rk_result=null,vik_result=null,pvk_result=null where project_title=$1`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'РК','PRE-UNOFFICIAL-'||id,'2026-09-06',case when id%2=0 then 'ремонт' else 'вырез' end,
        'PRE-UNOFFICIAL-C-'||id,'2026-09-07' from weld_joints where project_title=$1`, [project])
  })
  const controls = () => withE2eDatabase(async db => (await db.query(`select c.* from pre_heat_treatment_controls c
    join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by c.id`, [project])).rows)
  const before = await facts(), controlHistory = await controls()
  const [created] = await create({ data: { source: await current(ids[3].id), targetJoints: ['F4/1'] } })
  expect(created).toMatchObject({ joint: 'F4/1', officiality: null, isometry: 'ATTEMPT-4', weldDate: null })
  expect(await controls()).toEqual(controlHistory)
  expect((await facts()).filter(row => row.id !== created.id)).toEqual(before)
})

for (const [joint, target] of [['F4/1', 'F4/1R1'], ['F4/1R1', 'F4/1R2'], ['F4/1W1R1', 'F4/1W1R2']]) {
  test(`после пяти неофициальных ${joint} следующий настоящий ремонт получает ${target}`, async () => {
    const ids = await seed({ count: 5, joint }), historical = await facts()
    const [official] = await create({ data: { source: ids[4], targetJoints: [joint] } })
    // Simulate the next recorded inspection; the continuation action and its
    // chain/limit checks below use the real transactional mutation.
    await withLineProgramFixture(db => db.query(`update weld_joints set weld_date='2026-09-20',rk_result='ремонт' where id=$1`, [official.id]))
    const [repair] = await create({ data: { source: await current(official.id), targetJoints: [target] } })
    expect(repair.joint).toBe(target)
    expect(getLnkResultRestrictionReasons(repair, 'РК', 'ремонт').length > 0).toBe(target.endsWith('R2'))
    expect((await facts()).filter(row => row.id !== official.id && row.id !== repair.id)).toEqual(historical)
  })
}

test('устаревшая версия, одновременное создание из разных тёзок и повтор запроса не создают дубль', async () => {
  const ids = await seed({ count: 4 })
  await withLineProgramFixture(db => db.query('update weld_joints set welding_journal_note=$1 where id=$2', ['changed', ids[2].id]))
  const before = await facts()
  await expect(create({ data: { source: ids[2], targetJoints: ['F4/1'] } })).rejects.toMatchObject({ code: 'ROW_VERSION_STALE' })
  expect(await facts()).toEqual(before)
  const requests = [ids[1], await current(ids[2].id)]
  const results = await Promise.allSettled(requests.map(source => create({ data: { source, targetJoints: ['F4/1'] } })))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(String(failure.reason)).toMatch(/изменилось|больше не требуется|уже создан/)
  const stored = await facts()
  expect(stored.filter(row => row.officiality !== 'неофициальный')).toHaveLength(1)
  expect(stored.filter(row => ids.some(source => source.id === row.id))).toEqual(before)
  await expect(create({ data: { source: await current(ids[0].id), targetJoints: ['F4/1'] } })).rejects.toThrow(/изменилось|больше не требуется|уже создан/)
  expect(await facts()).toEqual(stored)
})

for (const invalid of ['no-result', 'inactive', 'wrong-target', 'broken-chain'] as const) test(`проверка выбранного источника сохраняет запрет ${invalid}`, async () => {
  const ids = await seed()
  await withLineProgramFixture(async db => {
    if (invalid === 'no-result') await db.query('update weld_joints set rk_result=null where id=$1', [ids[1].id])
    if (invalid === 'inactive') await db.query("update weld_joints set revision_actuality='не актуален' where id=$1", [ids[1].id])
    if (invalid === 'broken-chain') await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,connection_type)
      select $1,'VIDEO','330-P12-04-000','F4/1R1','С17' from generate_series(1,2)`, [project])
  })
  const before = await facts()
  await expect(create({ data: { source: await current(ids[1].id), targetJoints: [invalid === 'wrong-target' ? 'F4/1R1' : 'F4/1'] } })).rejects.toThrow(/изменилось|больше не требуется|заблокировано/)
  expect(await facts()).toEqual(before)
})

test('UI: задача из последней неофициальной попытки создаёт один официальный F4/1 и исчезает после обновления', async ({ page }) => {
  const ids = await seed({ count: 3, differentDates: true }), errors: string[] = [], calls: string[] = []
  // Legacy assignments without a basis must also survive the actual UI action.
  await withLineProgramFixture(db => db.query("update weld_joints set has_rk='дополнительный',has_pvk='отменен',pvk_result=null where id=$1", [ids[2].id]))
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await journalRow(page, ids[2].id).getByRole('button', { name: 'F4/1', exact: true }).click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F4/1', exact: true }) })
  await picture.getByRole('region', { name: 'Продолжение цепочки стыка' }).getByRole('button', { name: 'Создать F4/1', exact: true }).click()
  await expect.poll(async () => (await facts()).filter(row => row.officiality !== 'неофициальный')).toEqual([
    expect.objectContaining({ joint: 'F4/1', isometry: 'ATTEMPT-3', weld_date: null, rk_result: 'ожидает заявку', rk_request: null, rk_conclusion: null,
      has_rk: 'дополнительный', has_pvk: 'отменен', rk_control_basis: null, pvk_control_basis: null }),
  ])
  await page.reload()
  await journalRow(page, ids[2].id).getByRole('button', { name: 'F4/1', exact: true }).click()
  await expect(picture.getByRole('button', { name: 'Создать F4/1', exact: true })).toHaveCount(0)
  expect(calls.filter(name => name.startsWith('createWeldJoints_'))).toHaveLength(1)
  expect(errors).toEqual([])
})
