import { expect, test, type Locator } from '@playwright/test'

async function expectSoftAction(button: Locator) {
  await expect(button).toBeVisible()
  await expect(button).toHaveCSS('background-color', 'rgb(240, 249, 255)')
  await expect(button).toHaveCSS('color', 'rgb(3, 105, 161)')
  await expect(button).toHaveCSS('border-radius', '12px')
  expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
}

test('мягкие кнопки: разделы, диалоги, клавиатура и недоступные действия', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  const createJoint = page.getByRole('button', { name: 'Новый стык', exact: true })
  await expectSoftAction(createJoint)
  await expect(createJoint.locator('svg')).toHaveCSS('stroke-width', '1.5px')
  await createJoint.hover()
  await expect(createJoint).toHaveCSS('background-color', 'rgb(224, 242, 254)')
  await page.mouse.move(0, 0)
  await page.keyboard.press('Tab')
  await createJoint.focus()
  expect(await createJoint.evaluate(el => el.matches(':focus-visible'))).toBe(true)
  await expect(createJoint).not.toHaveCSS('box-shadow', 'none')
  await page.screenshot({ path: 'outputs/buttons-soft-journal.png' })
  await createJoint.press('Enter')
  const editor = page.getByRole('dialog')
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toHaveClass(/bg-sky-50/)
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(editor).toBeHidden()

  await page.goto('/line-program')
  const newLine = page.getByRole('button', { name: 'Новая линия', exact: true })
  for (const width of [1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expectSoftAction(newLine)
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await newLine.click()
  await page.mouse.move(0, 0)
  await expectSoftAction(page.getByRole('button', { name: 'Сохранить программу', exact: true }))
  await page.screenshot({ path: 'outputs/buttons-soft-line-editor.png' })
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click()

  // Workflow menus retain their soft emphasis and their existing behavior.
  for (const path of ['/psto', '/lnk']) {
    await page.goto(path)
    const request = page.getByRole('button', { name: 'Заявка', exact: true })
    await expectSoftAction(request)
    await request.click()
    await expect(page.getByRole('button', { name: 'Новая заявка', exact: true })).toBeVisible()
    await request.click()
  }

  await page.goto('/welder-stamps')
  await expectSoftAction(page.getByRole('button', { name: 'Добавить клеймо', exact: true }))
  await page.goto('/documents')
  const generation = page.getByRole('tab', { name: 'Формирование', exact: true })
  await generation.click()
  await page.mouse.move(0, 0)
  await expect(generation).toHaveAttribute('aria-selected', 'true')
  await expectSoftAction(generation)
  await expect(page.getByRole('button', { name: /^Сформировать/ })).toHaveClass(/bg-sky-50/)
  await page.screenshot({ path: 'outputs/buttons-soft-documents.png' })

  await page.goto('/settings')
  const settingsTab = page.getByRole('button', { name: 'Системные индексы', exact: true })
  await settingsTab.click()
  await page.mouse.move(0, 0)
  await expect(settingsTab).toHaveCSS('background-color', 'rgb(240, 249, 255)')
  const saveSettings = page.getByRole('button', { name: 'Сохранить настройки', exact: true })
  await expect(saveSettings).toBeDisabled()
  await expect(saveSettings).toHaveCSS('background-color', 'rgb(241, 245, 249)')
  await expect(saveSettings).toHaveCSS('opacity', '0.5')
  await page.screenshot({ path: 'outputs/buttons-soft-settings.png' })
  expect(errors).toEqual([])
})
