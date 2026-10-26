import { expect, test } from '@playwright/test'
test('owned test process lifecycle', async () => {
  console.log('LIFECYCLE_READY')
  if (process.env.LIFECYCLE_MODE?.startsWith('interrupt')) await new Promise(() => {})
  expect(process.env.LIFECYCLE_MODE).not.toBe('failure')
})
