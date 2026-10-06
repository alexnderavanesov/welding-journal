import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

test.afterEach(() => cleanupLineProgramProjects(['Rename Project', 'Renamed Project']))

test('переименование сохраняет историю и решения: постоянное число SQL для 1 и 2000 стыков', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-line-program-rename.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  const result = JSON.parse(stdout.trim())
  expect(result).toMatchObject({ rows: [1, 2000], preservedHistory: true, conflictsAndStaleVersions: true })
  expect(result.queries[0]).toBe(result.queries[1])
  expect(result.queries[0]).toBeLessThanOrEqual(15)
})

test('вся линия: редактирование трёх полей, отмена, сохранение, конфликт и устаревшее окно', async ({ page }) => {
  const id = await withE2eDatabase(async (client) => {
    const { rows: [line] } = await client.query("insert into line_programs (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent) values ('Rename Project', 'OLD', 'RENAME-LINE', 'II', 'A', 10, 10) returning id")
    await client.query(`insert into weld_joints (line_program_id, project_title, subtitle_code, line, joint, has_vik, category, group_name, weld_control_percent, pvk_control_percent, isometry, rk_result, rk_conclusion)
      select $1, 'Rename Project', 'OLD', 'RENAME-LINE', joint, 'да', 'II', 'A', 10, 10, 'ISO-' || joint, 'ремонт', 'KEEP-DOC' from unnest(array['F1','F1R1','F1W1','F1W2']) joint`, [line.id])
    await client.query("insert into line_programs (project_title, subtitle_code, line) values ('Renamed Project', 'NEW', 'OCCUPIED-RENAME')")
    return line.id as number
  })
  await page.goto('/percentage-lines')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill('RENAME-LINE')
  await expect(program.getByTestId('line-program-card')).toHaveCount(1)
  await program.getByRole('button', { name: 'Настроить', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Настройка линии', exact: true })
  await editor.getByLabel('Проект', { exact: true }).fill('Renamed Project')
  await editor.getByLabel('Шифр', { exact: true }).fill('NEW')
  await editor.getByLabel('Линия', { exact: true }).fill('RENAMED-LINE')
  await editor.screenshot({ path: 'outputs/line-program-rename-20260927.png' })
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Изменить данные всей линии?' }) })
  await expect(confirm).toContainText('Результаты, назначения и связи с документами сохранятся')
  await confirm.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(editor.getByLabel('Линия', { exact: true })).toHaveValue('RENAMED-LINE')
  expect(await withE2eDatabase(async (client) => (await client.query('select line from line_programs where id=$1', [id])).rows[0].line)).toBe('RENAME-LINE')
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await confirm.getByRole('button', { name: 'Изменить всю линию', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(program.getByLabel('Поиск программы линий')).toHaveValue('RENAMED-LINE')
  await expect(program.getByTestId('line-program-card')).toContainText('Renamed Project')
  const rows = await withE2eDatabase(async (client) => (await client.query('select project_title, subtitle_code, line, joint, isometry, rk_result, rk_conclusion from weld_joints where line_program_id=$1 order by id', [id])).rows)
  expect(rows).toHaveLength(4)
  for (const row of rows) expect(row).toMatchObject({ project_title: 'Renamed Project', subtitle_code: 'NEW', line: 'RENAMED-LINE', isometry: `ISO-${row.joint}`, rk_result: 'ремонт', rk_conclusion: 'KEEP-DOC' })
  await program.getByRole('button', { name: 'Настроить', exact: true }).click()
  await editor.getByLabel('Линия', { exact: true }).fill('OCCUPIED-RENAME')
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await confirm.getByRole('button', { name: 'Изменить всю линию', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('уже существует')
  await withE2eDatabase(async (client) => { await client.query('update line_programs set updated_at=clock_timestamp() where id=$1', [id]) })
  await editor.getByLabel('Линия', { exact: true }).fill('ANOTHER-LINE')
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await confirm.getByRole('button', { name: 'Изменить всю линию', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('другим пользователем')
  expect(await withE2eDatabase(async (client) => (await client.query('select distinct line from weld_joints where line_program_id=$1', [id])).rows)).toEqual([{ line: 'RENAMED-LINE' }])
})
