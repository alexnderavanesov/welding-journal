import { describe, expect, it } from 'vitest'
import { version } from 'xlsx'

describe('SheetJS runtime', () => {
  it('uses a release that includes the parser security fixes', () => {
    const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
    expect([major, minor, patch]).toEqual([0, 20, 3])
  })
})
