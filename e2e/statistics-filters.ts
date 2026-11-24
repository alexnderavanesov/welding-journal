import type { Page } from '@playwright/test'

export async function selectStatisticsProjects(page: Page, ...projects: string[]) {
  await page.getByRole('button', { name: /^Проект / }).click()
  const popup = page.getByRole('dialog', { name: 'Проект', exact: true })
  const checked = await popup.locator('label:has(input:checked)').allTextContents()
  for (const name of projects) await popup.getByRole('checkbox', { name, exact: true }).check()
  for (const name of checked) {
    if (!projects.includes(name)) await popup.getByRole('checkbox', { name, exact: true }).uncheck()
  }
  await popup.getByRole('searchbox').press('Escape')
}
