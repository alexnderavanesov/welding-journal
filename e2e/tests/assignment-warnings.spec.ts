import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { withE2eDatabase } from '../database'

const project = 'E2E assignment warnings', line = 'WARNING-LINE'
const key = 'assignment-warnings'
const configuration = { uzk: { enabled: true, thresholds: { С: 8, У: 8, Т: null }, text: 'Проверить назначение УЗК' }, rk: { enabled: true, text: 'Проверить РК на У' } }
let previous: { value: string; updated_at: Date } | undefined
test.beforeEach(async () => {
  await withLineProgramFixture(async db => {
    previous = (await db.query('select value, updated_at from app_settings where key=$1', [key])).rows[0]
    await db.query('insert into app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()', [key, JSON.stringify(configuration)])
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'WARNING',$2,'II','A',100,10) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,stamp_1_k,has_vik,vik_result,d1)
      select $1,$2,'WARNING',$3,'F871'||n,'2026-09-01','действующий','актуальная',
        case when n=2 then 'У19' else 'С17' end,'WARNING-A','да','годен',case when n=1 then 6 else 100 end
      from generate_series(1,3) n`, [program.id, project, line])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    if (previous) await db.query('update app_settings set value=$2,updated_at=$3 where key=$1', [key, previous.value, previous.updated_at])
    else await db.query('delete from app_settings where key=$1', [key])
  })
})
const warning = (page: Page) => page.getByRole('dialog', { name: 'Подтвердить назначение контроля', exact: true })

test('administrator rights include the separate warning-settings checkboxes', async ({ page }) => {
  const id = 'e2e-warning-administrator'
  await withLineProgramFixture(db => db.query(`insert into auth_users(id,name,email,role,status,permissions)
    values($1,'Администратор предупреждений','warnings-admin@e2e.test','admin','active','[]')`, [id]))
  try {
    await page.goto('/account?tab=users')
    await page.getByRole('grid', { name: 'Пользователи и права', exact: true }).locator(`.ag-row[row-id="${id}"]`).getByRole('button', { name: 'Настроить права', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройка прав: Администратор предупреждений', exact: true })
    await expect(dialog.getByRole('checkbox', { name: 'Предупреждения: Просмотр', exact: true })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'Предупреждения: Изменение', exact: true })).toBeChecked()
  } finally { await withLineProgramFixture(db => db.query('delete from auth_users where id=$1', [id])) }
})

test('warning settings persist and stale edits cannot overwrite another user', async ({ page }, info) => {
  await page.goto('/settings#rules-warnings')
  await expect(page.getByRole('tab', { name: /Предупреждения/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Порог Д мин для С', { exact: true })).toHaveValue('8')
  await expect(page.getByLabel('Порог Д мин для У', { exact: true })).toHaveValue('8')
  await expect(page.getByLabel('Порог Д мин для Т', { exact: true })).toBeEmpty()
  await page.getByLabel('Порог Д мин для С', { exact: true }).fill('9.5')
  await page.getByLabel('Текст предупреждения УЗК', { exact: true }).fill('Проверка нового текста')
  await page.getByRole('checkbox', { name: 'РК на угловом стыке (У)', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Сохранить предупреждения', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Изменения сохранены.')
  await withE2eDatabase(async db => {
    const { rows } = await db.query(`select o.area from audit_changes c join audit_operations o on o.id=c.operation_id
      where c.entity='app_settings' and c.entity_id=$1 order by c.id desc limit 1`, [key])
    expect(rows[0]?.area).toBe('assignmentWarnings')
  })
  await page.reload()
  await expect(page.getByLabel('Порог Д мин для С', { exact: true })).toHaveValue('9.5')
  await expect(page.getByLabel('Текст предупреждения УЗК', { exact: true })).toHaveValue('Проверка нового текста')
  await expect(page.getByRole('checkbox', { name: 'РК на угловом стыке (У)', exact: true })).not.toBeChecked()
  await page.screenshot({ path: info.outputPath('assignment-warning-settings.png') })
  await page.getByLabel('Порог Д мин для С', { exact: true }).fill('11')
  await withLineProgramFixture(db => db.query(`update app_settings set value=$2, updated_at=updated_at+interval '1 second' where key=$1`, [key, JSON.stringify(configuration)]))
  await page.getByRole('button', { name: 'Сохранить предупреждения', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('изменена другим пользователем')
  await withE2eDatabase(async db => expect(JSON.parse((await db.query('select value from app_settings where key=$1', [key])).rows[0].value)).toEqual(configuration))
})

test('card confirmation keeps the editor open and does not repeat for an accepted assignment', async ({ page }) => {
  await page.goto('/journal')
  await editJournalJoint(page, 'F8711')
  const card = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  await card.getByRole('button', { name: 'Назначение контроля', exact: true }).click()
  const uzk = card.getByText('Назначение УЗК', { exact: true }).locator('..')
  await uzk.getByRole('button', { name: 'Да', exact: true }).click()
  await expect(warning(page)).toContainText('6 мм ≤ 8 мм')
  await warning(page).getByRole('button', { name: 'Нет, оставить пусто', exact: true }).click()
  await expect(card).toBeVisible()
  await expect(uzk.getByRole('button', { name: 'Пусто', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await uzk.getByRole('button', { name: 'Дополнительный', exact: true }).click()
  await warning(page).getByRole('button', { name: 'Да, назначить', exact: true }).click()
  await uzk.getByRole('button', { name: 'Да', exact: true }).click()
  await expect(warning(page)).toHaveCount(0)
  await expect(uzk.getByRole('button', { name: 'Да', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await withE2eDatabase(async db => expect((await db.query('select has_uzk from weld_joints where project_title=$1', [project])).rows.every(row => row.has_uzk === null)).toBe(true))
})

test('mixed bulk assignment asks once, clears only warned values, and saves accepted changes', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1050 })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(line)
  await page.getByTestId('line-program-card').getByRole('button', { name: 'Учитываемых соединений 3', exact: true }).click()
  await page.getByTestId('line-program-detail').getByTestId('program-scope-actions').getByRole('button', { name: /^Назначения/ }).click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  for (const name of ['F8711', 'F8713']) await editor.getByRole('checkbox', { name: `Выбрать ${name}`, exact: true }).check()
  await editor.getByTestId('program-method-toolbar').getByRole('button', { name: 'УЗК', exact: true }).click()
  await editor.getByRole('button', { name: 'Применить к выбранным (2)', exact: true }).click()
  await expect(warning(page)).toContainText('Стыков: 1')
  await warning(page).getByRole('button', { name: 'Нет, оставить пусто', exact: true }).click()
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('combobox', { name: 'F8711 · УЗК', exact: true })).toHaveValue('')
  await expect(editor.getByRole('combobox', { name: 'F8713 · УЗК', exact: true })).toHaveValue('да')
  await editor.getByRole('combobox', { name: 'F8711 · УЗК', exact: true }).selectOption('да')
  await warning(page).getByRole('button', { name: 'Да, назначить', exact: true }).click()
  await editor.getByRole('combobox', { name: 'F8712 · РК', exact: true }).selectOption('да')
  await expect(warning(page)).toContainText('Проверить РК на У')
  await warning(page).press('Escape')
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('combobox', { name: 'F8712 · РК', exact: true })).toHaveValue('')
  await editor.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  await expect(editor).toContainText('Назначения сохранены')
  await withE2eDatabase(async db => {
    expect((await db.query('select joint,has_uzk,has_rk from weld_joints where project_title=$1 order by joint', [project])).rows).toEqual([
      { joint: 'F8711', has_uzk: 'да', has_rk: null }, { joint: 'F8712', has_uzk: null, has_rk: null }, { joint: 'F8713', has_uzk: 'да', has_rk: null },
    ])
  })
})
