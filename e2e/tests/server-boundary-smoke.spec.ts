import { expect, test } from '@playwright/test'

test('серверное хеширование не попадает в браузер при загрузке рабочих разделов', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /externalized|node:crypto|server.only/i.test(message.text())) errors.push(message.text())
  })
  for (const route of ['/journal', '/line-program', '/lnk', '/psto']) {
    await page.goto(route)
    await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Не удалось открыть раздел', exact: true })).toBeHidden()
  }
  expect(errors).toEqual([])
})
