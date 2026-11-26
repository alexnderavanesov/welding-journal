import { lnkRow as lnkGridRow, revealLnkColumn } from './lnk-grid-helpers'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'

const JOINT = 'F-DEFECTS'
const CONCURRENT_JOINT = 'F-DEFECTS-CONCURRENT'
const REPORT_VIEW_STORAGE_KEY = 'welding-report-view:v1:lnk'
const DEFECT_FIELD_KEYS = new Set([
  'joint',
  'vikDefectDescription',
  'uzkDefectDescription',
  'pvkDefectDescription',
  'preVikDefectDescription',
  'preUzkDefectDescription',
  'prePvkDefectDescription',
])

test('shows and edits independent VIK, UZK and PVK defect descriptions', async ({ page }) => {
  await seedDefectDescriptionJoint()
  const hiddenFieldKeys = LNK_VISIBLE_FIELD_SECTIONS
    .flatMap((section) => section.fields.map((field) => field.key))
    .filter((fieldKey) => !DEFECT_FIELD_KEYS.has(fieldKey))

  await page.addInitScript(({ storageKey, hiddenFields }) => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      activePreset: 'custom',
      hiddenFieldKeys: hiddenFields,
      customHiddenFieldKeys: hiddenFields,
      collapsedSections: [],
      savedViews: [],
    }))
  }, { storageKey: REPORT_VIEW_STORAGE_KEY, hiddenFields: hiddenFieldKeys })

  await page.goto('/lnk')
  const row = lnkGridRow(page, JOINT)
  await expect(row).toBeVisible()

  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  for (const label of [
    'Дефекты ВИК',
    'Дефекты УЗК',
    'Дефекты ПВК',
    'Дефекты ВИК до ТО',
    'Дефекты УЗК до ТО',
    'Дефекты ПВК до ТО',
  ]) {
    await page.getByRole('textbox', { name: 'Найти столбец или раздел' }).fill(label)
    await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()

  await revealLnkColumn(page, 'uzkDefectDescription')
  const goodUzkCell = row.locator('[col-id="uzkDefectDescription"]')
  await expect(goodUzkCell).toHaveText('ДНО')
  await goodUzkCell.click()
  await expect(page.getByRole('heading', { name: 'Дефекты УЗК', exact: true })).toHaveCount(0)

  await editDefectCell({
    page,
    row,
    fieldKey: 'vikDefectDescription',
    label: 'Дефекты ВИК',
    value: 'Подрез 14 мм',
  })
  await expect.poll(() => loadDefectDescriptions()).toMatchObject({
    vikDefectDescription: 'Подрез 14 мм',
    prePvkDefectDescription: 'Пора до ТО',
  })

  await editDefectCell({
    page,
    row,
    fieldKey: 'prePvkDefectDescription',
    label: 'Дефекты ПВК до ТО',
    value: 'Трещина до ТО',
  })
  await expect.poll(() => loadDefectDescriptions()).toEqual({
    vikDefectDescription: 'Подрез 14 мм',
    prePvkDefectDescription: 'Трещина до ТО',
  })
  const history = await withE2eDatabase(async db => (await db.query(`select c.entity,c.changes from audit_changes c
    join weld_joints w on w.id=c.joint_id where w.joint=$1 order by c.id`, [JOINT])).rows)
  expect(history.some(row => row.entity === 'weld_joints' && row.changes.vikDefectDescription?.after === 'Подрез 14 мм' && row.changes.vikDefectDescription.origin === 'user')).toBe(true)
  expect(history.some(row => row.entity === 'pre_heat_treatment_controls' && row.changes.defectDescription?.after === 'Трещина до ТО' && row.changes.defectDescription.origin === 'user')).toBe(true)
})

