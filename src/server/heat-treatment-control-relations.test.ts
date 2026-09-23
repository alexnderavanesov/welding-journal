import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { preHeatTreatmentControls } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
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

  it('loads two relation families and the current setting once for the whole batch', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ id: index + 1 }))

    await attachHeatTreatmentControlRelations(rows, db as never)

    expect(query).toHaveBeenCalledTimes(3)
  })

  it('keeps a 200,000-joint in-place dispatcher batch at two queries without reloading known settings', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 200_000 }, (_, index) => ({ id: index + 1 }))

    const result = await attachHeatTreatmentControlRelationsInPlace(rows, db as never, DEFAULT_CONTROL_PROCESS_SETTINGS)

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
