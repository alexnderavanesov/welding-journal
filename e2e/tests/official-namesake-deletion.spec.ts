import { lnkRow as lnkGridRow } from './lnk-grid-helpers'
import { journalRow, deleteJournalJoint } from '../journal-grid'
import { expect, test, type Page } from '@playwright/test'
import { inArray } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { getLnkResultRestrictionReasons } from '@/lib/lnk-result-policy'
import { getDispatcherTaskIndexSnapshot } from '@/server/dispatcher-task-index'
import { listWeldingJournalPage } from '@/server/weld-read'
import { deleteWeldJoint } from '@/server/weld-mutations'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E official namesake deletion', line = 'DELETE-NAMESAKE', joint = 'S63W1R1', stamp = 'E2ND'
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [stamp])
    await db.query('delete from technology_cards where name=$1', [project])
  })
})

async function seed() {
  const ids = await withE2eDatabase(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'DEL',$2,'II','Б(а)',10,0) returning id`, [project, line])
    const { rows: [card] } = await db.query(`insert into technology_cards(name,welding_methods,connection_type,material_groups,
      diameter_from,diameter_to,thickness_from,thickness_to,psto)
      values ($1,array['РД'],'С17',array['М01'],1,1000,1,100,'any') returning id`, [project])
    await db.query('insert into technology_card_names(name,technology_card_id) values($1,$2)', [project, card.id])
    await db.query(`insert into welder_stamps(naks_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits)
      values ($1,'E2E цепочка после удаления','РД','М01','1','1000','1','100','2026-01-01','2026-12-31',$2)`,
    [stamp, JSON.stringify([{ id: 'namesake-delete', weldType: 'РД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '1000', thicknessFrom: '1', thicknessTo: '100', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }])])
    const { rows } = await db.query<{ id: number }>(`insert into weld_joints
      (line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,weld_date,connection_type,
        material_group,welding_method,d1,d2,t1,t2,wdi,stamp_1_k,has_vik,vik_result,vik_request,vik_request_date,
        vik_conclusion,vik_conclusion_date,has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,final_status)
      select $3,$1,'DEL',$2,name,case when n=3 then 'неофициальный' else null end,'актуальная',
        '2026-09-01'::date+n,'С17','М01','РД',108,108,4,4,0.42,$4,'да','годен','DEL-VIK-R-'||n,'2026-09-01'::date+n,
        'DEL-VIK-C-'||n,'2026-09-01'::date+n,'да',
        case n when 1 then 'вырез' when 2 then 'ремонт' when 3 then 'ожидает НК' else 'годен' end,
        'DEL-UZK-R-'||n,'2026-09-01'::date+n,case when n=3 then null else 'DEL-UZK-C-'||n end,
        case when n=3 then null else '2026-09-01'::date+n end,
        case when n<=2 then 'не годен' when n=3 then 'ожидает НК' else 'годен' end
      from (select name,ordinality::int as n from unnest(array['S63','S63W1','S63W1R1','S63W1R1']) with ordinality as t(name,ordinality)) t
      returning id`, [project, line, program.id, stamp])
    await db.query(`update weld_joints set stamp_1_z=$1,stamp_1_o=$1,stamp_1_k_fact=$1,stamp_1_z_fact=$1,stamp_1_o_fact=$1,
      technology_card_number=$2,category='II',group_name='Б(а)',weld_control_percent=10,pvk_control_percent=0 where project_title=$2`, [stamp, project])
    await db.query(`insert into dispatcher_task_index_state(id,source_revision,computed_revision,full_rebuild,updated_at)
      values (1,1,-1,true,now()) on conflict (id) do update
      set source_revision=dispatcher_task_index_state.source_revision+1,full_rebuild=true,updated_at=now()`)
    return rows.map(row => row.id)
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  return { rootId: ids[0], sourceId: ids[1], remainingId: ids[2], removedId: ids[3] }
}

const facts = () => withE2eDatabase(async db => (await db.query(`select id,joint,officiality,vik_result,vik_conclusion,
  uzk_result,uzk_conclusion,uzk_conclusion_date::text from weld_joints where project_title=$1 order by id`, [project])).rows)
async function chainTasks() {
  const snapshot = await getDispatcherTaskIndexSnapshot({ ensureFresh: true })
  expect(snapshot.isFresh).toBe(true)
  const tasks = snapshot.repeatedJointTasks.filter(task => 'row' in task && task.row.projectTitle === project)
  // The official rejected PRIMARY S63 legitimately retains its percentage-line
  // notice. Deleting a later namesake must neither erase that fact nor create
  // false name/order/repair-limit warnings. This is not an expectation of zero
  // work in every subsystem merely because the chain is structurally sound.
  expect(tasks.filter(task => task.kind === 'percentage-line-control')).toEqual([
    expect.objectContaining({ kind: 'percentage-line-control', issue: 'rejected-rows', count: 1 }),
  ])
  return tasks.filter(task => task.kind !== 'percentage-line-control')
}
async function officialityDialog(page: Page) {
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Официальность', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  // The list offers rejected official rows and unofficial history; the good
  // official twin is not an officiality candidate.
  await dialog.getByRole('button').filter({ hasText: `${line} · ${joint}` }).click()
  await dialog.getByRole('button', { name: /^Официальный/ }).click()
  return dialog
}

async function expectNoChainCodes() {
  expect(await chainTasks()).toEqual([])
  const persisted = await withE2eDatabase(async db => (await db.query(`select t.code from dispatcher_row_tasks t
    join weld_joints w on w.id=t.weld_joint_id where w.project_title=$1 and t.code in ('СП-07','СП-09')`, [project])).rows)
  expect(persisted).toEqual([])
  const report = await listWeldingJournalPage({ data: { search: project, pageSize: 100 } })
  expect(report.rows.length).toBeGreaterThanOrEqual(3)
  for (const row of report.rows) expect(row.dispatcherTasks ?? '').not.toMatch(/СП-07|СП-09/)
}

for (const result of ['ремонт', 'вырез'] as const) test(`удалить официального тёзку → восстановить оставшегося → ${result}: правильная цепочка и продолжение`, async ({ page }) => {
  const { rootId, sourceId, remainingId, removedId } = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const original = await facts()
  let officiality = await officialityDialog(page)
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  const notice = page.getByRole('status').filter({ hasText: `уже есть официальный стык ${joint}` })
  await expect(notice).toContainText('нет собственного результата')
  await expect(notice).toContainText('Ничего не сохранено')
  await notice.getByRole('button', { name: 'Закрыть уведомление' }).click()
  expect(await facts()).toEqual(original)
  await officiality.getByRole('button', { name: 'Отмена', exact: true }).click()

  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  const remove = () => deleteJournalJoint(page, removedId)
  const confirm = page.locator('[data-confirm-action-dialog="true"]').locator('..')
  await remove()
  await confirm.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await facts()).toEqual(original)
  await remove()
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect.poll(async () => (await facts()).map(row => row.id)).toEqual([rootId, sourceId, remainingId])
  expect(await facts()).toEqual(original.filter(row => row.id !== removedId))
  expect(await chainTasks()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'create', targetJoint: joint })]))
  const documentTitles = () => withE2eDatabase(async db => (await db.query(`select title from generated_documents where title like 'DEL-%' order by title`)).rows.map(row => row.title))
  expect(await documentTitles()).not.toContain('DEL-UZK-C-4')
  expect(await documentTitles()).toContain('DEL-VIK-C-3')

  officiality = await officialityDialog(page)
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(officiality).toBeHidden()
  expect(await facts()).toEqual(original.filter(row => row.id !== removedId).map(row => row.id === remainingId ? { ...row, officiality: null } : row))
  await expectNoChainCodes()
  await page.reload()

  // Backfill through the real operator dialog after restoration; the missing
  // result is not invented by either deletion or officiality change.
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
  await lnkGridRow(page, joint).getByRole('checkbox').click()
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Внести результаты', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true }) })
  await dialog.getByLabel('Метод контроля', { exact: true }).selectOption('uzkRequest')
  await dialog.getByRole('checkbox', { name: `Выбрать стык ${line} ${joint}`, exact: true }).check()
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-04')
  await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: result, exact: true }).click()
  await dialog.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  await expect(dialog).toBeHidden()
  // Existing naming rule increments the accumulated counter of the chosen
  // suffix: W1 becomes W2, while the already completed R1 is retained.
  const target = result === 'ремонт' ? 'S63W1R2' : 'S63W2R1'
  const tasks = await chainTasks()
  expect(tasks.filter(task => task.kind === 'create')).toEqual([expect.objectContaining({ sourceJoint: joint, targetJoint: target })])
  expect(tasks.filter(task => ['rename', 'delete', 'duplicate-check', 'check'].includes(task.kind))).toEqual([])
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await journalRow(page, remainingId).getByRole('button', { name: joint, exact: true }).click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Картина стыка ${joint}`, exact: true }) })
  await picture.getByRole('region', { name: 'Продолжение цепочки стыка' }).getByRole('button', { name: `Создать ${target}`, exact: true }).click()
  await expect.poll(async () => (await facts()).map(row => row.joint)).toEqual(['S63', 'S63W1', joint, target])
  await expectNoChainCodes()
  const created = (await facts()).find(row => row.joint === target)!
  expect(created.id).not.toBe(removedId)
  expect(created.uzk_conclusion).toBeNull()
  expect(created.uzk_result).not.toBe('годен')
  expect(await withE2eDatabase(async db => (await db.query('select source_row_id from weld_joint_program_states where weld_joint_id=$1', [created.id])).rows[0]))
    .toEqual({ source_row_id: remainingId })
  const limits = getLnkResultRestrictionReasons({ joint: target, d1: 108, d2: 108 }, 'УЗК', 'ремонт')
  expect(limits.length > 0).toBe(result === 'ремонт')
  if (result === 'ремонт') expect(limits.join(' ')).toContain('два ремонта')
  await page.reload()
  expect((await facts()).map(row => row.joint)).toEqual(['S63', 'S63W1', joint, target])
  await expectNoChainCodes()
  const beforeBlockedDeletion = await facts()
  await deleteJournalJoint(page, remainingId)
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText(/Нельзя удалить предшественника: остаются продолжения цепочки/)).toContainText(target)
  expect(await facts()).toEqual(beforeBlockedDeletion)
  // A created continuation protects its immediate predecessor. This is an
  // existing invariant, not permission to silently splice a middle node out.
  const targetVersion = await withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where id=$1', [remainingId])).rows[0])
  await expect(deleteWeldJoint({ data: targetVersion })).rejects.toThrow('Нельзя удалить предшественника')
  expect(await facts()).toEqual(beforeBlockedDeletion)
  expect(errors).toEqual([])
})
