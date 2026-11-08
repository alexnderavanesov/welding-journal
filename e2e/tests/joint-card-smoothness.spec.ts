import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { createSmoothnessProbe } from '../smoothness-probe'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'
import { editJournalJoint, journalRow } from '../journal-grid'
import { withE2eDatabase } from '../database'
import { FIELD_BY_KEY } from '../../src/lib/weld-fields'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const enabled = !!process.env.SMOOTHNESS_LABEL
test.skip(!enabled, 'Explicit isolated joint-card performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })

test('joint card: repeated history, line view, editing tabs, stamp lookup and fast input', async ({ page }, info) => {
  test.setTimeout(300000)
  await seedSmoothnessFixture()
  const probe = await createSmoothnessProbe(page, info)
  try {
    const id = await withE2eDatabase(async db => (await db.query(
      "select id from weld_joints where line='SM-0001' and joint='F0001'",
    )).rows[0].id as number)
    await withLineProgramFixture(db => db.query("update weld_joints set isometry='PERF-CARD-ONLY' where id=$1", [id]))
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill('PERF-CARD-ONLY')
    await expect(journalRow(page, id)).toBeVisible()
    for (let round = 0; round < 3; round++) {
      const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F0001', exact: true }) })
      await probe.measure(`card:history-open:${round}`, async () => {
        await journalRow(page, id).getByRole('button', { name: 'F0001', exact: true }).click()
        await expect(picture).toBeVisible()
        await expect(picture.getByRole('tab', { name: 'Стык', exact: true })).toBeVisible()
      })
      for (const tab of ['Требует действия', 'Картина линии', 'Стык']) {
        await probe.measure(`card:${tab}:${round}`, async () => {
          await picture.getByRole('tab', { name: new RegExp(`^${tab}(?: ·|$)`) }).click()
          await expect(picture.getByRole('tabpanel')).toBeVisible()
        })
        if (round === 0) await probe.scroll(`card:${tab}:scroll`, picture)
      }
      await picture.getByRole('button', { name: 'Закрыть', exact: true }).click()
      const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
      await probe.measure(`card:editor-open:${round}`, async () => {
        await editJournalJoint(page, id)
        await expect(editor.getByRole('textbox', { name: 'Изометрия', exact: true })).toBeEditable()
      })
      for (const tab of ['Назначение контроля', 'Сварочный материал и ТК', 'Испытания и закрытие', 'Стык']) {
        await probe.measure(`card:editor-${tab}:${round}`, async () => {
          await editor.getByRole('button', { name: new RegExp(`^${tab}(?:\\s|$)`) }).click()
        })
      }
      if (round === 0) await probe.scroll('card:editor-scroll', editor)
      const label = FIELD_BY_KEY.get('stamp1KFact')!.label
      await probe.measure(`card:stamp-open:${round}`, async () => {
        await editor.getByRole('combobox', { name: label, exact: true }).click()
        await expect(editor.getByRole('listbox')).toBeVisible()
      })
      await probe.measure(`card:stamp-search:${round}`, async () => {
        await editor.getByRole('combobox', { name: `Поиск: ${label}`, exact: true }).fill('Q999')
        await expect(editor.getByRole('listbox').getByRole('option', { name: 'Q999', exact: true })).toBeVisible()
      })
      await page.keyboard.press('Escape')
      const input = editor.getByRole('textbox', { name: 'Изометрия', exact: true })
      const original = await input.inputValue()
      await probe.measure(`card:typing:${round}`, async () => {
        await input.fill('')
        await input.pressSequentially('ISO-fast-input-0123456789', { delay: 15 })
        await expect(input).toHaveValue('ISO-fast-input-0123456789')
      })
      await input.fill(original)
      await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
      await expect(editor).toBeHidden()
    }
  } finally {
    await probe.finish(); await page.close(); await cleanupSmoothnessFixture()
  }
})

test('users grid: 500 records, scrolling, filtering and permission details', async ({ page }, info) => {
  test.setTimeout(180000)
  await withE2eDatabase(db => db.query(`insert into auth_users(id,name,email,status,permissions)
    select 'stamp-perf-user-'||n,'Performance User '||lpad(n::text,3,'0'),
      'stamp-perf-'||n||'@example.invalid','active','["welding.view"]'::jsonb
    from generate_series(1,500) n`))
  const probe = await createSmoothnessProbe(page, info)
  try {
    const grid = page.getByRole('grid', { name: 'Пользователи и права', exact: true })
    await probe.measure('users:open-500', async () => {
      await page.goto('/account?tab=users')
      await expect(grid.locator('.ag-row').first()).toBeVisible()
      await expect(page.getByText('Показано: 501 из 501', { exact: true })).toBeVisible()
    })
    for (let round = 0; round < 3; round++) {
      await probe.scroll(`users:scroll:${round}`, grid)
      await probe.resize(`users:resize:${round}`, grid)
      await probe.measure(`users:search:${round}`, async () => {
        await page.getByLabel('Найти пользователя', { exact: true }).fill('Performance User 500')
        await expect(page.getByText('Показано: 1 из 501', { exact: true })).toBeVisible()
      })
      await probe.measure(`users:permissions:${round}`, async () => {
        await grid.getByRole('button', { name: 'Настроить права', exact: true }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
      await probe.scroll(`users:permissions-scroll:${round}`, page.getByRole('dialog'))
      await page.keyboard.press('Escape')
      await page.getByLabel('Найти пользователя', { exact: true }).fill('')
      await expect(page.getByText('Показано: 501 из 501', { exact: true })).toBeVisible()
    }
  } finally {
    await probe.finish(); await page.close()
    await withE2eDatabase(db => db.query("delete from auth_users where id like 'stamp-perf-user-%'"))
  }
})

test('preliminary quick fill: 100 joints, paged fields and document composition', async ({ page }, info) => {
  test.setTimeout(180000)
  const project = 'E2E stamp performance preliminary'
  await withLineProgramFixture(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
    connection_type,has_vik,psto_required,pre_heat_treatment_required,officiality)
    select $1,'PERF','PERF-PRE','F'||n,'2026-10-01','С17','да','да',true,'действующий'
    from generate_series(1,100) n`, [project]))
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/lnk')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    await expect(page.getByText('Найдено: 100', { exact: true })).toBeVisible({ timeout: 60000 })
    await page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox').click()
    for (let round = 0; round < 3; round++) {
      const dialog = page.getByRole('dialog', { name: 'Заполнить недостающий НК до ТО', exact: true })
      await probe.measure(`pre-fill:open-100:${round}`, async () => {
        await page.locator('[data-weld-report-grid] .ag-row [col-id="joint"]').getByRole('button').first().click({ button: 'right' })
        await page.getByRole('button', { name: 'Дополнительно', exact: true }).hover()
        await page.getByRole('button', { name: 'Заполнить недостающее НК до ТО', exact: true }).click()
        await expect(dialog.locator('input[aria-label^="Дата "]').first()).toBeVisible()
      })
      await probe.scroll(`pre-fill:fields-scroll:${round}`, dialog)
      await probe.measure(`pre-fill:next-page:${round}`, async () => {
        await dialog.getByRole('button', { name: 'Далее', exact: true }).click()
        await expect(dialog.getByText(/^2 \/ \d+$/, { exact: true })).toBeVisible()
      })
      const composition = dialog.locator('details').filter({ has: page.getByText(/^Состав создаваемых документов/) })
      await probe.measure(`pre-fill:composition:${round}`, async () => {
        await composition.locator('summary').click()
        await expect(composition.getByRole('table')).toBeVisible()
      })
      await probe.scroll(`pre-fill:documents-scroll:${round}`, composition.getByRole('table'))
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
      await expect(dialog).toBeHidden()
    }
    expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int n from pre_heat_treatment_controls c
      join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1`, [project])).rows[0].n)).toBe(0)
  } finally { await probe.finish(); await page.close(); await cleanupLineProgramProjects([project]) }
})

