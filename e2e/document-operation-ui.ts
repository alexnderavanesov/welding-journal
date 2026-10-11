import { expect, type Page } from '@playwright/test'

export async function openDocumentOperation(page: Page, names: string[], kind = 'Заявка ПСТО', action: 'split' | 'rename' | 'merge' = 'split', timeout = 15_000) {
  await page.goto('/documents')
  await page.getByRole('button', { name: kind, exact: true }).click()
  if (names.length > 100) await page.getByRole('combobox', { name: 'На странице', exact: true }).selectOption(names.length > 500 ? '1000' : '500')
  if (names.length > 100) await expect(page.getByRole('button', { name: `Выбрать документ «${names[0]}»`, exact: true })).toBeAttached({ timeout })
  const labels = await page.getByRole('button', { name: /^Выбрать документ «/ }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
  const expected = new Set(names.map(name => `Выбрать документ «${name}»`))
  const exactVisibleSelection = labels.length === names.length && labels.every(label => expected.has(label!))
  if (exactVisibleSelection) {
    const selectAll = page.getByRole('button', { name: 'Выбрать показанные документы', exact: true })
    if (await selectAll.count()) await selectAll.click()
  }
  for (const name of exactVisibleSelection ? [] : names) {
    const choice = page.getByRole('button', { name: `Выбрать документ «${name}»`, exact: true })
    await expect(choice).toBeAttached({ timeout })
    if (await choice.getAttribute('aria-pressed') !== 'true') await choice.click()
  }
  await page.getByRole('button', { name: /^Действия с документами, выбрано:/ }).click()
  await page.getByRole('button', { name: action === 'split' ? 'Изменить разделение' : action === 'merge' ? 'Объединить' : 'Переименовать', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: action === 'split' ? 'Изменить разделение' : action === 'merge' ? 'Объединить документы' : 'Переименовать документы', exact: true })
  await expect(dialog.getByRole('textbox', { name: /^Название:/ }).first()).toBeVisible({ timeout })
  return dialog
}

export async function confirmDocumentOperation(dialog: ReturnType<Page['getByRole']>, packet = 1, timeout = 15_000) {
  const apply = dialog.getByRole('button', { name: 'Подтвердить и применить', exact: true })
  await expect(apply).toBeEnabled()
  await apply.click()
  const saved = dialog.getByRole('status').filter({ hasText: `Сохранено пакетов: ${packet}` })
  // A server refusal is a result to investigate, not a four-minute slow save.
  await expect(saved.or(dialog.getByRole('alert'))).toBeVisible({ timeout })
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(saved).toBeVisible()
}
