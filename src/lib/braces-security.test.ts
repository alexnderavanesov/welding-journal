import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const braces = require('braces')

it.each(['compile', 'expand', 'stringify', 'parse'])('%s rejects deep braces/parentheses with a bounded syntax error, not stack exhaustion', method => {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const pattern = open.repeat(4990) + 'a,b' + close.repeat(4990)
    expect(() => braces[method](pattern)).toThrow('nesting exceeds the safety limit')
    try { braces[method](pattern) } catch (error) { expect(error).toBeInstanceOf(SyntaxError) }
  }
})

it.each(['compile', 'expand', 'stringify'])('%s also guards caller-supplied deep ASTs', method => {
  let node: { type: string; nodes?: unknown[]; value?: string } = { type: 'text', value: 'a' }
  for (let i = 0; i < 5000; i++) node = { type: 'root', nodes: [node] }
  expect(() => braces[method](node)).toThrow('nesting exceeds the safety limit')
})

it('preserves normal glob semantics, ranges, quoting, escaping and shallow nested ASTs', () => {
  expect(braces.expand('src/{lib,components}/*.{ts,tsx}')).toEqual(['src/lib/*.ts', 'src/lib/*.tsx', 'src/components/*.ts', 'src/components/*.tsx'])
  expect(braces.expand('{01..03}')).toEqual(['01', '02', '03'])
  expect(braces.compile('a/{b,{c,d}}/e')).toBe('a/(b|(c|d))/e')
  expect(braces.stringify(braces.parse('a/{b,c}/d'))).toBe('a/{b,c}/d')
  expect(braces.expand('\\{a,b\\}')).toEqual(['{a,b}'])
  expect(braces.expand('"{a,b}"')).toEqual(['{a,b}'])
  expect(braces.expand('{'.repeat(30) + 'a' + '}'.repeat(30))).toEqual(['{'.repeat(30) + 'a' + '}'.repeat(30)])
})
