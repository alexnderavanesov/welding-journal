import { test } from '@playwright/test'
import { setupDeepOpeningFixture, cleanupDeepOpeningFixture } from '../deep-report-opening-fixture'
import { deepOpeningSafariProfile, measureDeepOpeningInSafari } from '../deep-report-opening-safari'

const enabled = process.env.DEEP_REPORT_OPENING_SAFARI === '1'
test.skip(!enabled, 'Opt-in single-session installed Safari comparison on the isolated local production runner')
test.use({ trace: 'off', video: 'off' })
test.beforeAll(async () => {
  if (!enabled) return
  deepOpeningSafariProfile()
  test.setTimeout(600_000)
  await setupDeepOpeningFixture()
})
test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(600_000)
  await cleanupDeepOpeningFixture()
})
test('installed Safari: four report families, repeat visits, grouping and reading saved records in one session', async ({}, info) => {
  test.setTimeout(1_800_000)
  await measureDeepOpeningInSafari(info)
})
