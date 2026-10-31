import { expect, test } from '@playwright/test'
import { rpcName } from '../rpc'

// All editing below stays in browser drafts; Escape must never save it.
test('Escape cancels the top confirmation and preserves unsaved WDI cells', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name.startsWith('save')) writes.push(name) })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Расчет дюймов', exact: true }).click()
  await page.getByRole('button', { name: /^(Редактировать|Заполнить) справочник$/ }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Таблица расчета WDI', exact: true }) })
  const diameter = editor.getByLabel('Диаметр 1', { exact: true })
  await diameter.fill('123')
  await page.keyboard.press('Escape')
  const confirmation = page.getByRole('dialog', { name: 'Закрыть редактор WDI?', exact: true })
  await expect(confirmation).toBeVisible()
  await confirmation.getByText('Несохраненные изменения будут потеряны.', { exact: true }).click()
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeHidden()
  await expect(editor).toBeVisible()
  await expect(diameter).toHaveValue('123')
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Закрыть без сохранения', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(writes).toEqual([])
})
