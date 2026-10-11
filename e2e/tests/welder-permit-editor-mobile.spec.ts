import { expect, test, type Locator, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'

const code = 'EPM1'
const welder = 'Узкий экран редактора допусков'
const methods = [
  'ПОЛЬЗОВАТЕЛЬСКИЙ СПОСОБ РУЧНОЙ СВАРКИ В ЗАЩИТНОЙ СРЕДЕ',
  'ПОЛЬЗОВАТЕЛЬСКИЙ СПОСОБ МЕХАНИЗИРОВАННОЙ СВАРКИ КОРНЯ ШВА',
]
const groups = [
  'ПОЛЬЗОВАТЕЛЬСКАЯ ГРУППА ТЕПЛОУСТОЙЧИВЫХ МАТЕРИАЛОВ ПЕРВАЯ',
  'ПОЛЬЗОВАТЕЛЬСКАЯ ГРУППА КОРРОЗИОННОСТОЙКИХ МАТЕРИАЛОВ ВТОРАЯ',
]
type Permit = { id: string; weldType: string; materialGroups: string; note: string; [key: string]: unknown }
type SavedStamp = { naks: Permit[]; dls: Permit[]; [key: string]: unknown }
let settingsBefore: { value: string; updated_at: Date } | undefined
let settingsCaptured = false

async function saved(): Promise<SavedStamp> {
  return withE2eDatabase(async db => {
    const row = (await db.query('select * from welder_stamps where naks_stamp=$1', [code])).rows[0]
    expect(row).toBeTruthy()
    return { ...row, naks: JSON.parse(row.naks_permits), dls: JSON.parse(row.dls_permits) }
  })
}

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map(page => page.close()))
  await withE2eDatabase(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [code])
    if (settingsCaptured) {
      if (settingsBefore) {
        await db.query("update app_settings set value=$1,updated_at=$2 where key='data-list'", [settingsBefore.value, settingsBefore.updated_at])
      } else {
        await db.query("delete from app_settings where key='data-list'")
      }
    }
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
  })
})

