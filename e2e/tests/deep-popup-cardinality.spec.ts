import { expect, test } from '@playwright/test'
import { chromePopupBrowser, safariPopupBrowser } from '../deep-popup-browser'
import { cleanupPopupCardinalityFixture, runPopupCardinality, setupPopupCardinalityFixture } from '../deep-popup-cardinality'

const chrome = process.env.DEEP_POPUP_CARDINALITY === '1'
const safari = process.env.DEEP_POPUP_CARDINALITY_SAFARI === '1'
const chromeTest = chrome ? test : test.skip, safariTest = safari ? test : test.skip
test.skip(!chrome && !safari, 'Opt-in long popup/date-tree comparison on an isolated production build')
test.use({ trace: 'off', video: 'off' })
let facts: Awaited<ReturnType<typeof setupPopupCardinalityFixture>> = []
let prepared = false
test.beforeAll(async () => {
  if (!chrome && !safari) return
  test.setTimeout(600_000)
  expect(chrome && safari, 'Run browsers sequentially with independent owned fixtures').toBe(false)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.DEEP_OPENING_DOCUMENT_COUNT).toBe('1000')
  expect([undefined, '9000']).toContain(process.env.DEEP_OPENING_JOINT_COUNT)
  prepared = true
  facts = await setupPopupCardinalityFixture()
})
test.afterAll(async () => {
  if (!prepared) return
  test.setTimeout(600_000)
  await cleanupPopupCardinalityFixture()
})
chromeTest('Chrome: local1000/remote450/date1000 and capped document200 popup DOM', async ({ page }, info) => {
  test.setTimeout(1_800_000)
  await page.setViewportSize({ width: 1600, height: 1050 })
  await runPopupCardinality(chromePopupBrowser(page), facts, info)
})
safariTest('installed Safari: same long-popup branches in one owned foreground session', async ({}, info) => {
  test.setTimeout(2_400_000)
  await runPopupCardinality(await safariPopupBrowser(info), facts, info)
})
