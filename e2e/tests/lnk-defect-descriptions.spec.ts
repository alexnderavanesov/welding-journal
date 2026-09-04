import { expect, test, type Locator, type Page } from '@playwright/test'

import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'
import { withE2eDatabase } from '../database'

const JOINT = 'F-DEFECTS'
const CONCURRENT_JOINT = 'F-DEFECTS-CONCURRENT'
const REPORT_VIEW_STORAGE_KEY = 'welding-report-view:v1:lnk'
const DEFECT_FIELD_KEYS = new Set([
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
  const row = page
    .getByRole('button', { name: `Выбрать стык ${JOINT}`, exact: true })
    .locator('xpath=ancestor::tr')
  await expect(row).toBeVisible()

  await page.getByRole('button', { name: /Столбцы/ }).click()
  for (const label of [
    'Дефекты ВИК',
    'Дефекты УЗК',
    'Дефекты ПВК',
    'Дефекты ВИК до ТО',
    'Дефекты УЗК до ТО',
    'Дефекты ПВК до ТО',
  ]) {
    await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: /Столбцы/ }).click()

  const goodUzkCell = row.locator('td[data-weld-field-key="uzkDefectDescription"]')
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
})

test('does not overwrite a newer defect description from another user', async ({ browser, baseURL }) => {
  await seedDefectDescriptionJoint(CONCURRENT_JOINT)
  const firstContext = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } })
  const secondContext = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } })
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

    await expect(secondPage.getByRole('status')).toContainText('уже изменен другим пользователем')
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
  const cell = row.locator(`td[data-weld-field-key="${fieldKey}"]`)
  await cell.click()
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: label, exact: true }),
  })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(label, { exact: true }).fill(value)
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(cell).toHaveText(value)
}

async function configureDefectColumns(page: Page) {
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
}

function findJointRow(page: Page, joint: string) {
  return page
    .getByRole('button', { name: `Выбрать стык ${joint}`, exact: true })
    .locator('xpath=ancestor::tr')
}

async function openDefectEditor(
  page: Page,
  row: Locator,
  fieldKey: string,
  label: string,
) {
  await row.locator(`td[data-weld-field-key="${fieldKey}"]`).click()
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
