import { selectStatisticsProjects } from '../statistics-filters'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { resizeFilterPopup } from '../filter-popup'

const project = 'E2E subtitle dropdown', otherProject = `E2E other subtitle dropdown ${'A'.repeat(160)}`

test('subtitle dropdown keeps a compact header, multiple choices, search and project reset', async ({ page }, info) => {
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  try {
    await withE2eDatabase(async db => {
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,stamp_1_k_fact,wdi)
        select $1,'CODE-'||lpad(n::text,3,'0'),'L'||n,'F1','2026-09-01','С17','W'||lpad(n::text,3,'0'),'10'
        from generate_series(1,80) n`, [project])
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,stamp_1_k_fact,wdi)
        values($1,'OTHER-CODE','OTHER','F1','2026-09-01','С17','OTHER-W','10')`, [otherProject])
      await db.query('delete from derived_calculation_cache')
      await db.query('update derived_calculation_state set source_revision=source_revision+1,updated_at=now() where id=1')
    })
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Сварщики', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    const period = page.getByRole('combobox', { name: 'Период отчета', exact: true })
    const trigger = page.getByRole('button', { name: /^Шифр / })
    const projectTrigger = page.getByRole('button', { name: /^Проект / })
    const settings = page.getByRole('group', { name: 'Параметры статистики' })
    const projectBox = (await projectTrigger.boundingBox())!
    const codeBox = (await trigger.boundingBox())!
    const settingsBox = (await settings.boundingBox())!
    for (const field of [period, trigger, settings.getByRole('group', { name: 'Единица', exact: true }), settings.getByRole('group', { name: 'Тип стыка', exact: true })]) {
      const box = (await field.boundingBox())!
      expect(box.y).toBeCloseTo(projectBox.y, 0)
      expect(box.height).toBe(projectBox.height)
    }
    const periodLabel = (await settings.getByText('Период', { exact: true }).boundingBox())!
    for (const label of ['Единица', 'Тип стыка', 'Проект', 'Шифр']) {
      const box = (await settings.getByText(label, { exact: true }).boundingBox())!
      expect(box.y).toBeCloseTo(periodLabel.y, 0)
      expect(box.height).toBe(periodLabel.height)
    }
    expect(codeBox.x).toBeGreaterThan(projectBox.x + projectBox.width)
    expect(codeBox.width).toBeCloseTo(projectBox.width, 0)
    expect(codeBox.x + codeBox.width).toBeCloseTo(settingsBox.x + settingsBox.width, 0)
    await selectStatisticsProjects(page, project)
    await period.selectOption('custom')
    await page.getByLabel('Период с', { exact: true }).fill('2026-09-01')
    await page.getByLabel('Период по', { exact: true }).fill('2026-09-30')
    const grid = page.locator('[data-statistics-grid="welders"]')
    await expect(grid.getByText('W001', { exact: true })).toBeVisible()
    expect((await trigger.boundingBox())!.height).toBe(36)
    await trigger.click()
    const dropdown = page.getByRole('dialog', { name: 'Шифр', exact: true })
    const search = dropdown.getByRole('searchbox', { name: 'Найти шифр' })
    await expect(dropdown.getByRole('checkbox')).toHaveCount(80)
    expect((await dropdown.boundingBox())!.height).toBeLessThan(350)
    await resizeFilterPopup(page, dropdown)
    const beforeSearch = calls.filter(name => name.startsWith('getStatisticsServerResult')).length
    await search.fill('code-080')
    await expect(dropdown.getByRole('checkbox')).toHaveCount(1)
    expect(calls.filter(name => name.startsWith('getStatisticsServerResult')).length).toBe(beforeSearch)
    await dropdown.getByRole('checkbox', { name: 'CODE-080', exact: true }).check()
    await search.fill('code-001')
    await dropdown.getByRole('checkbox', { name: 'CODE-001', exact: true }).check()
    await expect(trigger).toContainText('Выбрано шифров: 2')
    await expect(grid.getByText('W080', { exact: true })).toBeVisible()
    await expect(grid.getByText('W001', { exact: true })).toBeVisible()
    await expect(grid.getByText('W002', { exact: true })).toHaveCount(0)
    await search.fill('nothing-matches')
    await expect(dropdown).toContainText('Шифры не найдены')
    await expect(dropdown).toContainText('Выбрано: 2')
    await page.keyboard.press('Escape')
    await expect(dropdown).toHaveCount(0); await expect(trigger).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(search).toBeFocused()
    await expect(dropdown.getByRole('checkbox', { name: 'CODE-001', exact: true })).toBeChecked()
    await expect(dropdown.getByRole('checkbox', { name: 'CODE-080', exact: true })).toBeChecked()
    await dropdown.getByRole('checkbox', { name: 'CODE-080', exact: true }).uncheck()
    await expect(trigger).toContainText('CODE-001')
    await expect(grid.getByText('W080', { exact: true })).toHaveCount(0)
    await dropdown.getByRole('button', { name: 'Сбросить шифры', exact: true }).click()
    await expect(trigger).toContainText('Все шифры')
    await expect(dropdown.getByRole('checkbox', { name: 'CODE-001', exact: true })).not.toBeChecked()
    await page.screenshot({ path: info.outputPath('subtitle-dropdown.png') })
    await page.setViewportSize({ width: 900, height: 740 })
    await expect(dropdown).toHaveCount(0)
    expect((await trigger.boundingBox())!.y).toBeGreaterThan((await period.boundingBox())!.y)
    await expect(trigger).toBeInViewport()
    await trigger.click()
    const compactBounds = (await dropdown.boundingBox())!
    expect(compactBounds.y).toBeGreaterThanOrEqual(0)
    expect(compactBounds.y + compactBounds.height).toBeLessThanOrEqual(740)
    await expect(dropdown.getByRole('button', { name: 'Сбросить шифры', exact: true })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('subtitle-dropdown-many-compact.png') })
    await dropdown.getByRole('checkbox', { name: 'CODE-001', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(dropdown).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await selectStatisticsProjects(page, otherProject)
    await expect(grid.getByText('OTHER-W', { exact: true })).toBeVisible()
    await expect(trigger).toContainText('Все шифры')
    const scrollBeforeOpen = await page.evaluate(() => scrollY)
    await trigger.click(); await expect(dropdown.getByRole('checkbox')).toHaveCount(1)
    await expect(search).toBeFocused()
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrollBeforeOpen)
    await expect(dropdown.getByRole('checkbox', { name: 'OTHER-CODE', exact: true })).not.toBeChecked()
    await page.getByRole('heading', { name: 'Статистика', exact: true }).click()
    await expect(dropdown).toHaveCount(0)
    await page.setViewportSize({ width: 900, height: 740 })
    await trigger.click()
    expect(await dropdown.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath('subtitle-dropdown-compact.png') })
    await page.keyboard.press('Escape')
    await selectStatisticsProjects(page, project, otherProject)
    await expect(page.getByRole('button', { name: 'Проект Выбрано проектов: 2' })).toBeVisible()
    await expect(page.getByText('Сварщиков в срезе', { exact: true }).locator('..')).toHaveText(/Сварщиков в срезе\s*81/)
    await trigger.click()
    await expect(dropdown.getByRole('checkbox')).toHaveCount(81)
    for (const code of ['OTHER-CODE', 'CODE-001']) await dropdown.getByRole('checkbox', { name: code, exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Сварщиков в срезе', { exact: true }).locator('..')).toHaveText(/Сварщиков в срезе\s*2$/)
    await expect(grid.getByText('OTHER-W', { exact: true })).toBeVisible()
    await expect(grid.getByText('W001', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Полинейная сводка', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Проект Все проекты' })).toBeVisible()
    await selectStatisticsProjects(page, project, otherProject)
    const lineBadge = page.getByText('Линий всего', { exact: true }).locator('..')
    await expect(lineBadge).toContainText('81')
    const toolbar = page.locator('[data-statistics-toolbar]')
    await expect(toolbar.getByText('Срез', { exact: true })).toHaveCount(0)
    await expect(toolbar).not.toContainText(otherProject)
    expect(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    const scope = preview.frameLocator('iframe').locator('.meta-item').filter({ hasText: /^Срез:/ })
    await expect(scope).toContainText('проекты')
    await expect(scope).toContainText(project)
    await expect(scope).toContainText(otherProject)
    expect(await scope.evaluate(el => el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 1
      && el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    await selectStatisticsProjects(page, otherProject)
    await expect(lineBadge).toHaveText(/Линий всего\s*1\D*$/)
    await expect(page.locator('[data-statistics-grid="lines"]').getByText('OTHER', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Сварщики', exact: true }).click()
    await expect(trigger).toContainText('Выбрано шифров: 2')
    await expect(page.getByText('Сварщиков в срезе', { exact: true }).locator('..')).toHaveText(/Сварщиков в срезе\s*2$/)
    await page.setViewportSize({ width: 420, height: 800 })
    const narrowProject = (await projectTrigger.boundingBox())!
    const narrowCode = (await trigger.boundingBox())!
    expect(narrowCode.y).toBeGreaterThanOrEqual(narrowProject.y + narrowProject.height)
    expect(narrowCode.x).toBeCloseTo(narrowProject.x, 0)
    expect(narrowCode.width).toBeCloseTo(narrowProject.width, 0)
    expect(narrowCode.x + narrowCode.width).toBeLessThanOrEqual(420)
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project, otherProject])
  }
})
