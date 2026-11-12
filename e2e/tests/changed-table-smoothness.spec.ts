import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createSmoothnessProbe } from '../smoothness-probe'
import { withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'

const enabled = !!process.env.SMOOTHNESS_LABEL
test.skip(!enabled, 'Explicit moderate review of the changed workflows')
test.use({ trace: 'off', video: 'off' })
const trackProject = schemeFixtureCleanup(test)

test('schemes, file archive, document list preview and preliminary batch remain responsive', async ({ page }, info) => {
  test.setTimeout(300_000)
  const project = `E2E changed tables ${randomUUID()}`
  trackProject(info, project)
  await withLineProgramFixture(async db => {
    const programs = (await db.query(`insert into line_programs(project_title,subtitle_code,line,psto_assignment)
      select $1,'SM','SM-'||lpad(n::text,3,'0'),'assigned' from generate_series(1,150) n returning id,line`, [project])).rows
    const ids = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,psto_required,pre_heat_treatment_required)
      select $1,$2,'SM',$3,'F'||n,'2026-11-01','С17','да','да',false from generate_series(1,100) n returning id`, [programs[0].id, project, programs[0].line])).rows.map(row => row.id)
    const documents = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal',$1||' '||n,'unused.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1
      from generate_series(1,100) n returning id`, [project])).rows
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select * from unnest($1::int[],$2::int[])', [documents.map(row => row.id), ids])
    const bundle = (await db.query(`insert into line_scheme_bundles(line_program_id,project_title,subtitle_code,line)
      values($1,$2,'SM',$3) returning id`, [programs[0].id, project, programs[0].line])).rows[0].id
    for (let index = 0; index < 30; index++) {
      const file = randomUUID(), revision = randomUUID()
      await db.query("insert into line_scheme_files(key,state) values($1,'ready')", [file])
      await db.query(`insert into line_scheme_revisions(id,bundle_id,file_key,file_name,size,page_count,author_id,author_name)
        values($1,$2,$3,$4,100,1,'fixture','Fixture')`, [revision, bundle, file, `Drawing ${index}.pdf`])
      if (index === 0) await db.query('update line_scheme_bundles set active_revision_id=$1 where id=$2', [revision, bundle])
    }
  })
  const probe = await createSmoothnessProbe(page, info)
  try {
    const schemes = page.getByRole('region', { name: 'Схемы линий', exact: true })
    await probe.measure('schemes:registry-open-150', async () => {
      await page.goto('/line-schemes')
      await filterSchemeProject(page, project)
      await expect(schemes.getByText('1–50 из 150', { exact: true })).toBeVisible()
    })
    await probe.scroll('schemes:registry-scroll', schemes)
    await probe.resize('schemes:registry-resize', schemes, 'line')
    await page.evaluate(() => window.scrollTo(0, 0))
    await schemes.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
    const filter = page.getByRole('dialog', { name: 'Фильтр: Линия', exact: true })
    await expect(filter.getByRole('checkbox').first()).toBeVisible()
    const handle = (await filter.getByRole('button', { name: 'Изменить размер фильтра', exact: true }).boundingBox())!
    await probe.measure('schemes:filter-resize', async () => {
      await page.mouse.move(handle.x + 7, handle.y + 7)
      await page.mouse.down()
      await page.mouse.move(handle.x + 207, handle.y + 107, { steps: 40 })
      await page.mouse.up()
    })
    await page.keyboard.press('Escape')
    await expect(filter).toBeHidden()
    const files = page.getByRole('dialog', { name: 'Файлы и архив линии SM-001', exact: true })
    await probe.measure('schemes:archive-open-30', async () => {
      await schemes.locator('.ag-row').filter({ hasText: 'SM-001' }).getByRole('button', { name: /Файлы/ }).click()
      await expect(files.getByText('Drawing 29.pdf', { exact: true })).toBeAttached()
    })
    await probe.scroll('schemes:archive-30-scroll', files)
    await files.getByRole('button', { name: 'Закрыть файлы', exact: true }).click()

    await page.goto('/documents')
    const documents = page.locator('[data-document-history-grid="generated:weldingJournal"]')
    await documents.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(project)
    await expect(documents.getByText('Найдено: 100', { exact: true })).toBeVisible()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    await probe.measure('documents:list-preview-100', async () => {
      await documents.getByRole('button', { name: 'Показать', exact: true }).click()
      await expect(preview.frameLocator('iframe').locator('tbody tr')).toHaveCount(100)
    })
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await page.goto('/lnk')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    await expect(page.getByText('Найдено: 100', { exact: true })).toBeVisible()
    await page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox').click()
    const batch = page.getByRole('dialog', { name: 'Поставить отметку НК до ТО', exact: true })
    await probe.measure('preliminary:batch-preview-100', async () => {
      await page.getByRole('button', { name: 'НК до ТО', exact: true }).click()
      await page.getByRole('button', { name: 'Поставить отметку', exact: true }).click()
      await expect(batch.getByRole('button', { name: 'Поставить, оставить незаполненным', exact: true })).toBeEnabled()
    })
    await probe.scroll('preliminary:batch-scroll', batch)
    await probe.measure('preliminary:batch-next-page', async () => {
      await batch.getByRole('button', { name: 'Далее', exact: true }).click()
      await expect(batch.getByText('2 / 2', { exact: true })).toBeVisible()
    })
    await batch.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await withE2eDatabase(async db => (await db.query('select count(*)::int n from weld_joints where project_title=$1 and pre_heat_treatment_required', [project])).rows[0].n)).toBe(0)
  } finally { await probe.finish() }
})
