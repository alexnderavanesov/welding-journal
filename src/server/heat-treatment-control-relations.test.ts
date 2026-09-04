import { describe, expect, it, vi } from 'vitest'

import {
  attachHeatTreatmentControlRelations,
  attachPreHeatTreatmentControlRelations,
} from '@/server/heat-treatment-control-relations'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'

describe('server heat-treatment relation loading', () => {
  it('loads pre-TO controls in bounded chunks instead of one query per weld', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 2_001 }, (_, index) => ({ id: index + 1 }))

    await attachPreHeatTreatmentControlRelations(rows, db as never)

    expect(query).toHaveBeenCalledTimes(3)
  })

  it('keeps the full relation loader at two query families per chunk', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ id: index + 1 }))

    await attachHeatTreatmentControlRelations(rows, db as never)

    expect(query).toHaveBeenCalledTimes(4)
  })

  it('loads duplicate controls in bounded chunks for production-sized selections', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 2_001 }, (_, index) => ({ id: index + 1 }))

    await attachDuplicateControlRelations(rows, db as never)

    expect(query).toHaveBeenCalledTimes(3)
  })
})

function createRelationDb(query: () => Promise<unknown[]>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: query,
        }),
      }),
    }),
  }
}
