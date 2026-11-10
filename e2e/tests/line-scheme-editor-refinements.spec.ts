import { expect, test } from '@playwright/test'
import { degrees, PDFDocument } from 'pdf-lib'
import { withE2eDatabase } from '../database'
import { filterSchemeProject } from '../line-scheme-grid'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'

const trackProject = schemeFixtureCleanup(test)

test('редактор: повёрнутый PDF, примечания, поиск, смешанный выбор, размер и оформление', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const project = `E2E оформление ${testInfo.project.name}`, line = 'REFINE-1'
  trackProject(testInfo, project)
  await withE2eDatabase(async db => {
    const id = (await db.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values ($1,'UI',$2,'unassigned') returning id", [project, line])).rows[0].id
    await db.query("insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type) select $1,$2,'UI',$3,'S'||n,'действующий','актуальная','С' from generate_series(1,2) n", [id, project, line])
    await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1", [id])
  })
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const pdf = await PDFDocument.create(); pdf.addPage([595, 842]).setRotation(degrees(90)); const buffer = Buffer.from(await pdf.save())
  await page.goto('/line-schemes'); await filterSchemeProject(page, project)
  const row = page.getByRole('row').filter({ hasText: project }), chooser = page.waitForEvent('filechooser')
  await row.getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await (await chooser).setFiles({ name: 'Rotated.pdf', mimeType: 'application/pdf', buffer })
  await page.getByRole('dialog', { name: `Файлы и архив линии ${line}`, exact: true }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true }), stage = dialog.getByLabel('Чертёж PDF', { exact: true })
  const layer = dialog.locator('[data-scheme-point-layer="1"]'), point = (n: number) => dialog.getByRole('button', { name: `Стык S${n}`, exact: true })
  await expect(layer).toBeVisible()
  for (const n of [1, 2]) { await dialog.getByRole('button', { name: `S${n}`, exact: true }).click(); await layer.click({ position: { x: 180 + n * 180, y: 250 } }) }
  await dialog.getByRole('tab', { name: /^Обозначения/ }).click()
  await dialog.getByRole('button', { name: 'Добавить обозначение', exact: true }).click()
  const form = dialog.getByRole('form', { name: 'Оформление обозначения' })
  await form.getByLabel('Название обозначения').fill('Опора')
  await form.getByLabel('Примечание обозначения').fill('Проверить крепление\nПосле монтажа')
  await form.getByRole('button', { name: 'Разместить', exact: true }).click(); await layer.click({ position: { x: 360, y: 450 } })
  const symbol = dialog.locator('[data-scheme-annotation]')
  const transform = await symbol.locator('svg').evaluate(el => { const m = new DOMMatrix(getComputedStyle(el).transform); return { a: m.a, b: m.b } })
  expect(transform.a).toBeCloseTo(1); expect(transform.b).toBeCloseTo(0)
  await symbol.hover(); await expect(page.getByRole('tooltip')).toHaveText('Проверить крепление\nПосле монтажа')
  await stage.hover({ position: { x: 30, y: 30 } }); await expect(page.getByRole('tooltip')).toHaveCount(0)
  // Hover changes appearance without selecting; text remains non-selectable.
  await stage.click({ position: { x: 30, y: 30 } })
  await symbol.hover(); await expect(symbol).toHaveAttribute('aria-pressed', 'false')
  const halo = await symbol.evaluate(el => getComputedStyle(el).boxShadow); expect(halo).not.toBe('none')
  await point(1).hover(); await expect(point(1)).toHaveAttribute('aria-pressed', 'false')
  expect(await point(1).evaluate(el => getComputedStyle(el).boxShadow)).toContain('4px')
  expect(await symbol.evaluate(el => getComputedStyle(el).userSelect || getComputedStyle(el).getPropertyValue('-webkit-user-select'))).toBe('none')
  // Search expands horizontally and Escape clears it without closing the scheme.
  for (const [tab, search, value] of [['Стыки', 'Поиск стыков схемы', 'S1'], ['Размеры', 'Поиск размеров', '100'], ['Обозначения', 'Поиск обозначений', 'Опора']]) {
    await dialog.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
    const opener = dialog.getByRole('button', { name: `Открыть ${search.toLocaleLowerCase('ru')}`, exact: true })
    const before = (await opener.boundingBox())!.y
    await opener.click(); const input = dialog.getByRole('textbox', { name: search, exact: true })
    expect((await input.boundingBox())!.y).toBeCloseTo(before, 0)
    await input.fill(value); await input.press('Escape'); await expect(input).not.toBeVisible(); await expect(dialog).toBeVisible()
    await expect(opener).toBeFocused()
  }
  // Mixed selections expose only group actions, from either selected object.
  await point(1).click(); await symbol.click({ modifiers: ['Meta'] })
  await expect(point(1)).toHaveAttribute('aria-pressed', 'true'); await expect(symbol).toHaveAttribute('aria-pressed', 'true')
  const menu = page.getByTestId('context-action-menu')
  await point(1).click({ button: 'right' })
  await expect(menu.getByRole('button', { name: 'Открыть картину стыка', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('button')).toHaveCount(2)
  await menu.getByRole('button', { name: 'Задать размер', exact: true }).click()
  const dimension = dialog.locator('[data-scheme-dimension]'), input = dimension.getByLabel('Расстояние, мм', { exact: true })
  await expect(input).toBeFocused(); await input.fill('1234,5')
  // An unfinished new value can also move to the row and back without loss.
  await dialog.getByRole('button', { name: /^Размер .*Опора/ }).click()
  await expect(dialog.getByLabel('Расстояние, мм', { exact: true })).toHaveValue('1234,5')
  await dimension.click(); await expect(input).toHaveValue('1234,5'); await input.press('Enter')
  await dimension.click({ button: 'right' }); await menu.getByRole('button', { name: 'Цвет', exact: true }).click()
  await page.getByRole('button', { name: 'красный', exact: true }).click()
  await expect(dialog.locator('[data-dimension-style]')).toHaveAttribute('stroke', '#dc2626')
  await dimension.click({ button: 'right' }); await menu.getByRole('button', { name: 'Толщина линии', exact: true }).click()
  await page.getByRole('button', { name: '3', exact: true }).click()
  await expect(dialog.locator('[data-dimension-main]')).toHaveAttribute('stroke-width', '3')
  // Drawing commands live in one submenu, matching other context menus.
  await stage.click({ button: 'right', position: { x: 30, y: 30 } })
  await expect(menu.getByRole('button', { name: 'Весь лист', exact: true })).toHaveCount(0)
  await menu.getByRole('button', { name: 'Вид чертежа', exact: true }).click()
  await page.locator('[data-menu-item][aria-label="Весь лист"]').click(); await expect(menu).not.toBeVisible()
  const save = async () => { await dialog.getByRole('button', { name: /^Сохранить/ }).click(); await expect(dialog.getByRole('button', { name: 'Обновить состояния', exact: true })).toBeEnabled() }
  await save(); await dialog.getByRole('button', { name: 'Закрыть схему', exact: true }).click(); await row.getByRole('button', { name: 'Rotated', exact: true }).click()
  await expect(dialog.locator('[data-dimension-main]')).toHaveAttribute('stroke-width', '3')
  await expect(dialog.locator('[data-dimension-style]')).toHaveAttribute('stroke', '#dc2626')
  await symbol.hover(); await expect(page.getByRole('tooltip')).toHaveText('Проверить крепление\nПосле монтажа')
  await symbol.click(); await form.getByLabel('Примечание обозначения').fill('   '); await form.getByRole('button', { name: 'Применить', exact: true }).click()
  await stage.hover({ position: { x: 30, y: 30 } }); await symbol.hover(); await expect(page.getByRole('tooltip')).toHaveCount(0)
  await save()
  await point(1).click(); await symbol.click({ modifiers: ['Meta'] }); await symbol.click({ button: 'right' })
  await expect(menu.getByRole('button')).toHaveCount(2)
  await menu.getByRole('button', { name: 'Убрать выбранные объекты (2)', exact: true }).click()
  await expect(symbol).toHaveCount(0); await expect(dimension).toHaveCount(0); await expect(dialog.locator('[data-scheme-point]')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await page.getByRole('dialog', { name: /^Отменить изменения/ }).getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await expect(symbol).toHaveCount(1); await expect(dimension).toHaveCount(1); await expect(dialog.locator('[data-scheme-point]')).toHaveCount(2)
  await symbol.hover(); await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('refined-editor.png') })
  expect(errors).toEqual([])
})
