import { test } from '@playwright/test'
import { copyFile } from 'node:fs/promises'
import { setupPopupFixture, cleanupPopupFixture, type PopupFact } from '../deep-popup-fixture'
import { chromePopupBrowser, safariPopupBrowser } from '../deep-popup-browser'
import { runPopupScenarios } from '../deep-popup-scenarios'

const chrome = process.env.DEEP_PRIORITY_POPUP === '1'
const safari = process.env.DEEP_PRIORITY_POPUP_SAFARI === '1'
const chromeTest = chrome ? test : test.skip
const safariTest = safari ? test : test.skip
test.skip(!chrome && !safari, 'Opt-in priority column popup matrix; isolated local production runner only')
test.use({ trace: 'off', video: 'off' })
let facts: PopupFact[] = []
test.beforeAll(async () => {
  if (!chrome && !safari) return
  test.setTimeout(600_000)
  facts = await setupPopupFixture()
})
test.afterAll(async () => {
  if (!chrome && !safari) return
  test.setTimeout(600_000)
  await cleanupPopupFixture()
})
chromeTest(process.env.DEEP_POPUP_FOUND_RECHECK === '1'
  ? 'Chrome: Select Found recheck, six fields and natural cache expiry'
  : 'Chrome: six actual column popups, independent identities, grouping and combined filters', async ({ page }, info) => {
  test.setTimeout(2_400_000)
  await page.setViewportSize({ width: 1600, height: 1050 })
  try {
    await runPopupScenarios(chromePopupBrowser(page), facts, info)
  } finally {
    if (process.env.DEEP_POPUP_FOUND_RECHECK === '1') {
      const counts = process.env.AUDIT_SQL_COUNTS_FILE
      if (!counts?.endsWith('/counts.json')) throw new Error('Recheck requires the isolated audit runner')
      await copyFile(counts.replace(/counts\.json$/, 'joint-facet-trace.json'), info.outputPath('found-recheck-facet-trace.json'))
      await copyFile(counts, info.outputPath('found-recheck-sql-counts.json'))
    }
  }
})
safariTest('installed Safari: same six popup paths in one owned foreground session', async ({}, info) => {
  test.setTimeout(3_600_000)
  await runPopupScenarios(await safariPopupBrowser(info), facts, info)
})
