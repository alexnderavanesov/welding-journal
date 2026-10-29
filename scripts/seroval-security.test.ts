import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// Resolve the serializer actually used by the router, including pnpm's
// transitive dependency layout, rather than adding a separate direct copy.
const require = createRequire(import.meta.url)
const router = createRequire(require.resolve('@tanstack/react-router'))
const core = createRequire(router.resolve('@tanstack/router-core'))
const { serialize, deserialize } = core('seroval') as {
  serialize: (value: unknown) => string
  deserialize: (source: string) => unknown
}

describe('router serialization security', () => {
  it('escapes markup in regular expressions without changing pattern semantics', () => {
    const value = new RegExp('<(?<tag>script)>', 'gi')
    const encoded = serialize(value)
    expect(encoded).not.toContain('<')
    const restored = deserialize(encoded) as RegExp
    expect(restored.source).toBe(value.source)
    expect(restored.flags).toBe(value.flags)
  })

  it('uses the real typed-array type despite an own constructor property', () => {
    const value = new Uint16Array([7, 1024])
    Object.defineProperty(value, 'constructor', { value: { name: 'InjectedConstructor' } })
    const encoded = serialize(value)
    expect(encoded).not.toContain('InjectedConstructor')
    const restored = deserialize(encoded) as Uint16Array
    expect(Object.prototype.toString.call(restored)).toBe('[object Uint16Array]')
    expect(Array.from(restored)).toEqual([7, 1024])
  })
})
