import { filterSchemeProject } from '../line-scheme-grid'
import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withE2eDatabase } from '../database'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'

const trackProject = schemeFixtureCleanup(test)

test('реестр схем: ширина окна, поиск в фильтре всей выборки и точки только основной редакции', async ({ page }, testInfo) => {
  const project = `E2E registry ${testInfo.project.name}`
  trackProject(testInfo, project)
  await withE2eDatabase(async db => {
    const { rows } = await db.query(`insert into line_programs(project_title, subtitle_code, line)
      select $1,case when n=464 then 'TARGET' else 'OTHER' end,'LINE-'||lpad(n::text,3,'0') from generate_series(1,465) n returning id,line`, [project])
    const line = rows.find(row => row.line === 'LINE-464')
    const bundle = (await db.query(`insert into line_scheme_bundles(line_program_id,project_title,subtitle_code,line) values($1,$2,'TARGET',$3) returning id`, [line.id, project, line.line])).rows[0].id
    const active = randomUUID(), archive = randomUUID()
    for (const revision of [active, archive]) {
      const fileKey = randomUUID()
      await db.query("insert into line_scheme_files(key,state) values($1,'ready')", [fileKey])
      await db.query("insert into line_scheme_revisions(id,bundle_id,file_key,file_name,size,page_count,author_id,author_name) values($1,$2,$3,'Working drawing.pdf',100,4,'fixture','Fixture')", [revision, bundle, fileKey])
    }
    await db.query('update line_scheme_bundles set active_revision_id=$1 where id=$2', [active, bundle])
    const joints = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality)
      select $1,$2,'TARGET',$3,'S'||n,'действующий',case when n=4 then 'не актуален' else 'актуальная' end from generate_series(1,4) n returning id,joint`, [line.id, project, line.line])).rows
    for (const joint of joints) {
      await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) values($1,'primary',$1)", [joint.id])
      const physical = (await db.query('insert into line_scheme_physicals(seed_node_id,last_label) values($1,$2) returning id', [joint.id, joint.joint])).rows[0].id
      await db.query('insert into line_scheme_members(weld_joint_id,physical_id) values($1,$2)', [joint.id, physical])
      if (joint.joint === 'S1' || joint.joint === 'S4') await db.query('insert into line_scheme_points(id,revision_id,physical_id,page,x,y) values($1,$2,$3,2,.4,.4)', [randomUUID(), active, physical])
    }
    for (let i = 0; i < 3; i++) {
      // Missing source joints represent preserved grey points, including sheet 4.
      const physical = (await db.query("insert into line_scheme_physicals(seed_node_id,last_label) values($1,$2) returning id", [-line.id * 10 - i, `Old-${i}`])).rows[0].id
      await db.query('insert into line_scheme_points(id,revision_id,physical_id,page,x,y) values($1,$2,$3,$4,.5,.5)', [randomUUID(), i < 2 ? active : archive, physical, i === 1 ? 4 : 1])
    }
  })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1904, height: 933 })
  await page.goto('/line-schemes')
  const registry = page.getByRole('region', { name: 'Схемы линий', exact: true })
  await filterSchemeProject(page, project)
  await expect(registry.getByText('1–50 из 465', { exact: true })).toBeVisible()
  await expect(registry.locator('.ag-root')).toHaveClass(/ag-layout-auto-height/)
  const top = await page.evaluate(() => window.scrollY)
  await registry.locator('.ag-row').first().hover(); await page.mouse.wheel(0, 500)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(top + 100)
  await expect.poll(async () => Math.abs((await registry.locator('.ag-header').boundingBox())!.y)).toBeLessThan(2)
  await registry.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  await expect(page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
  const bounds = await registry.boundingBox()
  expect(bounds!.width).toBeGreaterThan(1500)
  await expect(page.getByRole('heading', { name: 'Схемы линий', exact: true })).toHaveCount(1)
  const openFilter = async (field: string) => {
    await registry.locator(`.ag-header-cell[col-id="${field}"]`).locator('.ag-header-cell-filter-button').click()
  }
  await openFilter('line')
  const filter = page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true })
  await filter.getByRole('textbox', { name: 'Найти значение фильтра' }).fill('LINE-464')
  await expect(filter.getByRole('checkbox')).toHaveCount(1)
  await filter.getByRole('checkbox').check()
  await expect(registry.getByText('Линий: 1', { exact: true })).toBeVisible()
  await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
  const row = registry.getByRole('row').filter({ hasText: 'LINE-464' })
  await expect(registry.getByRole('button', { name: 'Назад', exact: true })).toHaveCount(0)
  await expect(row.locator('[col-id="placedCount"]')).toHaveText('4')
  await expect(row.locator('[col-id="total"]')).toHaveText('3')
  await expect(row.locator('[col-id="placedPercent"]')).toHaveText('33,3%')
  await withE2eDatabase(db => db.query("update weld_joints set revision_actuality='не актуален' where project_title=$1 and joint='S3'", [project]))
  await registry.getByRole('button', { name: 'Обновить список', exact: true }).click()
  await expect(row.locator('[col-id="placedPercent"]')).toHaveText('50%')
  await expect(row.getByRole('button', { name: 'Working drawing', exact: true })).toBeInViewport()
  await row.getByRole('button', { name: 'Файлы и архив: LINE-464', exact: true }).click()
  const files = page.getByRole('dialog', { name: 'Файлы и архив линии LINE-464', exact: true })
  await expect(files.locator('[data-scheme-revision]')).toHaveCount(2)
  expect(page.workers()).toHaveLength(0)
  expect(await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /line-scheme-pdf|\.wasm/.test(url)))).toEqual([])
  await files.getByRole('button', { name: 'Закрыть файлы', exact: true }).click()
  await openFilter('subtitleCode')
  const codeFilter = page.getByRole('dialog', { name: 'Фильтр: Шифр', exact: true })
  await expect(codeFilter.getByRole('checkbox')).toHaveCount(1)
  await expect(codeFilter).toContainText('TARGET')
  await codeFilter.getByRole('textbox').press('Escape')
  await expect(codeFilter).not.toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('registry-desktop.png') })
  await registry.getByRole('button', { name: 'Сбросить фильтры (2)' }).click()
  await filterSchemeProject(page, project)
  await expect(registry.getByText('1–50 из 465', { exact: true })).toBeVisible()
  await openFilter('line')
  await filter.getByRole('textbox').fill('LINE-464')
  await expect(filter.getByRole('checkbox')).not.toBeChecked()
  await filter.getByRole('textbox').press('Escape')
  await page.setViewportSize({ width: 1280, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
  await expect(registry.getByRole('columnheader', { name: 'На схеме', exact: true })).toBeVisible()
  await expect.poll(async () => { const box = await registry.locator('.ag-header-cell[col-id="files"]').boundingBox(); return box ? box.x + box.width : Infinity }).toBeLessThanOrEqual(1256)
  await page.screenshot({ path: testInfo.outputPath('registry-laptop.png') })
  expect(errors).toEqual([])
})
