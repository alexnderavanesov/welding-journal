import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { seedSmoothnessFixture, cleanupSmoothnessFixture } from '../smoothness-fixture'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { editJournalJoint, journalRow } from '../journal-grid'

test('visual user walkthrough: every workspace at desktop and narrow widths', async ({ page }, info) => {
  test.skip(process.env.SYSTEMIC_USER_ACCEPTANCE !== '1', 'Explicit visual acceptance on an isolated populated fixture')
  test.setTimeout(300_000)
  const errors: string[] = [], observations: object[] = []
  page.on('pageerror', error => errors.push(error.message))
  const routes = [
    '/journal', '/lnk', '/psto', '/line-program', '/line-schemes', '/documents', '/statistics',
    '/references', '/references?tab=specialists', '/references?tab=technologyCards', '/settings',
    '/account?tab=profile', '/account?tab=users', '/activity', '/account?tab=rules&section=connections',
    '/account?tab=rules&section=checks', '/account?tab=guide',
  ]
  try {
    await seedSmoothnessFixture()
    for (const [index, route] of routes.entries()) {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await page.goto(route)
      const main = page.getByRole('main')
      await expect(main.locator('h1').first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      for (const grid of await main.locator('[aria-busy]').all()) await expect(grid).not.toHaveAttribute('aria-busy', 'true', { timeout: 60_000 })
      // This tour records the actual screen for review; functional workflows
      // have their own assertions and do not pass solely because a heading exists.
      for (const width of [1600, 900]) {
        await page.setViewportSize({ width, height: width === 900 ? 740 : 1000 })
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const geometry = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }))
        const headings = await main.locator('h1,h2').allTextContents()
        observations.push({ route, width, headings, geometry })
        await page.screenshot({ path: info.outputPath(`workspace-${String(index).padStart(2, '0')}-${width}.png`), animations: 'disabled' })
        expect.soft(geometry.documentWidth, `${route} must keep horizontal overflow inside its table`).toBeLessThanOrEqual(width + 1)
      }
    }
    expect(errors).toEqual([])
  } finally {
    await writeFile(info.outputPath('walkthrough.json'), JSON.stringify({ observations, errors }, null, 2))
    await page.close()
    await cleanupSmoothnessFixture()
  }
})

test('operator corrects a joint: cancellation, save, another report and reopening preserve the intended record', async ({ page }, info) => {
  const project = `E2E operator walkthrough ${randomUUID()}`
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const id = await withE2eDatabase(async db => (await db.query(`insert into weld_joints
    (project_title,subtitle_code,line,joint,connection_type,weld_date,officiality,revision_actuality,has_vik,psto_required,isometry)
    values($1,'WALK','WALK-LINE','F130013','С17','2026-10-01','действующий','актуальная','да','нет','ORIGINAL-ISO') returning id`, [project])).rows[0].id as number)
  const read = () => withE2eDatabase(async db => (await db.query('select isometry,xmin::text version from weld_joints where id=$1', [id])).rows[0])
  try {
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    await expect(journalRow(page, id)).toBeVisible()
    const original = await read()
    await editJournalJoint(page, id)
    const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    const isometry = editor.getByRole('textbox', { name: 'Изометрия', exact: true })
    await isometry.fill('ACCIDENTAL-CHANGE')
    await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(editor).toBeHidden()
    expect(await read()).toEqual(original)
    await editJournalJoint(page, id)
    await expect(isometry).toHaveValue('ORIGINAL-ISO')
    await isometry.fill('ISO-Коррекция-13')
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden()
    expect((await read()).isometry).toBe('ISO-Коррекция-13')
    await page.getByRole('button', { name: 'ЛНК', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    const row = page.locator('[data-weld-report-grid="lnk"] .ag-row').filter({ has: page.getByRole('button', { name: 'F130013', exact: true }) })
    await row.getByRole('button', { name: 'F130013', exact: true }).click()
    const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F130013', exact: true }) })
    await expect(picture).toBeVisible()
    for (const tab of ['Требует действия', 'Картина линии', 'Стык']) {
      await picture.getByRole('tab', { name: new RegExp(`^${tab}(?: ·|$)`) }).click()
      await expect(picture.getByRole('tabpanel')).toBeVisible()
    }
    await page.screenshot({ path: info.outputPath('operator-joint-picture.png'), animations: 'disabled' })
    await picture.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.getByRole('button', { name: 'Сварочный журнал', exact: true }).click()
    await page.reload()
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    await editJournalJoint(page, id)
    await expect(isometry).toHaveValue('ISO-Коррекция-13')
    await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
  }
})