test('RK exposure descriptions save the blue default, typed defects and intentional blanks at their own stage', async ({ page }) => {
  const joint = 'F84521'
  const empty = '0-250:\n250-500:\n500-0:'
  const beforeHeat = '0-250: Старый дефект\n250-500:\n500-0:'
  await withLineProgramFixture(async db => {
    const { rows: [row] } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,d1,d2,t1,t2,has_rk,rk_control_basis,rk_result,rk_conclusion,
      rk_conclusion_date,lnk_defect_description,lnk_created_at,lnk_updated_at)
      values ('E2E РК','RK','RK-1',$1,'2026-08-15','действующий','актуальная','СШ',219,219,6,6,'да','проект',
      'ремонт','РК-2','2026-08-17',$2,now(),now())
      returning id`, [joint, empty])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,conclusion_name,conclusion_date,defect_description)
      values ($1,'РК','вырез','РК-1','2026-08-16',$2)`, [row.id, beforeHeat])
  })
  const stored = () => withE2eDatabase(async db => (await db.query(`select w.lnk_defect_description as main, p.defect_description as pre
    from weld_joints w join pre_heat_treatment_controls p on p.weld_joint_id=w.id and p.method='РК' where w.joint=$1`, [joint])).rows[0])
  await configureDefectColumns(page, new Set(['joint', 'rkExposureScheme', 'lnkDefectDescription', 'preRkExposureScheme', 'preRkDefectDescription']))
  await page.goto('/lnk')
  const row = lnkGridRow(page, joint)
  await expect(row).toBeVisible()
  const title = 'Снимки и описание дефектов РК'
  const main = await openDefectEditor(page, row, 'rkExposureScheme', title)
  const descriptionHeading = 'Описание дефекта (запись после «:»)'
  await expect(main.getByText(descriptionHeading, { exact: true })).toHaveCSS('text-transform', 'uppercase')
  await expect(main.getByPlaceholder('ДНО', { exact: true })).toHaveCount(3)
  await expect(main.getByPlaceholder('ДНО', { exact: true }).first()).toHaveClass(/placeholder:text-sky-600/)
  await main.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(main).toBeHidden()
  expect(await stored()).toMatchObject({ main: empty, pre: beforeHeat })

  await openDefectEditor(page, row, 'rkExposureScheme', title)
  await main.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(main).toBeHidden()
  const allDno = '0-250: ДНО\n250-500: ДНО\n500-0: ДНО'
  await expect.poll(stored).toMatchObject({ main: allDno, pre: beforeHeat })

  // The two stages can have different results on the same joint.
  await withLineProgramFixture(db => db.query("update weld_joints set rk_result='годен' where joint=$1", [joint]))
  await page.reload()
  await openDefectEditor(page, row, 'lnkDefectDescription', title)
  await expect(main.getByPlaceholder('Например, ДНО или описание дефекта').first()).toHaveValue('ДНО')
  await expect(main.getByPlaceholder('ДНО', { exact: true })).toHaveCount(0)
  await main.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(main).toBeHidden()

  const pre = await openDefectEditor(page, row, 'preRkDefectDescription', title + ' до ТО')
  await expect(pre.getByText(descriptionHeading, { exact: true })).toBeVisible()
  const descriptions = pre.getByPlaceholder('ДНО', { exact: true })
  await expect(descriptions.first()).toHaveValue('Старый дефект')
  await descriptions.first().clear()
  expect(await descriptions.first().evaluate(input => input.matches(':placeholder-shown'))).toBe(true)
  await descriptions.nth(1).pressSequentially('Пора')
  await descriptions.nth(2).fill(' ')
  expect(await descriptions.nth(2).evaluate(input => input.matches(':placeholder-shown'))).toBe(false)
  await pre.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(pre).toBeHidden()
  await expect.poll(stored).toMatchObject({ main: allDno, pre: '0-250: ДНО\n250-500: Пора\n500-0:' })

  await openDefectEditor(page, row, 'preRkExposureScheme', title + ' до ТО')
  await expect(descriptions.nth(1)).toHaveValue('Пора')
  await expect(descriptions.nth(2)).toHaveValue('')
  await pre.getByRole('button', { name: 'Отмена', exact: true }).click()
})

test('does not overwrite a newer defect description from another user', async ({ browser, baseURL }) => {
  await seedDefectDescriptionJoint(CONCURRENT_JOINT)
  const firstContext = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL, viewport: { width: 1600, height: 1000 } })
  const secondContext = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL, viewport: { width: 1600, height: 1000 } })
  const firstPage = await firstContext.newPage()
  const secondPage = await secondContext.newPage()

  try {
    await Promise.all([
      configureDefectColumns(firstPage),
      configureDefectColumns(secondPage),
    ])
    await Promise.all([firstPage.goto('/lnk'), secondPage.goto('/lnk')])

    const firstRow = findJointRow(firstPage, CONCURRENT_JOINT)
    const secondRow = findJointRow(secondPage, CONCURRENT_JOINT)
    await expect(firstRow).toBeVisible()
    await expect(secondRow).toBeVisible()

    const firstDialog = await openDefectEditor(firstPage, firstRow, 'vikDefectDescription', 'Дефекты ВИК')
    const secondDialog = await openDefectEditor(secondPage, secondRow, 'vikDefectDescription', 'Дефекты ВИК')
    await firstDialog.getByLabel('Дефекты ВИК', { exact: true }).fill('Изменение первого пользователя')
    await secondDialog.getByLabel('Дефекты ВИК', { exact: true }).fill('Устаревшее изменение второго')

    await firstDialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(firstDialog).toBeHidden()
    await secondDialog.getByRole('button', { name: 'Сохранить', exact: true }).click()

    await expect(secondPage.getByRole('status').filter({ hasText: 'уже изменен другим пользователем' })).toBeVisible()
    await expect(secondDialog).toBeVisible()
    await expect.poll(() => loadDefectDescriptions(CONCURRENT_JOINT)).toMatchObject({
      vikDefectDescription: 'Изменение первого пользователя',
    })
  } finally {
    await firstContext.close()
    await secondContext.close()
  }
})