// Start from a known control, then traverse the real tab order, including the
// unselected options. No click/focus shortcut to the long custom choices.
async function tabTo(page: Page, target: Locator) {
  for (let step = 0; step < 24; step++) {
    if (await target.evaluate(element => element === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
  await expect(target).toBeInViewport()
}

async function assertFits(control: Locator, page: Page) {
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  expect(await control.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}

async function selectByKeyboard(page: Page, editor: Locator, values: string[]) {
  await editor.getByRole('button', { name: 'РАД', exact: true }).focus()
  for (const [index, value] of values.entries()) {
    const button = editor.getByRole('button', { name: value, exact: true })
    await tabTo(page, button)
    await assertFits(button, page)
    await page.keyboard.press(index % 2 ? 'Enter' : 'Space')
    await expect(button).toHaveAttribute('aria-pressed', 'true')
  }
}

async function fillDetails(editor: Locator, note: string) {
  for (const [label, value] of [
    ['Диаметр от', '1'], ['Диаметр до', '500'], ['Толщина от', '1'], ['Толщина до', '20'],
    ['Срок от', '2026-01-01'], ['Срок до', '2026-12-31'], ['Примечание', note],
  ]) await editor.getByLabel(label, { exact: true }).fill(value)
}

async function keyboardOpen(button: Locator, page: Page) {
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('редактор НАКС/ДЛС на 390px: длинные группы и способы, Tab/Enter/Space, сохранение, переоткрытие и Esc', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // Only the options directory is a fixture. All four permits are created and
  // edited through the real UI, not SQL, as required by the acceptance matrix.
  await withE2eDatabase(async db => {
    settingsBefore = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
    settingsCaptured = true
    await db.query(`insert into app_settings(key,value) values ('data-list',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({
      weldingTypes: ['РАД', 'РД', ...methods], connectionTypes: ['С17', 'У19'],
      materialGroups: ['М01', 'М05', 'М11', ...groups], testTypes: ['ГИ', 'ПИ'],
    })])
  })
  await page.goto('/welder-stamps')
  const emptyRegion = page.getByRole('region', { name: 'Таблица клейм — горизонтальная прокрутка' })
  await expect(emptyRegion.getByText('Пока нет добавленных клейм.')).toBeVisible()
  expect(await emptyRegion.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await keyboardOpen(page.getByRole('button', { name: 'Добавить клеймо', exact: true }), page)
  const dialog = page.getByRole('dialog')
  const editors = dialog.locator('[data-permit-editor-id]')
  await dialog.getByLabel('Клеймо НАКС', { exact: true }).fill(code)
  await dialog.getByLabel('ФИО сварщика', { exact: true }).fill(welder)
  await selectByKeyboard(page, editors.first(), ['РАД', ...methods, 'М01', ...groups])
  await fillDetails(editors.first(), 'Основной НАКС — сохранить диапазоны и даты')
  await dialog.getByRole('button', { name: 'Добавить НАКС', exact: true }).click()
  await selectByKeyboard(page, editors.nth(1), ['РАД', 'М11'])
  await fillDetails(editors.nth(1), 'Другой НАКС — не изменять')
  await dialog.getByRole('button', { name: 'Добавить ДЛС', exact: true }).click()
  await editors.nth(2).getByLabel('Номер ДЛС', { exact: true }).fill('ДЛС-EPM1-1')
  await selectByKeyboard(page, editors.nth(2), ['РАД', ...methods, 'М01', ...groups])
  await fillDetails(editors.nth(2), 'Основной ДЛС — сохранить номер и сроки')
  await dialog.getByRole('button', { name: 'Добавить ДЛС', exact: true }).click()
  await editors.nth(3).getByLabel('Номер ДЛС', { exact: true }).fill('ДЛС-EPM1-2')
  await selectByKeyboard(page, editors.nth(3), ['РАД', 'М11'])
  await fillDetails(editors.nth(3), 'Другой ДЛС — не изменять')
  const saveCreate = dialog.getByRole('button', { name: 'Добавить клеймо', exact: true })
  await expect(saveCreate).toBeEnabled()
  await saveCreate.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  const before = await saved()
  expect(before.naks).toHaveLength(2)
  expect(before.dls).toHaveLength(2)
  for (const permit of [before.naks[0], before.dls[0]]) {
    expect(permit.weldType.split(', ')).toEqual(['РАД', ...methods])
    expect(permit.materialGroups.split(', ')).toEqual(['М01', ...groups])
  }

  const reopen = async () => {
    await page.reload()
    const region = page.getByRole('region', { name: 'Таблица клейм — горизонтальная прокрутка' })
    await expect(region).toBeVisible()
    const regionBox = await region.boundingBox()
    expect(regionBox!.x + regionBox!.width).toBeLessThanOrEqual(391)
    expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    const table = region.getByRole('table')
    expect((await table.boundingBox())!.width).toBeGreaterThanOrEqual(1120)
    const stamp = region.getByText(code, { exact: true }).first()
    const stampBox = await stamp.boundingBox()
    const cellBox = await stamp.locator('xpath=ancestor::td').boundingBox()
    expect(stampBox!.x).toBeGreaterThanOrEqual(cellBox!.x)
    expect(stampBox!.x + stampBox!.width).toBeLessThanOrEqual(cellBox!.x + cellBox!.width)
    await region.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await page.getByText(code, { exact: true }).first().click()
    await page.getByRole('button', { name: 'Редактировать', exact: true }).focus()
    await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('mobile-card.png') })
    await keyboardOpen(page.getByRole('button', { name: 'Редактировать', exact: true }), page)
    await expect(editors).toHaveCount(4)
  }
  const verifyChoices = async (expectedGroups: string[]) => {
    for (const permit of [before.naks[0], before.dls[0]]) {
      const editor = dialog.locator(`[data-permit-editor-id="${permit.id}"]`)
      for (const value of ['РАД', ...methods, 'М01', ...groups]) {
        await expect(editor.getByRole('button', { name: value, exact: true })).toHaveAttribute(
          'aria-pressed', ['РАД', ...methods, ...expectedGroups].includes(value) ? 'true' : 'false',
        )
      }
    }
  }
  await reopen()
  await verifyChoices(['М01', ...groups])
  // Narrow only the first NAKS/DLS pair; the other pair must survive byte-for-byte
  // at the parsed-record level, including IDs, dates, ranges, notes and DLS number.
  for (const permit of [before.naks[0], before.dls[0]]) {
    const editor = dialog.locator(`[data-permit-editor-id="${permit.id}"]`)
    await editor.getByRole('button', { name: groups[0], exact: true }).focus()
    const remove = editor.getByRole('button', { name: groups[1], exact: true })
    await tabTo(page, remove)
    await page.keyboard.press('Space')
    await expect(remove).toHaveAttribute('aria-pressed', 'false')
  }
  const saveEdit = dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true })
  await expect(saveEdit).toBeEnabled()
  await saveEdit.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  const after = await saved()
  for (const key of ['naks', 'dls'] as const) {
    expect(after[key]).toEqual([
      { ...before[key][0], materialGroups: ['М01', groups[0]].join(', ') }, before[key][1],
    ])
  }
  await reopen()
  await verifyChoices(['М01', groups[0]])
  for (const permit of [before.naks[0], before.dls[0]]) {
    const editor = dialog.locator(`[data-permit-editor-id="${permit.id}"]`)
    await editor.getByRole('button', { name: groups[0], exact: true }).focus()
    await page.keyboard.press('Space')
    await editor.getByLabel('Примечание', { exact: true }).fill('Отмена — не сохранять')
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await saved()).toEqual(after)
  await reopen()
  await verifyChoices(['М01', groups[0]])
  for (const permit of [...after.naks, ...after.dls]) {
    await expect(dialog.locator(`[data-permit-editor-id="${permit.id}"]`).getByLabel('Примечание', { exact: true })).toHaveValue(permit.note)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.reload()
  const desktopRegion = page.getByRole('region', { name: 'Таблица клейм — горизонтальная прокрутка' })
  await expect(desktopRegion.getByText(code, { exact: true })).toBeVisible()
  expect(await desktopRegion.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await desktopRegion.getByText(code, { exact: true }).click()
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await expect(editors).toHaveCount(4)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  const permitSection = desktopRegion.locator('section').filter({
    has: page.getByRole('heading', { name: 'Допуски НАКС и ДЛС', exact: true }),
  })
  for (const value of [after.naks[0].weldType, after.naks[0].materialGroups]) {
    const values = permitSection.getByText(value, { exact: true })
    await expect(values).toHaveCount(2)
    for (const element of await values.all()) {
      // Long words must wrap inside their own grid cell, never over the next
      // field's label. Check real text bounds, not just a CSS class.
      expect(await element.evaluate(node => {
        const cell = node.parentElement!.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(node)
        return [...range.getClientRects()].every(rect => rect.left >= cell.left - 1 && rect.right <= cell.right + 1)
      })).toBe(true)
    }
  }
  await page.screenshot({ path: testInfo.outputPath('desktop-card.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
  await expect.poll(() => page.locator('[data-app-sidebar="true"]').evaluate(element => element.getBoundingClientRect().width)).toBe(64)
  const editNarrow = page.getByRole('button', { name: 'Редактировать', exact: true })
  await editNarrow.focus()
  await expect(editNarrow).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('mobile-collapsed-card.png') })
  await editNarrow.click()
  await expect(editors).toHaveCount(4)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await saved()).toEqual(after)
  expect(errors).toEqual([])
})
