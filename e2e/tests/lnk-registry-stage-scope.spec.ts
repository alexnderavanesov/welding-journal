import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E registry stage scope'
test.afterEach(() => cleanupLineProgramProjects([project]))
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    for (const [joint, primary, pre] of [['F801', true, false], ['F802', false, true], ['F803', true, true]] as const) {
      const row = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,
        officiality,revision_actuality,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date)
        values ($1,'SCOPE','SCOPE-L1',$2,'2026-09-01','С17','да','действующий','актуальная',
          $3,case when $3::text is not null then date '2026-09-02' end,$4,$5,
          case when $5::text is not null then date '2026-09-03' end) returning id`,
      [project, joint, primary ? `MAIN-R-${joint}` : null, primary ? 'годен' : null, primary ? `MAIN-C-${joint}` : null])).rows[0]
      if (pre) await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
        values ($1,'ВИК',$2,'2026-09-01','годен',$3,'2026-09-02')`, [row.id, `PRE-R-${joint}`, `PRE-C-${joint}`])
    }
  })
})

for (const selected of [false, true]) test(`переключение реестра сохраняет область: ${selected ? 'выбранный стык' : 'все, включая историю только до ТО'}`, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F803')
  await page.getByRole('button', { name: 'Выбрать стык F803', exact: true }).click()
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: selected ? 'Редактировать выбранные' : 'Все результаты ЛНК', exact: true }).click()
  let dialog = page.getByRole('dialog')
  // Wait for real primary results to load. Switching sooner previously hid
  // the defect by accidentally taking the old report rows as the new scope.
  await expect(dialog.getByText('MAIN-C-F803', { exact: true }).first()).toBeVisible()
  if (!selected) await expect(dialog.getByText('MAIN-C-F801', { exact: true }).first()).toBeVisible()
  await dialog.getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'До ТО', exact: true }).click()
  dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК до ТО', exact: true }) })
  await expect(dialog.getByText('PRE-C-F803', { exact: true }).first()).toBeVisible()
  if (selected) await expect(dialog.getByText('PRE-C-F802', { exact: true })).toHaveCount(0)
  else await expect(dialog.getByText('PRE-C-F802', { exact: true }).first()).toBeVisible()
  await dialog.getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'Основной', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('MAIN-C-F803', { exact: true }).first()).toBeVisible()
  if (selected) await expect(page.getByRole('dialog').getByText('MAIN-C-F801', { exact: true })).toHaveCount(0)
  else await expect(page.getByRole('dialog').getByText('MAIN-C-F801', { exact: true }).first()).toBeVisible()
  expect(errors).toEqual([])
})
