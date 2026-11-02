import { expect, test } from '@playwright/test'
import { setupPopupFixture, cleanupPopupFixture, type PopupFact } from '../deep-popup-fixture'
import { measureWideDateChoice } from '../deep-wide-date-choice'

const enabled = process.env.DEEP_WIDE_DATE_CHOICE === '1'
test.skip(!enabled, 'Opt-in actual-HTTP-verified LNK wide date SQL comparison on the existing 200k popup fixture')
test.use({ trace: 'off', video: 'off' })
let facts: PopupFact[] = [], setupStarted = false
test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(600000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.DEEP_POPUP_ROWS).toBe('200000')
  setupStarted = true
  facts = await setupPopupFixture()
})
test.afterAll(async () => {
  if (!setupStarted) return
  test.setTimeout(600000)
  await cleanupPopupFixture()
})
test('LNK broad date choice: actual production HTTP SQL, frozen historical variants and plans', async ({ page }, info) => {
  test.setTimeout(900000)
  await measureWideDateChoice(page, facts, info)
})
