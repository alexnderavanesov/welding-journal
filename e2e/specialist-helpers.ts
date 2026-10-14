import type { Locator } from '@playwright/test'

export async function chooseSpecialist(picker: Locator, value: number | string | null | undefined) {
  if (await picker.getAttribute('aria-expanded') !== 'true') await picker.click()
  const list = picker.page().getByRole('listbox', { name: (await picker.getAttribute('aria-label'))!, exact: true })
  if (value === undefined || value === 'keep') await list.getByRole('option', { name: 'Не изменять', exact: true }).click()
  else if (value === '' || value === null) await list.getByRole('option', { name: /^(Очистить назначение|Не назначен)$/ }).click()
  else await list.locator(`[role="option"][data-specialist-id="${Number(value)}"]`).click()
}
