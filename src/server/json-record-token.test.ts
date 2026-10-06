import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { hashJsonRecordTuple } from './json-record-token'

it.each([
  [], [null, undefined, []], [42, 'кириллица, ] [ " \\ \n', true, false],
  [new Date('2026-10-02T10:00:00Z'), [{ id: 1, note: '\ud800', missing: undefined }, { id: 2 }], { mode: 'restore' }],
  [[[{ id: 1 }, { rootId: 1 }], [{ id: 2 }, null]], [undefined, null, NaN, Infinity]],
])('retains exact JSON tuple bytes: %j', (...parts) => {
  // it.each spreads each table row; reconstruct the original tuple.
  expect(hashJsonRecordTuple(parts)).toBe(createHash('sha256').update(JSON.stringify(parts)).digest('hex'))
})

it('retains null placeholders in sparse tuples and record arrays', () => {
  const parts = new Array<unknown>(3)
  parts[1] = new Array(2)
  expect(hashJsonRecordTuple(parts)).toBe(createHash('sha256').update(JSON.stringify(parts)).digest('hex'))
})
