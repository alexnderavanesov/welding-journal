import { expect, test } from '@playwright/test'
import { FIELD_BY_KEY } from '../../src/lib/weld-fields'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint, journalRow } from '../journal-grid'

const project = 'E2E stored missing stamp display'
const fields = ['stamp1K', 'stamp1Z', 'stamp1O', 'stamp2K', 'stamp2Z', 'stamp2O',
  'stamp1KFact', 'stamp1ZFact', 'stamp1OFact', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'] as const
const columns = ['stamp_1_k', 'stamp_1_z', 'stamp_1_o', 'stamp_2_k', 'stamp_2_z', 'stamp_2_o',
  'stamp_1_k_fact', 'stamp_1_z_fact', 'stamp_1_o_fact', 'stamp_2_k_fact', 'stamp_2_z_fact', 'stamp_2_o_fact']

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map(page => page.close()))
  await cleanupLineProgramProjects([project])
})

test('all 12 fields show missing stored stamps; explicit clearing persists and reopening shows empty values', async ({ page }) => {
  const id = await withLineProgramFixture(async db => (await db.query<{ id: number }>(`
    insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,welding_method,material_group,
      d1,d2,t1,t2,officiality,revision_actuality,${columns.join(',')})
    values($1,'MISSING','MISSING','F97001','С17','РД','М01',108,108,6,6,'действующий','актуальная',
      ${columns.map(() => '$2').join(',')}) returning id`, [project, 'OLD-MISSING'])).rows[0].id)
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(journalRow(page, id)).toBeVisible()
  await editJournalJoint(page, id)
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  for (const field of fields) {
    const label = FIELD_BY_KEY.get(field)!.label
    const select = editor.getByRole('combobox', { name: label, exact: true })
    await expect(select).toHaveValue('OLD-MISSING')
    await expect(select.locator('option:checked')).toContainText('OLD-MISSING')
    await select.click()
    const list = editor.getByRole('listbox')
    await expect(list.getByRole('option', { name: /OLD-MISSING/ })).toHaveAttribute('aria-disabled', 'true')
    await list.getByRole('option', { name: 'Пусто', exact: true }).click()
    await expect(select).toHaveValue('')
  }
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  const stored = await withE2eDatabase(async db => (await db.query(`select ${columns.join(',')} from weld_joints where id=$1`, [id])).rows[0])
  expect(Object.values(stored)).toEqual(columns.map(() => null))
  await page.reload()
  await editJournalJoint(page, id)
  for (const field of fields) await expect(editor.getByRole('combobox', { name: FIELD_BY_KEY.get(field)!.label, exact: true })).toHaveValue('')
})
