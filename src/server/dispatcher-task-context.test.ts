import { expect, it } from 'vitest'
import { normalizeDispatcherTaskContextRequest } from './dispatcher-task-context'

it('bounds row contexts and validates revision and line pagination before any database work', () => {
  expect(normalizeDispatcherTaskContextRequest({ mode: 'rows', rowIds: [3, 1, 3], computedRevision: 9 })).toEqual({ mode: 'rows', rowIds: [1, 3], computedRevision: 9, offset: 0 })
  for (const patch of [{ rowIds: [] }, { rowIds: [0] }, { rowIds: [NaN] }, { rowIds: Array(501).fill(1) },
    { computedRevision: -1 }, { mode: 'unknown' }, { offset: 1 }, { mode: 'line', rowIds: [1, 2] }, { mode: 'line', offset: -1 }]) {
    expect(() => normalizeDispatcherTaskContextRequest({ mode: 'rows', rowIds: [1], computedRevision: 1, ...patch } as never)).toThrow()
  }
})
