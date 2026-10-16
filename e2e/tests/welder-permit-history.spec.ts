import { editJournalJoint } from '../journal-grid'
import { expect, test, type Locator } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import type { RepeatedJointTask } from '../../src/lib/dispatcher-types'
import { getDispatcherTaskCode } from '../../src/lib/dispatcher-settings'

const project = 'E2E permit history'
const code = 'EPH1'
let settingsBefore: { value: string; updated_at: Date } | undefined
let settingsCaptured = false

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map(page => page.close()))
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [code])
    if (settingsCaptured) {
      if (settingsBefore) await db.query("update app_settings set value=$1,updated_at=$2 where key='save-check'", [settingsBefore.value, settingsBefore.updated_at])
      else await db.query("delete from app_settings where key='save-check'")
    }
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
  })
})
const stamp = () => withE2eDatabase(async db => {
  const row = (await db.query('select * from welder_stamps where naks_stamp=$1', [code])).rows[0]
  return { ...row, naks: JSON.parse(row.naks_permits), dls: JSON.parse(row.dls_permits) }
})
async function fillPermit(editor: Locator, groups: string[]) {
  for (const value of ['РАД', ...groups]) await editor.getByRole('button', { name: value, exact: true }).click()
  for (const [label, value] of [['Диаметр от', '1'], ['Диаметр до', '500'], ['Толщина от', '1'], ['Толщина до', '20'],
    ['Срок от', '2026-01-01'], ['Срок до', '2026-12-31']]) await editor.getByLabel(label, { exact: true }).fill(value)
}