test('welder statistics: populated table, repeated report preview and complete Excel', async ({ page }, info) => {
  test.setTimeout(180000)
  await seedSmoothnessFixture()
  const probe = await createSmoothnessProbe(page, info)
  try {
    const expectedStamps = await withE2eDatabase(async db => (await db.query<{ stamp: string }>(`
      select stamp_1_k_fact as stamp from weld_joints where project_title=$1 and connection_type<>'Т1' and stamp_1_k_fact is not null
      union select stamp_1_z_fact from weld_joints where project_title=$1 and connection_type<>'Т1' and stamp_1_z_fact is not null
      order by stamp`, [SMOOTHNESS_PROJECT])).rows.map(row => row.stamp))
    // This fixture has 800 pipe-weld participants; the 200 Т1 participants
    // belong to the separate support statistics and its own report.
    expect(expectedStamps).toHaveLength(800)
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Сварщики', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
    const grid = page.locator('[data-statistics-grid="welders"]')
    await expect(grid.locator('.ag-row').first()).toBeVisible()
    for (let round = 0; round < 3; round++) {
      await probe.scroll(`welder-report:table-scroll:${round}`, grid)
      const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
      await probe.measure(`welder-report:preview:${round}`, async () => {
        await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
        await expect(preview.frameLocator('iframe').locator('body')).toContainText('Q000')
      })
      let downloadPath: string | null = null
      await probe.measure(`welder-report:excel:${round}`, async () => {
        const pending = page.waitForEvent('download')
        await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
        const download = await pending
        expect(await download.failure()).toBeNull()
        downloadPath = await download.path()
        expect(downloadPath).toBeTruthy()
      })
      // Validate file completeness outside the timed download interval.
      const workbook = XLSX.read(await readFile(downloadPath!), { type: 'buffer' })
      const exportedStamps = new Set(workbook.SheetNames.flatMap(name =>
        XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1 }).flat()
          .filter((value): value is string => typeof value === 'string' && /^Q\d{3}$/.test(value))))
      expect([...exportedStamps].sort()).toEqual(expectedStamps)
      await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    }
  } finally { await probe.finish(); await page.close(); await cleanupSmoothnessFixture() }
})
