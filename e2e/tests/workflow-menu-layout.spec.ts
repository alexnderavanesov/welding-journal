import { expect, test } from '@playwright/test'
import { rpcName } from '../rpc'

for (const [path, summary] of [['/lnk', 'getLnkWorkflowSummary'], ['/psto', 'getPstoWorkflowSummary']] as const) {
  test(`workflow menu ${path}: stable loading, ready, reopen and error geometry`, async ({ page }, info) => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    await page.route('**/_serverFn/**', async route => {
      if (rpcName(route.request().url()).split('_')[0] !== summary) return route.continue()
      requests += 1
      const response = await route.fetch()
      await gate
      await route.fulfill({ response })
    })
    await page.goto(path)
    const trigger = page.locator('header').getByRole('button', { name: 'Результат', exact: true })
    await trigger.click()
    const menu = page.locator('[data-workflow-menu]')
    await expect(menu.getByText('Проверяем доступность…').first()).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Внести результаты', exact: true })).toBeDisabled()
    const before = await menu.boundingBox()
    await menu.screenshot({ path: info.outputPath('menu-loading.png') })
    release()
    await expect(menu.getByText('Проверяем доступность…')).toHaveCount(0)
    expect(await menu.boundingBox()).toEqual(before)
    await menu.screenshot({ path: info.outputPath('menu-ready.png') })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await trigger.click()
    expect(await menu.boundingBox()).toEqual(before)
    expect(requests).toBe(1)
    await page.keyboard.press('Escape')

    // A failed check must never masquerade as an empty registry.
    await page.unrouteAll({ behavior: 'wait' })
    await page.route('**/_serverFn/**', route => rpcName(route.request().url()).split('_')[0] === summary
      ? route.abort('failed') : route.continue())
    await page.reload()
    await trigger.click()
    await expect(menu.getByText(/Не удалось проверить доступность/).first()).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Внести результаты', exact: true })).toBeDisabled()
    expect(await menu.boundingBox()).toEqual(before)
  })
}
