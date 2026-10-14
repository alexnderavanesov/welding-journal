import { expect, type Page } from '@playwright/test'

export function lnkResultConfirmation(page: Page) {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', {
    name: 'Подтвердить изменения результатов', exact: true,
  }) })
}

export async function confirmLnkResultChanges(page: Page) {
  const confirmation = lnkResultConfirmation(page)
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Применить изменения', exact: true }).click()
}
