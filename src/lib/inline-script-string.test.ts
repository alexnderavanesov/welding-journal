import { describe, expect, it } from 'vitest'

import { serializeInlineScriptString } from '@/lib/inline-script-string'

describe('serializeInlineScriptString', () => {
  it('keeps text inside an inline script string', () => {
    const value = serializeInlineScriptString('name"\\\n</script><script>alert(1)</script>')

    expect(value).not.toContain('</script>')
    expect(value).toContain('\\u003c/script>')
    expect(JSON.parse(value.replace(/\\u003c/g, '<'))).toBe(
      'name"\\\n</script><script>alert(1)</script>',
    )
  })

  it('escapes JavaScript line separators', () => {
    expect(serializeInlineScriptString(`a\u2028b\u2029c`)).toBe('"a\\u2028b\\u2029c"')
  })
})
