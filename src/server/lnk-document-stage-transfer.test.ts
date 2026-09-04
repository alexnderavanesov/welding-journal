import { describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { persistPrimaryStageRows } from '@/server/lnk-document-stage-transfer'

describe('LNK document stage transfer persistence', () => {
  it('updates several document rows with one batched database write', async () => {
    const rows = [
      { id: 1, joint: 'F1', vikRequest: 'Request-1', vikResult: 'waiting' },
      { id: 2, joint: 'F2', vikRequest: 'Request-1', vikResult: 'waiting' },
    ] as WeldRow[]
    const values = vi.fn()
    const returning = vi.fn(async () => rows)
    const builder = {
      values: (batch: unknown[]) => {
        values(batch)
        return builder
      },
      onConflictDoUpdate: () => builder,
      returning,
    }
    const insert = vi.fn(() => builder)

    const saved = await persistPrimaryStageRows({ insert } as never, rows)

    expect(insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledTimes(1)
    expect(values.mock.calls[0]?.[0]).toHaveLength(2)
    expect(returning).toHaveBeenCalledTimes(1)
    expect(saved.map((row) => row.id)).toEqual([1, 2])
  })
})
