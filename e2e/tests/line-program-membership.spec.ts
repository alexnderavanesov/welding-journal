import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { createWeldJoint, updateWeldJoint, deleteWeldJoint } from '@/server/weld-mutations'
import { loadLineProgramPage, loadLineProgramSection, saveLineProgramInTransaction } from '@/server/line-program'
import { requireDb } from '@/db'
import { deleteJournalJoint } from '../journal-grid'
import pg from 'pg'

const project = 'E2E program membership'
const scope = { projectTitle: project, subtitleCode: 'MEMBERSHIP' }
const create = asE2eOwner(createWeldJoint, 'welding.edit')
const update = asE2eOwner(updateWeldJoint, 'welding.edit')
const remove = asE2eOwner(deleteWeldJoint, 'welding.delete')
const section = (tab: 'lines' | 'percentage' | 'full' | 'supports') => loadLineProgramSection({ tab, search: project.toLowerCase() })
const names = async (tab: Parameters<typeof section>[0]) => (await section(tab)).rows.map(row => row.line)
const version = (id: number) => withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [id])).rows[0].version as string)
test.afterEach(() => cleanupLineProgramProjects([project, ` ${project.toUpperCase()} `]))

async function seed() {
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,support_uzk_control_percent)
      select $1,$2,line,'II','Б(а)',20,20,100 from unnest(array['A','B','EMPTY','LEGACY','LATIN','HISTORY']) line`, [project, scope.subtitleCode])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type)
      select id,project_title,subtitle_code,line,'F1','С17' from line_programs where project_title=$1 and line='A'`, [project])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,officiality,revision_actuality)
      values($1,$2,' legacy ','ОП1',' т4 ',null,null),($3,$2,'LATIN','F1','T1',null,null),
        ($3,$2,'HISTORY','ОП1','Т1','неофициальный','неактуальная')`, [` ${project.toUpperCase()} `, scope.subtitleCode, project])
    await db.query(`update weld_joints set stamp_1_k='MEMBERSHIP-SUPPORT-STAMP' where project_title=$1 and line='HISTORY'`, [project])
  })
}

test('состав разделов обновляется после сохранений: 20↔100, первый/последний Т и перенос между линиями', async () => {
  await seed()
  // Warm all cached sections before exercising real mutation entry points.
  expect(await names('supports')).toEqual(['HISTORY', 'LEGACY'])
  expect(await names('full')).toEqual([])
  expect(await names('percentage')).toEqual(['A', 'B', 'EMPTY', 'HISTORY', 'LATIN', 'LEGACY'])
  expect(await names('lines')).toHaveLength(6)
  const joint = await create({ data: { ...scope, line: 'A', joint: 'ОП2', connectionType: 'Т1', d1: 57, t1: 6, weldLength: '600' } })
  expect(await names('supports')).toEqual(['A', 'HISTORY', 'LEGACY'])
  const support = (await section('supports')).rows.find(row => row.line === 'A')!
  expect(support.weldControlPercent).toBe(100) // independent support norm
  expect(await names('percentage')).toContain('A')
  const page = await loadLineProgramPage({ tab: 'supports', search: project.toLowerCase(), page: 0 })
  expect(page.total).toBe(3)
  expect(page.rows.map(row => row.line)).toEqual(['A', 'HISTORY', 'LEGACY'])
  expect((await loadLineProgramSection({ tab: 'supports', search: 'membership-support-stamp' })).rows.map(row => row.line)).toEqual(['HISTORY'])

  for (const percent of [100, 20]) {
    const line = (await section('lines')).rows.find(row => row.line === 'A')!
    await requireDb().transaction(tx => saveLineProgramInTransaction(tx, { ...line, weldControlPercent: percent }))
    expect((await names('full')).includes('A')).toBe(percent === 100)
    expect((await names('percentage')).includes('A')).toBe(percent < 100)
    expect(await names('supports')).toContain('A')
  }
  await update({ data: { id: joint.id, expectedVersion: await version(joint.id), ...scope, line: 'B' } })
  expect(await names('supports')).toEqual(['B', 'HISTORY', 'LEGACY'])
  expect((await loadLineProgramPage({ tab: 'supports', search: project.toLowerCase(), page: 0 })).rows.map(row => row.line)).toEqual(['B', 'HISTORY', 'LEGACY'])
  await remove({ data: { id: joint.id, version: await version(joint.id) } })
  expect(await names('supports')).toEqual(['HISTORY', 'LEGACY'])
  expect(await names('lines')).toHaveLength(6)
  // A Latin T is not the Cyrillic support family, even when search matches.
  expect((await loadLineProgramSection({ tab: 'supports', search: 'membership' })).rows.every(row => row.line !== 'LATIN')).toBe(true)
})

async function chooseTab(page: Page, name: string, expected: number) {
  const program = page.getByTestId('line-program')
  await program.getByRole('button', { name, exact: true }).click()
  await expect(program.getByLabel('Итоги раздела').getByRole('button', { name: `Линий ${expected}`, exact: true })).toBeVisible()
  await expect(program.getByTestId('line-program-card')).toHaveCount(expected)
}

test('ранний отбор Опор не загружает стыки двухсот посторонних линий', async () => {
  await seed()
  await withLineProgramFixture(async db => {
    await db.query(`update line_programs set category=null,weld_control_percent=null where project_title=$1 and line='HISTORY'`, [project])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,$2,'ORDINARY-'||n,'II','Б(а)',20,20 from generate_series(1,200) n`, [project, scope.subtitleCode])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type)
      select id,project_title,subtitle_code,line,'F'||n,'С17' from line_programs cross join generate_series(1,10) n
      where project_title=$1 and line like 'ORDINARY-%'`, [project])
  })
  let wideReads = 0, wideRows = 0
  const original = pg.Client.prototype.query
  pg.Client.prototype.query = function (this: pg.Client, ...args: Parameters<typeof original>) {
    const text = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? ''
    const result: unknown = Reflect.apply(original, this, args)
    if (/select/i.test(text) && text.includes('"weld_joints"."joint"') && text.includes('join "line_programs"')) {
      wideReads++
      return (result as Promise<pg.QueryResult>).then(value => { wideRows += value.rowCount ?? 0; return value })
    }
    return result
  } as typeof original
  try {
    const rows = (await section('supports')).rows
    expect(rows.map(row => row.line)).toEqual(['HISTORY', 'LEGACY'])
    expect(rows.find(row => row.line === 'HISTORY')?.configurationIssue).toBeTruthy()
    expect(wideReads).toBe(1)
    expect(wideRows).toBe(2)
    expect(await names('supports')).toEqual(['HISTORY', 'LEGACY'])
    expect(wideReads).toBe(1) // warm section adds no full joint reads
  } finally { pg.Client.prototype.query = original }
})

test('UI: сохранение нормы обновляет ранее открытые вкладки в обе стороны', async ({ page }) => {
  await seed()
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(project)
  await chooseTab(page, 'Все линии', 6)
  await chooseTab(page, '100%-ные линии', 0)
  await chooseTab(page, 'Процентные линии', 6)
  await chooseTab(page, 'Опоры', 2)
  for (const percent of [100, 20]) {
    await chooseTab(page, 'Все линии', 6)
    const card = program.getByTestId('line-program-card').filter({ has: page.getByTestId('line-name').filter({ hasText: /^A$/ }) })
    await card.getByRole('button', { name: 'Настроить', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Настройка линии', exact: true })
    await editor.getByLabel('Базовый % контроля', { exact: true }).fill(String(percent))
    await editor.getByRole('button', { name: 'Сохранить программу', exact: true }).click()
    await expect(editor).toBeHidden()
    // Saving reveals the edited line by name; restore the common search.
    await program.getByLabel('Поиск программы линий').fill(project)
    await chooseTab(page, '100%-ные линии', percent === 100 ? 1 : 0)
    await chooseTab(page, 'Процентные линии', percent === 100 ? 5 : 6)
    await chooseTab(page, 'Опоры', 2)
    await chooseTab(page, 'Все линии', 6)
  }
})

test('UI: создание первого и удаление последнего Т обновляют уже открытые Опоры без перезагрузки', async ({ page }) => {
  await seed()
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  const navigation = page.getByRole('navigation', { name: 'Разделы программы' })
  await program.getByLabel('Поиск программы линий').fill(project)
  await chooseTab(page, 'Опоры', 2)
  await navigation.getByRole('button', { name: 'Сварочный журнал', exact: true }).click()
  await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('textbox', { name: 'Линия', exact: true }).fill('A')
  await editor.getByRole('button', { name: `A Проект: ${project} · Шифр: ${scope.subtitleCode}`, exact: true }).click()
  await editor.getByRole('textbox', { name: 'Стык', exact: true }).fill('ОП-UI')
  await editor.getByRole('combobox', { name: 'Тип соединения', exact: true }).selectOption('Т1')
  for (const [label, value] of [['D1', '57'], ['T1', '6'], ['Длина шва, мм', '600']]) await editor.getByLabel(label, { exact: true }).fill(value)
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  const id = await withE2eDatabase(async db => (await db.query('select id from weld_joints where project_title=$1 and joint=$2', [project, 'ОП-UI'])).rows[0].id as number)
  await navigation.getByRole('button', { name: 'Программа линий', exact: true }).click()
  await program.getByLabel('Поиск программы линий').fill(project)
  await chooseTab(page, 'Опоры', 3)
  await expect(program.locator('[data-testid="line-program-card"][data-line="A"]')).toBeVisible()
  await navigation.getByRole('button', { name: 'Сварочный журнал', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('ОП-UI')
  await deleteJournalJoint(page, id)
  const confirmation = page.locator('[data-confirm-action-dialog="true"]').locator('..')
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(confirmation).toBeHidden()
  await navigation.getByRole('button', { name: 'Программа линий', exact: true }).click()
  // Navigation remounts the page; keep this fixture scoped even when other
  // tests have left valid unrelated lines in the shared disposable database.
  await program.getByLabel('Поиск программы линий').fill(project)
  await chooseTab(page, 'Опоры', 2)
  await expect(program.locator('[data-testid="line-program-card"][data-line="A"]')).toHaveCount(0)
  await chooseTab(page, 'Все линии', 6)
})
