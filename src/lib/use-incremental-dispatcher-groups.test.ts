import { describe, expect, it } from 'vitest'
import {
  DISPATCHER_GROUP_BATCH_SIZE,
  getNextDispatcherGroupCount,
} from '@/lib/use-incremental-dispatcher-groups'

describe('incremental dispatcher groups', () => {
  it('loads dispatcher groups in bounded batches', () => {
    expect(getNextDispatcherGroupCount(0, 1178)).toBe(DISPATCHER_GROUP_BATCH_SIZE)
    expect(getNextDispatcherGroupCount(DISPATCHER_GROUP_BATCH_SIZE, 1178)).toBe(DISPATCHER_GROUP_BATCH_SIZE * 2)
  })

  it('never exceeds the complete group count', () => {
    expect(getNextDispatcherGroupCount(1120, 1178)).toBe(1178)
    expect(getNextDispatcherGroupCount(80, 42)).toBe(42)
  })
})