test('UI: диапазоны, сроки и архив допуска обновляют старые задачи, старое окно стыка не обходит новый допуск', async ({ page, context }) => {
  test.setTimeout(180_000)
  settingsBefore = await withE2eDatabase(async db => (await db.query("select value,updated_at from app_settings where key='save-check'")).rows[0])
  settingsCaptured = true
  await page.goto('/settings#rules-dls-requirement')
  const toggle = page.getByRole('checkbox', { name: 'Требовать ДЛС для официальных клейм', exact: true })
  if (!await toggle.isChecked()) await toggle.click()
  await expect(toggle).toBeChecked()
  await expect.poll(() => withE2eDatabase(async db => JSON.parse((await db.query("select value from app_settings where key='save-check'")).rows[0]?.value ?? '{}').officialDls)).toBe(true)
  await page.goto('/welder-stamps')
  await page.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Клеймо НАКС', { exact: true }).fill(code)
  await dialog.getByLabel('ФИО сварщика', { exact: true }).fill('История допуска')
  await fillPermit(dialog.locator('[data-permit-editor-id]').first(), ['М01', 'М05'])
  // A separate active M11 permit must never cover M01/M05, even when the
  // original permit is narrowed or archived.
  await dialog.getByRole('button', { name: 'Добавить НАКС', exact: true }).click()
  await fillPermit(dialog.locator('[data-permit-editor-id]').last(), ['М11'])
  await dialog.getByRole('button', { name: 'Добавить ДЛС', exact: true }).click()
  await dialog.getByLabel('Номер ДЛС', { exact: true }).fill('ДЛС-EPH1')
  await fillPermit(dialog.locator('[data-permit-editor-id]').last(), ['М01', 'М05'])
  const createButton = dialog.getByRole('button', { name: 'Добавить клеймо', exact: true })
  const primaryNaks = dialog.locator('[data-permit-editor-id]').first()
  const dlsEditor = dialog.locator('[data-permit-editor-id]').last()
  await primaryNaks.getByRole('button', { name: 'М05', exact: true }).click()
  await expect(createButton).toBeDisabled()
  await expect(dialog.getByText('ДЛС 1: допуск ДЛС РАД, М05 выходит за границы НАКС', { exact: true })).toBeVisible()
  await primaryNaks.getByRole('button', { name: 'М05', exact: true }).click()
  for (const [label, invalid, valid, reason] of [
    ['Диаметр до', '501', '500', 'диапазон диаметра'],
    ['Толщина до', '21', '20', 'диапазон толщины'],
    ['Срок до', '2027-01-01', '2026-12-31', 'срок действия'],
  ]) {
    await dlsEditor.getByLabel(label, { exact: true }).fill(invalid)
    await expect(createButton).toBeDisabled()
    await expect(dialog.getByText(new RegExp(`ДЛС 1: ${reason} ДЛС РАД, М01 не покрыт`))).toBeVisible()
    await dlsEditor.getByLabel(label, { exact: true }).fill(valid)
  }
  await dlsEditor.getByRole('button', { name: 'РД', exact: true }).click()
  await expect(createButton).toBeDisabled()
  await expect(dialog.getByText('ДЛС 1: допуск ДЛС РД, М01 выходит за границы НАКС', { exact: true })).toBeVisible()
  await dlsEditor.getByRole('button', { name: 'РД', exact: true }).click()
  await dialog.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  await expect(dialog).toBeHidden()
  const initial = await stamp()
  const permitIds = [initial.naks[0].id, initial.dls[0].id]
  const joints = await withE2eDatabase(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'HISTORY',line,'II','Б(а)',0,0 from unnest(array['H1','H2']) line`, [project])
    return (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      connection_type,material_group,welding_method,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,
      stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,has_vik)
      select p.id,$1,'HISTORY',p.line,v.joint,v.date::date,'С17','М01 + М05','РАД',v.d,v.d,6,8,'II','Б(а)',0,0,
        $2,$2,$2,$2,$2,$2,'да'
      from (values ('F971','H1','2026-07-01',108),('F972','H1','2026-08-01',108),('F973','H2','2026-07-01',57)) v(joint,line,date,d)
      join line_programs p on p.project_title=$1 and p.line=v.line returning id,joint`, [project, code])).rows
  })
  const facts = () => withE2eDatabase(async db => (await db.query(
    "select md5(string_agg((to_jsonb(w)-'final_status')::text,'' order by id)) hash from weld_joints w where project_title=$1", [project])).rows[0])
  const before = await facts()
  const [{ requireDb }, { markDispatcherTaskIndexDirty }, dispatcher, read] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'),
    import('../../src/server/dispatcher-task-index'), import('../../src/server/weld-read'),
  ])
  await markDispatcherTaskIndexDirty(requireDb())
  async function expectTasks(expected: string[]) {
    await dispatcher.ensureDispatcherTaskIndexFresh()
    const ids = await withE2eDatabase(async db => (await db.query(
      "select w.joint from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id where w.project_title=$1 and t.code='СП-02' order by w.joint", [project])).rows)
    expect(ids.map(row => row.joint)).toEqual(expected)
    const virtual = await read.attachDispatcherTaskCodesToPage(joints)
    expect(virtual.filter(row => String((row as { dispatcherTasks?: string }).dispatcherTasks).includes('СП-02'))
      .map(row => row.joint).sort()).toEqual(expected)
    expect(await facts()).toEqual(before)
  }
  await expectTasks([])
  const stale = await context.newPage()
  await stale.goto('/journal')
  await editJournalJoint(stale, 'F971')
  const weldDialog = stale.getByRole('dialog').filter({ has: stale.getByRole('heading', { name: 'Редактирование стыка' }) })
  await weldDialog.getByRole('textbox', { name: 'T2', exact: true }).fill('9')
  await expect(weldDialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()

  await page.getByText(code, { exact: true }).first().click()
  async function edit(change: (editor: Locator) => Promise<void>) {
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
    for (const id of permitIds) await change(dialog.locator(`[data-permit-editor-id="${id}"]`))
    await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  await edit(editor => editor.getByLabel('Диаметр до', { exact: true }).fill('100'))
  await expectTasks(['F971', 'F972'])
  // This tab still has the old options. The real server, not only the form,
  // must reject a changed qualification field using the current registry.
  const rejected = stale.waitForResponse(response => rpcName(response.url()).startsWith('updateWeldJoint_'))
  await weldDialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect(await (await rejected).text()).toContain('СП-02')
  await expect(weldDialog).toBeVisible()
  await expect(stale.getByText(/Сохранение невозможно:.*СП-02/).first()).toBeVisible()
  expect(await facts()).toEqual(before)
  await stale.close()

  await edit(async editor => {
    await editor.getByLabel('Диаметр до', { exact: true }).fill('500')
    await editor.getByLabel('Срок до', { exact: true }).fill('2026-06-30')
  })
  await expectTasks(['F971', 'F972', 'F973'])
  await edit(editor => editor.getByLabel('Срок до', { exact: true }).fill('2026-07-31'))
  await expectTasks(['F972'])
  await edit(editor => editor.getByRole('button', { name: 'В архив', exact: true }).click())
  // Archiving does not erase the historical July permits or make August valid.
  await expectTasks(['F972'])
  let stored = await stamp()
  expect(stored.naks[0].archived).toBe(true)
  expect(stored.dls[0].archived).toBe(true)
  await page.reload()
  await page.getByText(code, { exact: true }).first().click()
  await edit(async editor => {
    await editor.getByRole('button', { name: 'Из архива', exact: true }).click()
    await editor.getByLabel('Срок до', { exact: true }).fill('2026-12-31')
  })
  await expectTasks([])
  stored = await stamp()
  expect(stored.naks).toEqual(initial.naks)
  expect(stored.dls).toEqual(initial.dls)
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  const dls = dialog.locator(`[data-permit-editor-id="${permitIds[1]}"]`)
  await dls.getByLabel('Толщина до', { exact: true }).fill('7')
  await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expectTasks(['F971', 'F972', 'F973'])
  const cards = await withE2eDatabase(async db => (await db.query('select tasks from dispatcher_task_pages')).rows
    .flatMap(row => JSON.parse(row.tasks) as RepeatedJointTask[])
    .filter(task => joints.some(row => row.id === task.row.id) && getDispatcherTaskCode(task) === 'СП-02'))
  expect(JSON.stringify(cards)).toContain('ДЛС')
  expect(JSON.stringify(cards)).toContain('Материал 2: М05')
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await dls.getByLabel('Толщина до', { exact: true }).fill('20')
  await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expectTasks([])
})
