import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'

const project = 'E2E выбор линии'
const name = 'E2E-LINE-METADATA'

test.afterEach(async () => {
  await cleanupLineProgramProjects([project, `${project} другой`])
  await withLineProgramFixture(db => db.query("delete from line_programs where project_title='' and subtitle_code='' and line=$1", [name]))
})

test('выбор линии переносит её проект и свойства, различает одноимённые линии и сохраняет правильную связь', async ({ page }) => {
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent)
      values ($1,'A',$2,'II','Б(а)',30,10), ($1,'B',$2,'III','Б(б)',0,0), ($3,'A',$2,'IV','В',100,20), ('','',$2,null,null,null,null)`, [project, name, `${project} другой`])
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
  const editor = page.getByRole('dialog')
  const field = (label: string) => editor.getByRole('textbox', { name: label, exact: true })
  const line = field('Линия')
  await field('Изометрия').fill('ISO-KEEP')
  await line.fill(name)
  const choose = async (context: string) => {
    await line.click()
    await editor.getByRole('button', { name: `${name} ${context}`, exact: true }).click()
  }
  await choose(`Проект: ${project} · Шифр: A`)
  await expect(field('Проект')).toHaveValue(project)
  await expect(field('Шифр')).toHaveValue('A')
  await expect(field('Группа трубопровода')).toHaveValue('Б(а)')
  await expect(field('Категория трубопровода')).toHaveValue('II')
  await expect(field('Контроль швов, (%)')).toHaveValue('30')
  await expect(editor.getByText(/Программа линии: базовый 30%, ПВК 10%/)).toBeVisible()
  await expect(field('Изометрия')).toHaveValue('ISO-KEEP')
  for (const label of ['Группа трубопровода', 'Категория трубопровода', 'Контроль швов, (%)']) {
    await expect(field(label)).toHaveAttribute('readonly')
  }
  await choose(`Проект: ${project} · Шифр: B`)
  await expect(field('Шифр')).toHaveValue('B')
  await expect(field('Группа трубопровода')).toHaveValue('Б(б)')
  await expect(field('Категория трубопровода')).toHaveValue('III')
  await expect(field('Контроль швов, (%)')).toHaveValue('0')
  await expect(editor.getByText(/Программа линии: базовый 0%, ПВК 0%/)).toBeVisible()

  await choose('Проект: не указан · Шифр: не указан')
  await expect(field('Проект')).toHaveValue('')
  await expect(field('Шифр')).toHaveValue('')
  await expect(field('Группа трубопровода')).toHaveValue('')
  await expect(field('Категория трубопровода')).toHaveValue('')
  await expect(field('Контроль швов, (%)')).toHaveValue('')
  await expect(editor.getByText(/СП-01: не настроены/)).toBeVisible()

  await choose(`Проект: ${project} · Шифр: A`)
  await expect(field('Контроль швов, (%)')).toHaveValue('30')
  await line.fill('')
  await expect(field('Группа трубопровода')).toHaveValue('')
  await expect(field('Категория трубопровода')).toHaveValue('')
  await expect(field('Контроль швов, (%)')).toHaveValue('')

  await line.fill(name)
  await choose(`Проект: ${project} · Шифр: A`)
  await expect(field('Контроль швов, (%)')).toHaveValue('30')
  await field('Стык').fill('F991')
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  await withE2eDatabase(async db => {
    const { rows } = await db.query(`select w.project_title,w.subtitle_code,w.category,w.group_name,w.weld_control_percent::float,
      w.pvk_control_percent::float,w.isometry,p.line from weld_joints w join line_programs p on p.id=w.line_program_id
      where w.project_title=$1 and w.joint='F991'`, [project])
    expect(rows).toEqual([{ project_title: project, subtitle_code: 'A', category: 'II', group_name: 'Б(а)',
      weld_control_percent: 30, pvk_control_percent: 10, isometry: 'ISO-KEEP', line: name }])
  })
  await editJournalJoint(page, 'F991')
  await line.click()
  await expect(editor.getByRole('button', { name: `${name} Проект: ${project} · Шифр: A`, exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: new RegExp(`${name} Проект:`) })).toHaveCount(1)
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(errors).toEqual([])
})
