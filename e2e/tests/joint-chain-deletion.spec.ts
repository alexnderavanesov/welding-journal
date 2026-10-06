import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { createWeldJoints, deleteWeldJoint, deleteWeldJoints } from '@/server/weld-mutations'
import { replaceWeldJoints } from '@/server/weld-import'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E chain deletion protection'
type Target = { id: number; version: string }
let previousDataList: { value: string; updated_at: Date } | undefined
test.beforeAll(async () => withE2eDatabase(async db => {
  previousDataList = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
  const settings = previousDataList ? JSON.parse(previousDataList.value) : {}
  settings.connectionTypes = [...new Set([...(settings.connectionTypes ?? []), 'С19'])]
  await db.query(`insert into app_settings(key,value) values ('data-list',$1)
    on conflict(key) do update set value=excluded.value`, [JSON.stringify(settings)])
}))
test.afterAll(async () => withE2eDatabase(async db => {
  if (previousDataList) await db.query("update app_settings set value=$1,updated_at=$2 where key='data-list'", [previousDataList.value, previousDataList.updated_at])
  else await db.query("delete from app_settings where key='data-list'")
}))
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed() {
  return withE2eDatabase(async db => {
    const { rows } = await db.query<Target>(`insert into weld_joints
      (project_title, subtitle_code, line, joint, officiality, revision_actuality, has_vik, final_status)
      select $1,'DELETE','CHAIN-DELETE',name,
        case when name='S1R1' then 'неофициальный' else 'действующий' end,
        case when name='S1R2' then 'не актуален' else 'актуален' end,'да',
        case when name in ('S1R1','S1R2') then 'ожидает ремонт' else 'ожидает сварку' end
      from unnest(array['S1','S1R1','S1R2','F9']) name returning id,xmin::text as version`, [project])
    return rows
  })
}
const snapshot = () => withE2eDatabase(async db => (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows)

for (const deletionFirst of [true, false]) test(`создание продолжения и удаление источника конкурентно: удаление запущено ${deletionFirst ? 'первым' : 'вторым'}`, async () => {
  const createSource = () => withE2eDatabase(async db => (await db.query<Target>(`insert into weld_joints
    (project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,vik_result,has_rk,rk_result,stamp_1_k)
    values ($1,'DELETE','RACE','S1','2026-09-01','С19','да','годен','да','ремонт','A') returning id,xmin::text as version`, [project])).rows[0])
  // Prove the fixture genuinely permits repair creation; a failing creator must
  // not make an otherwise ineffective race test pass through deletion alone.
  const initial = await createSource()
  await createWeldJoints({ data: { source: initial, targetJoints: ['S1R1'] } })
  expect((await snapshot()).map(r => r.joint)).toEqual(['S1', 'S1R1'])
  const targets = await withE2eDatabase(async db => (await db.query<Target>(
    'select id,xmin::text as version from weld_joints where project_title=$1', [project])).rows)
  await deleteWeldJoints({ data: { targets } })
  const source = await createSource()
  const create = () => createWeldJoints({ data: { source, targetJoints: ['S1R1'] } })
  const remove = () => deleteWeldJoint({ data: source })
  const results = await Promise.allSettled(deletionFirst ? [remove(), create()] : [create(), remove()])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const final = await snapshot()
  expect([[], ['S1', 'S1R1']]).toContainEqual(final.map(r => r.joint))
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(String(failure.reason)).toMatch(/предшественника|больше не|перенесен|изменен|изменил|устарел/i)
})

for (const mode of ['single', 'bulk', 'import'] as const) {
  test(`${mode}: предшественник с неофициальным/неактуальным продолжением не удаляется; группа атомарна`, async () => {
    const rows = await seed(), before = await snapshot()
    const action = mode === 'single' ? deleteWeldJoint({ data: rows[0] })
      : mode === 'bulk' ? deleteWeldJoints({ data: { targets: [rows[0], rows[3]] } })
      : replaceWeldJoints({ data: { records: [], deleteIds: [rows[0].id, rows[3].id], expectedVersions: [rows[0], rows[3]] } })
    await expect(action).rejects.toThrow(/Нельзя удалить предшественника.*S1R1.*S1R2/)
    expect(await snapshot()).toEqual(before)
    await expect(deleteWeldJoint({ data: rows[1] })).rejects.toThrow(/Нельзя удалить предшественника.*S1R2/)
    expect(await snapshot()).toEqual(before)
  })
}

test('удаление с конца и всей веткой сохраняет доступный путь исправления', async () => {
  const rows = await seed()
  await deleteWeldJoint({ data: rows[2] })
  await deleteWeldJoints({ data: { targets: rows.slice(0, 2) } })
  expect((await snapshot()).map(r => r.joint)).toEqual(['F9'])
  await replaceWeldJoints({ data: { records: [], deleteIds: [rows[3].id], expectedVersions: [rows[3]] } })
  expect(await snapshot()).toEqual([])
})

test('сохранённые ID защищают перенесённое продолжение через удалённый промежуточный узел', async () => {
  const rows = await seed()
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
      values ($1,'primary',$1,null),($2,'repair',$1,$1),($3,'repair',$3,$2)`, rows.slice(0, 3).map(r => r.id))
    // Synthetic damaged legacy history: normal UI must no longer create it.
    await db.query('delete from weld_joints where id=$1', [rows[1].id])
    await db.query("update weld_joints set line='MOVED',joint='F77' where id=$1", [rows[2].id])
  })
  const before = await snapshot()
  await expect(deleteWeldJoint({ data: rows[0] })).rejects.toThrow(/Нельзя удалить предшественника.*F77.*MOVED/)
  expect(await snapshot()).toEqual(before)
})

test('карточка удаления объясняет отказ; отмена не меняет цепочку и удаление хвоста доступно', async ({ page }) => {
  const rows = await seed(), before = await snapshot()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await page.locator(`tr[data-weld-row-id="${rows[0].id}"]`).getByRole('button', { name: 'Удалить', exact: true }).click()
  const confirmation = page.locator('[data-confirm-action-dialog="true"]').locator('..')
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await snapshot()).toEqual(before)
  await page.locator(`tr[data-weld-row-id="${rows[0].id}"]`).getByRole('button', { name: 'Удалить', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText(/Нельзя удалить предшественника: остаются продолжения цепочки/)).toBeVisible()
  expect(await snapshot()).toEqual(before)
  if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.locator(`tr[data-weld-row-id="${rows[2].id}"]`).getByRole('button', { name: 'Удалить', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect.poll(async () => (await snapshot()).map(r => r.joint)).toEqual(['S1', 'S1R1', 'F9'])
  expect(errors).toEqual([])
})
