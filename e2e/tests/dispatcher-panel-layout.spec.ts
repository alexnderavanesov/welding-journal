import { expect, test, type Request } from '@playwright/test'
import { rpcName } from '../rpc'

for (const path of ['/journal', '/lnk', '/psto']) {
  test(`${path}: диспетчер свернут по умолчанию, кнопки не сдвигаются при раскрытии`, async ({ page }) => {
    const errors: string[] = []
    const rpcCalls: string[] = []
    const pendingRpc = new Set<Request>()
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => { if (request.url().includes('/_serverFn/')) { rpcCalls.push(rpcName(request.url())); pendingRpc.add(request) } })
    page.on('requestfinished', request => pendingRpc.delete(request))
    page.on('requestfailed', request => pendingRpc.delete(request))
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const panel = page.getByLabel('Диспетчер задач', { exact: true })
    const expand = panel.getByRole('button', { name: 'Развернуть', exact: true })
    const collapse = panel.getByRole('button', { name: 'Свернуть', exact: true })
    const open = panel.getByRole('button', { name: 'Открыть диспетчер', exact: true })
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expect(panel.locator('[data-dispatcher-code-group]')).toHaveCount(0)
    await expect(open).toBeEnabled()
    // networkidle can precede hydration, and a repeated call reuses that state.
    // Wait for the actual fresh snapshot and its report invalidation instead.
    await expect(panel).toContainText('Изменения выполняются только после подтверждения.')
    await expect.poll(() => pendingRpc.size).toBe(0)
    expect(rpcCalls.filter(name => name.startsWith('getDispatcherTaskSnapshot_'))).toHaveLength(1)
    expect(rpcCalls.filter(name => name.startsWith('refreshDispatcherTaskSnapshot_')).length).toBeLessThanOrEqual(1)
    expect(rpcCalls.filter(name => /^list(WeldingJournal|LnkReport|HeatTreatmentReport)Page_/.test(name)).length).toBeLessThanOrEqual(2)
    const beforeToggleRequests = [...rpcCalls]

    for (const width of [1600, 1000]) {
      await page.setViewportSize({ width, height: 1000 })
      const collapsedButton = (await expand.boundingBox())!
      const openButton = (await open.boundingBox())!
      const panelWidth = (await panel.boundingBox())!.width
      await expand.click()
      await expect(collapse).toHaveAttribute('aria-expanded', 'true')
      await expect(panel.locator('[data-dispatcher-code-group]').first()).toBeVisible()
      const expandedButton = (await collapse.boundingBox())!
      expect(expandedButton.width).toBe(collapsedButton.width)
      expect(expandedButton.height).toBe(collapsedButton.height)
      expect(expandedButton.x).toBe(collapsedButton.x)
      expect((await open.boundingBox())!).toEqual(openButton)
      expect((await panel.boundingBox())!.width).toBe(panelWidth)
      await collapse.click()
      await expect(expand).toHaveAttribute('aria-expanded', 'false')
      await expect(panel.locator('[data-dispatcher-code-group]')).toHaveCount(0)
    }
    await page.waitForLoadState('networkidle')
    expect(rpcCalls).toEqual(beforeToggleRequests)
    await open.click()
    const workspace = page.getByRole('dialog', { name: 'Диспетчер задач' })
    await expect(workspace).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(workspace).toBeHidden()
    await expand.click()
    await page.reload()
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(errors).toEqual([])
  })
}
