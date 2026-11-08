import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { appSettings, preHeatTreatmentControls, pstoRepeatCycles, weldJointProgramStates } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { createWeldGroupSummarizer } from '@/lib/weld-group-summary'
import { prepareJournalPageRows } from '@/lib/use-report-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  attachHeatTreatmentControlRelations,
  attachHeatTreatmentControlRelationsInPlace,
  attachPreHeatTreatmentControlRelations,
  attachPstoRepeatCycleRelations,
} from '@/server/heat-treatment-control-relations'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'

describe('server heat-treatment relation loading', () => {
  it.each([1, 1000, 200000])('loads current-cycle history for %i document rows in one batched read', async count => {
    const query = vi.fn(async () => [{ id: 7, weldJointId: count, sequence: 2, pstoRequest: 'REPEAT' }])
    const rows = Array.from({ length: count }, (_, index) => ({ id: index + 1 }))
    const result = await attachPstoRepeatCycleRelations(rows, createRelationDb(query) as never)
    expect(query).toHaveBeenCalledTimes(1)
    expect(result.at(-1)?.pstoRepeatCycles).toEqual([expect.objectContaining({ sequence: 2, pstoRequest: 'REPEAT' })])
    expect(rows.at(-1)).not.toHaveProperty('pstoRepeatCycles')
  })
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

    expect(query).toHaveBeenCalledTimes(4) // Includes one batched stable-chain-state read.
  })

  it('keeps a 200,000-joint in-place dispatcher batch at three queries without reloading known settings', async () => {
    const query = vi.fn(async () => [])
    const db = createRelationDb(query)
    const rows = Array.from({ length: 200_000 }, (_, index) => ({ id: index + 1 }))

    const result = await attachHeatTreatmentControlRelationsInPlace(rows, db as never, DEFAULT_CONTROL_PROCESS_SETTINGS)

    expect(query).toHaveBeenCalledTimes(3)
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

  it.each(['lnk', 'heatTreatment'] as const)('reuses complete snapshot chain states without losing %s history or group facts', async report => {
    const states = [
      { weldJointId: 1, kind: 'primary', physicalRootId: 1, replacedByCoil: false },
      { weldJointId: 2, kind: 'repair', physicalRootId: 1, sourceRowId: 1, replacedByCoil: false },
    ]
    const source = [
      { id: 1, joint: 'F1', finalStatus: 'не годен', vikResult: 'ремонт', programChainState: states[0] },
      { id: 2, joint: 'F1R1', finalStatus: 'годен', vikResult: 'годен', programChainState: states[1] },
      // A checked left join can legitimately find no state for a legacy row.
      { id: 3, joint: 'F3', finalStatus: 'годен', vikResult: 'годен' },
    ].map(row => ({ preHeatTreatmentMode: 'allPsto' as const, projectTitle: 'P', subtitleCode: 'C', line: 'L', weldDate: '2026-10-01', wdi: 12.345,
      hasVik: 'да', hasRk: 'отменен', rkResult: 'ремонт', pstoRequired: 'да', pstoRequest: 'PRIMARY', pstoResult: 'проведено',
      tvmtRequest: 'TVMT', tvmtResult: 'годен', ...row })) as WeldRow[]
    const beforeControls = [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'ремонт', requestName: 'PRE-1' },
      { id: 2, weldJointId: 2, method: 'РК', result: 'ремонт', requestName: 'PRE-2' }]
    const repeats = [{ id: 1, weldJointId: 2, sequence: 2, pstoRequest: 'REPEAT-2', pstoResult: 'проведено', tvmtResult: 'годен' },
      { id: 2, weldJointId: 2, sequence: 3, pstoRequest: null, pstoResult: null, tvmtResult: null }]
    const tables: unknown[] = []
    const db = { select: () => ({ from: (table: unknown) => ({ where: () => ({ orderBy: async () => {
      tables.push(table)
      if (table === preHeatTreatmentControls) return beforeControls
      if (table === pstoRepeatCycles) return repeats
      if (table === weldJointProgramStates) return states
      if (table === appSettings) return [{ value: JSON.stringify({ preHeatTreatmentMode: 'allPsto' as const }) }]
      throw new Error('Unexpected relation table')
    } }) }) }) }
    const reference = prepareJournalPageRows(await attachHeatTreatmentControlRelations(structuredClone(source), db as never), report)
    tables.length = 0
    const owned = structuredClone(source)
    const loaded = await attachHeatTreatmentControlRelationsInPlace(owned, db as never, undefined, { programChainStatesLoaded: true })
    expect(loaded).toBe(owned)
    expect(tables).toEqual([preHeatTreatmentControls, pstoRepeatCycles, appSettings])
    expect(loaded[0].programChainState).toEqual(states[0])
    expect(loaded[2]).not.toHaveProperty('programChainState')
    expect(loaded[1].pstoRepeatCycles).toEqual(repeats)
    const prepared = prepareJournalPageRows(loaded, report)
    const summarize = (rows: WeldRow[]) => {
      const { rows: _rows, ...summary } = createWeldGroupSummarizer(rows, undefined, { lnk: report === 'lnk', heatTreatment: report === 'heatTreatment' })(rows)
      return summary
    }
    expect(summarize(prepared)).toEqual(summarize(reference))
    expect(summarize(prepared)).toMatchObject({ joints: 2, wdi: 24.7 })
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
