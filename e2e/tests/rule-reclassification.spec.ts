import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E rule classification'
const stamp = 'FCT1'

test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => db.query('delete from welder_stamps where naks_stamp=$1', [stamp]))
})

test('единая вкладка: 12 СП, 2 ЗВ, 6 ДЗ и прежняя ссылка на правило ремонта', async ({ page }) => {
  await page.goto('/settings#system-rule-sp-05')
  await expect(page.getByRole('button', { name: 'Правила и проверки', exact: true })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(12)
  await expect(page.getByRole('article').getByRole('checkbox')).toHaveCount(0)
  await expect(page.locator('#system-rule-lnk-results-details')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Принятые исключения', exact: true })).toHaveAttribute('aria-selected', 'false')
  await page.getByRole('tab', { name: 'Защиты ввода', exact: true }).click()
  await expect(page.locator('[id^="save-check-setting-"] input[type="checkbox"]')).toHaveCount(2)
  await page.getByRole('tab', { name: 'Задачи диспетчера', exact: true }).click()
  await expect(page.locator('[id^="dispatcher-setting-"] input[type="checkbox"]')).toHaveCount(6)
  await page.getByRole('button', { name: 'Расчет дюймов', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Расчет дюймов', exact: true })).toBeVisible()
})

test('требование ДЛС доступно в параметрах, сохраняется и не отключает обязательный НАКС', async ({ page }) => {
  const key = 'save-check'
  const snapshot = await withE2eDatabase(async db => (await db.query('select value,updated_at from app_settings where key=$1', [key])).rows[0])
  try {
    await page.goto('/settings#rules-dls-requirement')
    const toggle = page.getByRole('checkbox', { name: 'Требовать ДЛС для официальных клейм', exact: true })
    const initial = await toggle.isChecked()
    // The protected action awaits the password/settings check before updating
    // this controlled input. setChecked asserts synchronously after the click.
    await toggle.click()
    await expect(toggle).toBeChecked({ checked: !initial })
    const stored = () => withE2eDatabase(async db => JSON.parse((await db.query('select value from app_settings where key=$1', [key])).rows[0]?.value ?? 'null'))
    await expect.poll(stored).toMatchObject({ officialDls: !initial, officialRegistry: true, officialNaksDate: true, officialMaterialGroup: true })
    await page.reload()
    await expect(toggle).toBeChecked({ checked: !initial })
    await toggle.click()
    await expect(toggle).toBeChecked({ checked: initial })
    await expect.poll(stored).toMatchObject({ officialDls: initial, officialRegistry: true, officialDiameter: true, officialThickness: true })
  } finally {
    await page.close()
    await withE2eDatabase(async db => {
      if (snapshot) await db.query('update app_settings set value=$2,updated_at=$3 where key=$1', [key, snapshot.value, snapshot.updated_at])
      else await db.query('delete from app_settings where key=$1', [key])
      await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
    })
  }
})

test('закрепленные подвкладки, связи СП/ЗВ/ДЗ и доступ к исключениям без прокрутки', async ({ page }) => {
  await page.goto('/settings#rules-system')
  const tabs = page.getByRole('tablist', { name: 'Разделы правил и проверок' })
  await expect(tabs.getByRole('tab')).toHaveCount(5)
  await page.locator('#system-rule-control-history').scrollIntoViewIfNeeded()
  await expect(tabs).toBeInViewport()
  await expect(page.getByRole('searchbox', { name: 'Поиск по настройкам' })).toBeInViewport()
  await tabs.getByRole('tab', { name: 'Защиты ввода', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Защиты ввода', exact: true })).toBeVisible()
  await page.screenshot({ path: '/private/tmp/welding-rules-input-ui.png', animations: 'disabled' })
  await page.getByRole('tabpanel').getByRole('button', { name: 'СП-02 · Допуск сварщиков', exact: true }).click()
  await expect(tabs.getByRole('tab', { name: 'Системные правила', exact: true })).toHaveAttribute('aria-selected', 'true')
  const qualification = page.locator('#system-rule-welder-qualification')
  await expect(qualification.getByText(/Архив — организационный признак/)).toBeVisible()
  await qualification.getByRole('button', { name: 'ДЗ-04 · Срок действия НАКС', exact: true }).click()
  await expect(tabs.getByRole('tab', { name: 'Задачи диспетчера', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#dispatcher-setting-help-welder-stamp-expiry')).toBeVisible()
  await page.screenshot({ path: '/private/tmp/welding-rules-tasks-ui.png', animations: 'disabled' })
  await tabs.getByRole('tab', { name: 'Принятые исключения', exact: true }).click()
  await expect(page.locator('#rules-accepted-exceptions')).toBeVisible()
  await expect(page.getByText('Загружаем исключения…', { exact: true })).toBeHidden()
  await page.screenshot({ path: '/private/tmp/welding-rules-exceptions-ui.png', animations: 'disabled' })
  await tabs.getByRole('tab', { name: 'Системные правила', exact: true }).click()
  await expect(qualification).toBeVisible()
  await page.screenshot({ path: '/private/tmp/welding-rules-tabs-ui.png', animations: 'disabled' })
})

test('создание: дата сварки и фактические клейма сохраняются без официальных', async ({ page }) => {
  await withE2eDatabase(db => db.query('insert into welder_stamps(naks_stamp, welder_name) values ($1,$2)', [stamp, 'Фактический исполнитель без официального допуска']))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
  const editor = page.getByRole('dialog')
  for (const [name, value] of [['Проект', project], ['Шифр', 'RULES'], ['Линия', 'RULES-FACT'], ['Стык', 'F981']]) {
    await editor.getByRole('textbox', { name, exact: true }).fill(value)
  }
  await editor.getByLabel('Дата сварки', { exact: true }).fill('2026-09-01')
  for (const label of ['Корень_1 - факт', 'Заполнение_1 - факт', 'Облицовка_1 - факт']) {
    await editor.getByRole('combobox', { name: label, exact: true }).selectOption(stamp)
  }
  await expect(editor.getByRole('combobox', { name: 'Корень_1', exact: true })).toHaveValue('')
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  const saved = await withE2eDatabase(async db => (await db.query(`select id, weld_date::text,
    stamp_1_k, stamp_1_z, stamp_1_o, stamp_1_k_fact, stamp_1_z_fact, stamp_1_o_fact
    from weld_joints where project_title=$1 and joint='F981'`, [project])).rows[0])
  expect(saved).toMatchObject({ weld_date: '2026-09-01', stamp_1_k: null, stamp_1_z: null, stamp_1_o: null,
    stamp_1_k_fact: stamp, stamp_1_z_fact: stamp, stamp_1_o_fact: stamp })
  expect(errors).toEqual([])
})
