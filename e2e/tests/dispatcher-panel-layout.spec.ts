import { expect, test, type Locator, type Request } from '@playwright/test'
import { rpcName } from '../rpc'

async function waitForStablePanelGeometry(panel: Locator) {
  let previous: string | null = null
  await expect.poll(async () => {
    const current = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect()
      // A viewport breakpoint animates the workspace padding. Only inspect
      // the panel and its ancestors; descendant loading spinners may never stop.
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.getAnimations().some(animation => animation.pending || animation.playState === 'running')) return null
      }
      return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    })
    const stable = current !== null && current === previous
    previous = current
    return stable
  }).toBe(true)
}

for (const path of ['/journal', '/lnk', '/psto']) {
  test(`${path}: диспетчер свернут по умолчанию, кнопки не сдвигаются при раскрытии`, async ({ page }) => {
    const errors: string[] = []
    const rpcCalls: string[] = []
    const pendingRpc = new Set<Request>()
    let lastRpc = 0
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => { if (request.url().includes('/_serverFn/')) { lastRpc = Date.now(); rpcCalls.push(rpcName(request.url())); pendingRpc.add(request) } })
    const settled = (request: Request) => { if (pendingRpc.delete(request)) lastRpc = Date.now() }
    page.on('requestfinished', settled)
    page.on('requestfailed', settled)
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
    // Publication schedules journal refresh after 80ms; the other reports
    // coalesce mutations for 500ms. An empty in-flight set between those
    // stages is not a settled startup and must not enter the toggle measure.
    await expect.poll(() => pendingRpc.size === 0 && Date.now() - lastRpc > 600).toBe(true)
    expect(rpcCalls.filter(name => name.startsWith('getDispatcherTaskSnapshot_'))).toHaveLength(1)
    expect(rpcCalls.filter(name => name.startsWith('refreshDispatcherTaskSnapshot_')).length).toBeLessThanOrEqual(1)
    expect(rpcCalls.filter(name => /^(?:readJournalGrid|list(?:LnkReport|HeatTreatmentReport)Page)_/.test(name)).length).toBeLessThanOrEqual(2)
    const beforeToggleRequests = [...rpcCalls]

    for (const width of [1600, 1000]) {
      await page.setViewportSize({ width, height: 1000 })
      await waitForStablePanelGeometry(panel)
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
