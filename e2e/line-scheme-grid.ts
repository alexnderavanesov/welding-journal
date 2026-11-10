import { expect, type Page } from '@playwright/test'

export async function filterSchemeProject(page: Page, project: string) {
  const registry = page.getByRole('region', { name: 'Схемы линий', exact: true })
  await registry.locator('.ag-header-cell[col-id="projectTitle"] .ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Проект', exact: true })
  await filter.getByRole('textbox', { name: 'Найти значение фильтра' }).fill(project)
  await expect(filter.getByRole('checkbox')).toHaveCount(1)
  await filter.getByRole('checkbox').check()
  await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await expect(registry.getByRole('button', { name: 'Обновить список' })).toBeEnabled()
}