async function editDefectCell({
  page,
  row,
  fieldKey,
  label,
  value,
}: {
  page: Page
  row: Locator
  fieldKey: string
  label: string
  value: string
}) {
  await revealLnkColumn(page, fieldKey)
  const cell = row.locator(`[col-id="${fieldKey}"]`)
  await cell.dblclick()
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: label, exact: true }),
  })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(label, { exact: true }).fill(value)
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(cell).toHaveText(value)
}

async function configureDefectColumns(page: Page, visibleFields = DEFECT_FIELD_KEYS) {
  const hiddenFieldKeys = LNK_VISIBLE_FIELD_SECTIONS
    .flatMap((section) => section.fields.map((field) => field.key))
    .filter((fieldKey) => !visibleFields.has(fieldKey))
  await page.addInitScript(({ storageKey, hiddenFields }) => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      activePreset: 'custom',
      hiddenFieldKeys: hiddenFields,
      customHiddenFieldKeys: hiddenFields,
      collapsedSections: [],
      savedViews: [],
    }))
  }, { storageKey: REPORT_VIEW_STORAGE_KEY, hiddenFields: hiddenFieldKeys })
}

function findJointRow(page: Page, joint: string) {
  return lnkGridRow(page, joint)
}

async function openDefectEditor(
  page: Page,
  row: Locator,
  fieldKey: string,
  label: string,
) {
  await revealLnkColumn(page, fieldKey)
  await row.locator(`[col-id="${fieldKey}"]`).dblclick()
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: label, exact: true }),
  })
  await expect(dialog).toBeVisible()
  return dialog
}

async function seedDefectDescriptionJoint(joint = JOINT) {
  await withE2eDatabase(async (client) => {
    const inserted = await client.query<{ id: number }>(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact,
        has_vik, vik_control_basis, vik_result, vik_conclusion_date, vik_conclusion,
        vik_defect_description,
        has_uzk, uzk_control_basis, uzk_result, uzk_conclusion_date, uzk_conclusion,
        has_pvk, pvk_control_basis, psto_required, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      ) values (
        '2026-08-15', 'E2E дефекты ЛНК', 'E2E-DEFECTS', 'E2E-DEFECTS-L1',
        'ISO-E2E-DEFECTS', $1, 'E2E-DEFECTS-S1',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2E-D1', 'E2E-D1',
        'да', 'проект', 'ремонт', '2026-08-16', 'Заключение ВИК E2E',
        'Начальный дефект',
        'да', 'проект', 'годен', '2026-08-16', 'Заключение УЗК E2E',
        'да', 'проект', 'да', 'ожидает ремонт',
        now(), now(), now()
      )
      returning id
    `, [joint])
    await client.query(`
      insert into pre_heat_treatment_controls (
        weld_joint_id, method, request_name, request_date, result,
        conclusion_date, conclusion_name, defect_description
      ) values (
        $1, 'ПВК', 'Заявка ПВК до ТО E2E', '2026-08-15', 'вырез',
        '2026-08-16', 'Заключение ПВК до ТО E2E', 'Пора до ТО'
      )
    `, [inserted.rows[0].id])
  })
}

async function loadDefectDescriptions(joint = JOINT) {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{
      vik_defect_description: string | null
      defect_description: string | null
    }>(`
      select weld.vik_defect_description, control.defect_description
      from weld_joints weld
      left join pre_heat_treatment_controls control
        on control.weld_joint_id = weld.id and control.method = 'ПВК'
      where weld.joint = $1
    `, [joint])
    return {
      vikDefectDescription: result.rows[0]?.vik_defect_description ?? null,
      prePvkDefectDescription: result.rows[0]?.defect_description ?? null,
    }
  })
}
