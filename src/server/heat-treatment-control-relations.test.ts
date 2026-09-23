import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { preHeatTreatmentControls } from '@/db/schema'
import {
  attachHeatTreatmentControlRelations,
  attachHeatTreatmentControlRelationsInPlace,
  attachPreHeatTreatmentControlRelations,
} from '@/server/heat-treatment-control-relations'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'

describe('server heat-treatment relation loading', () => {
  it('loads pre-TO controls in one array query instead of one query per weld', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 2_001 }, (_, index) => ({ id: index + 1 }))

    await attachPreHeatTreatmentControlRelations(rows, db as never)

    expect(query).toHaveBeenCalledTimes(1)
  })

  it('keeps the full relation loader at two constant query families', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ id: index + 1 }))

    await attachHeatTreatmentControlRelations(rows, db as never)

    expect(query).toHaveBeenCalledTimes(2)
  })

  it('keeps the in-place dispatcher loader at two queries and omits empty relation arrays', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 2_001 }, (_, index) => ({ id: index + 1 }))

    const result = await attachHeatTreatmentControlRelationsInPlace(rows, db as never)

    expect(query).toHaveBeenCalledTimes(2)
    expect(result).toBe(rows)
    expect(result[0]).not.toHaveProperty('preHeatTreatmentControls')
    expect(result[0]).not.toHaveProperty('pstoRepeatCycles')
  })

  it('loads duplicate controls in one array query for production-sized selections', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 2_001 }, (_, index) => ({ id: index + 1 }))

    await attachDuplicateControlRelations(rows, db as never)

    expect(query).toHaveBeenCalledTimes(1)
  })

  it('binds every relation id as one PostgreSQL array parameter', () => {
    const rowIds = Array.from({ length: 2_001 }, (_, index) => index + 1)
    const compiled = new PgDialect().sqlToQuery(
      buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, rowIds),
    )

    expect(compiled.sql).toContain('= any($1::integer[])')
    expect(compiled.params).toEqual([rowIds])
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
