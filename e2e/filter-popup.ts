import { expect, type Locator, type Page } from '@playwright/test'

export async function resizeFilterPopup(page: Page, popup: Locator, native = false) {
  await page.waitForLoadState('networkidle')
  const before = (await popup.boundingBox())!
  const handle = popup.locator(native ? '.ag-resizer-bottomRight' : '.filter-resize-corner')
  const list = popup.locator(native ? '.ag-set-filter-list' : '.journal-filter-values, [data-filter-scroll]').first()
  const listBefore = (await list.boundingBox())!
  const grip = (await handle.boundingBox())!
  let calls = 0
  const count = (request: { url(): string }) => { if (request.url().includes('/_serverFn/')) calls++ }
  page.on('request', count)
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 140, grip.y + grip.height / 2 + 100, { steps: 16 })
  await page.mouse.up()
  await expect.poll(async () => (await popup.boundingBox())!.width).toBeGreaterThan(before.width + 120)
  await expect.poll(async () => (await popup.boundingBox())!.height).toBeGreaterThan(before.height + 80)
  const after = (await popup.boundingBox())!
  await expect.poll(async () => (await list.boundingBox())!.height).toBeGreaterThan(listBefore.height + 70)
  expect(Math.abs((await handle.boundingBox())!.y + (await handle.boundingBox())!.height - after.y - after.height)).toBeLessThan(3)
  expect(after.x).toBeGreaterThanOrEqual(11)
  expect(after.y).toBeGreaterThanOrEqual(11)
  expect(after.x + after.width).toBeLessThanOrEqual(page.viewportSize()!.width - 10)
  expect(after.y + after.height).toBeLessThanOrEqual(page.viewportSize()!.height - 10)
  expect(calls).toBe(0)
  page.off('request', count)
  return before
}
