import { expect, it } from 'vitest'
import type { LineProgramRecord } from '@/lib/line-program'
import { partitionLineProgramBatches } from './line-program-batches'

const programs = (count: number) => Array.from({ length: count }, (_, id) => ({ id }) as LineProgramRecord)
it('limits each working set by joint count, not by an assumed line size', () => {
  const lines = programs(1000)
  const result = partitionLineProgramBatches(lines, new Map(lines.map(line => [line.id, 200])))
  expect(result).toHaveLength(20)
  expect(result.every(batch => batch.length === 50)).toBe(true)
  expect(result.flat()).toEqual(lines)
})
it('keeps complete large lines, empty lines, order and an exact boundary', () => {
  const lines = programs(6)
  expect(partitionLineProgramBatches(lines, new Map([[0, 4000], [1, 6000], [2, 1], [3, 12000], [5, 1]])))
    .toEqual([lines.slice(0, 2), lines.slice(2, 3), lines.slice(3, 5), lines.slice(5)])
  expect(partitionLineProgramBatches([], new Map())).toEqual([])
  expect(partitionLineProgramBatches(lines, new Map())).toEqual([lines])
})
