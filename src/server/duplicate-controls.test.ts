import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import {
  assertDuplicateControlRepairAllowed,
  assertDuplicateControlSaveBatchLimit,
  assertDuplicateControlSelectionLimit,
  assertDuplicateControlVersion,
  buildDuplicateControlCandidateIdsQuery,
  buildDuplicateControlCandidateSearchWhere,
  getDuplicateControlAffectedWeldJointIds,
  normalizeDuplicateControlPageRequest,
  normalizeDuplicateControlDate,
  persistDuplicateControlUpdates,
  refreshWeldedFinalStatusesAfterDuplicateControlChange,
  splitDuplicateControlInsertBatches,
} from '@/server/duplicate-controls'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import {
  DUPLICATE_CONTROL_MASS_SELECTION_ERROR,
  DUPLICATE_CONTROL_MASS_SELECTION_LIMIT,
} from '@/lib/duplicate-control-types'

describe('duplicate-control affected weld joints', () => {
  it('keeps both the previous and next weld when a control is reassigned', () => {
    expect(getDuplicateControlAffectedWeldJointIds(51, 52)).toEqual([51, 52])
  })

  it('deduplicates unchanged and invalid weld ids', () => {
    expect(getDuplicateControlAffectedWeldJointIds(51, 51, 0, Number.NaN)).toEqual([51])
  })

  it('persists the current status of a welded joint before aggregate WDI can read it', async () => {
    const compiledQueries: Array<{ params: unknown[] }> = []
    const select = vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
        }),
      }),
    }))
    const execute = vi.fn(async (query: SQL) => {
      compiledQueries.push(new PgDialect().sqlToQuery(query))
      return undefined
    })
    const rows = [{
      id: 7,
      joint: 'F7',
      weldDate: '2026-09-04',
      hasVik: 'да',
      vikResult: 'годен',
      finalStatus: 'не годен по дублю',
    }] as unknown as Parameters<typeof refreshWeldedFinalStatusesAfterDuplicateControlChange>[1]

    const changed = await refreshWeldedFinalStatusesAfterDuplicateControlChange(
      { select, execute } as never,
      rows,
    )

    expect(changed).toBe(1)
    expect(select).toHaveBeenCalledTimes(4)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(compiledQueries[0]?.params).toEqual([7, 'не годен по дублю', 'годен'])
  })

  it('leaves an unwelded same-name repair to the scoped dispatcher context', async () => {
    const select = vi.fn()
    const execute = vi.fn()
    const rows = [{
      id: 8,
      joint: 'F8',
      weldDate: null,
      finalStatus: 'не годен по дублю',
    }] as unknown as Parameters<typeof refreshWeldedFinalStatusesAfterDuplicateControlChange>[1]

    const changed = await refreshWeldedFinalStatusesAfterDuplicateControlChange(
      { select, execute } as never,
      rows,
    )

    expect(changed).toBe(0)
    expect(select).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('duplicate-control bounded reads', () => {
  it('reads at most one row beyond the selection cap and rejects a broad search', () => {
    const compiled = buildDuplicateControlCandidateIdsQuery(drizzle.mock(), 'E2E-DUP').toSQL()

    expect(compiled.sql).toContain('limit $')
    expect(compiled.params.at(-1)).toBe(DUPLICATE_CONTROL_MASS_SELECTION_LIMIT + 1)
    expect(() => assertDuplicateControlSelectionLimit(DUPLICATE_CONTROL_MASS_SELECTION_LIMIT))
      .not.toThrow()
    expect(() => assertDuplicateControlSelectionLimit(DUPLICATE_CONTROL_MASS_SELECTION_LIMIT + 1))
      .toThrow(DUPLICATE_CONTROL_MASS_SELECTION_ERROR)
  })

  it('normalizes paging and limits search text before it reaches the database', () => {
    expect(normalizeDuplicateControlPageRequest(undefined)).toEqual({
      search: '',
      page: 1,
      pageSize: 100,
    })
    expect(normalizeDuplicateControlPageRequest({
      search: `  ${'я'.repeat(250)}  `,
      page: -7,
      pageSize: 777,
    })).toEqual({
      search: 'я'.repeat(200),
      page: 1,
      pageSize: 100,
    })
    expect(normalizeDuplicateControlPageRequest({ page: 3, pageSize: 500 })).toEqual({
      search: '',
      page: 3,
      pageSize: 500,
    })
  })

  it('searches only the five established identity fields and treats wildcards literally', () => {
    const query = new PgDialect().sqlToQuery(buildDuplicateControlCandidateSearchWhere('F%_1'))

    expect(query.sql.match(/ ilike /g)).toHaveLength(5)
    expect(query.sql).toContain('project_title')
    expect(query.sql).toContain('subtitle_code')
    expect(query.sql).toContain('line')
    expect(query.sql).toContain('spool')
    expect(query.sql).toContain('joint')
    expect(query.params).toEqual(Array(5).fill('%F\\%\\_1%'))
  })
})

describe('duplicate-control dates', () => {
  it('normalizes supported dates and rejects malformed or too-early dates', () => {
    expect(normalizeDuplicateControlDate('04.09.2026')).toBe('2026-09-04')
    expect(normalizeDuplicateControlDate('')).toBeNull()
    expect(() => normalizeDuplicateControlDate('31.02.2026')).toThrow('Некорректная дата')
    expect(() => normalizeDuplicateControlDate('2023-12-31')).toThrow(
      'не может быть раньше 01.01.2024',
    )
  })
})

describe('duplicate-control concurrent editing', () => {
  const row = { updatedAt: new Date('2026-09-04T10:00:00.000Z') }

  it('accepts the version that was opened by the user', () => {
    expect(() => assertDuplicateControlVersion(row, '2026-09-04T10:00:00.000Z')).not.toThrow()
  })

  it('rejects a missing or stale version', () => {
    expect(() => assertDuplicateControlVersion(row, '')).toThrow('уже изменен другим пользователем')
    expect(() => assertDuplicateControlVersion(row, '2026-09-04T09:59:59.000Z'))
      .toThrow('уже изменен другим пользователем')
  })
})

describe('duplicate-control batch writes', () => {
  it('rejects a save payload larger than the five methods for 5,000 selected joints', () => {
    expect(() => assertDuplicateControlSaveBatchLimit(25_000)).not.toThrow()
    expect(() => assertDuplicateControlSaveBatchLimit(25_001)).toThrow('Слишком много записей')
  })

  it('keeps query growth bounded for a large set of new controls', () => {
    const records = Array.from({ length: 1_201 }, (_, index) => index + 1)
    const batches = splitDuplicateControlInsertBatches(records)

    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 201])
    expect(batches.flat()).toEqual(records)
  })

  it('updates several existing controls in one insert/upsert query', async () => {
    let insertCalls = 0
    const tx = {
      insert: () => {
        insertCalls += 1
        return {
          values: (values: Array<Record<string, unknown>>) => ({
            onConflictDoUpdate: () => ({ returning: async () => values }),
          }),
        }
      },
    }
    const previous = (id: number) => ({
      id,
      weldJointId: id,
      method: 'РК',
      result: 'годен',
      controlDate: null,
      conclusion: null,
      conclusionDate: null,
      createdAt: new Date('2026-09-04T08:00:00.000Z'),
      updatedAt: new Date(`2026-09-04T09:00:0${id}.000Z`),
    })

    const updated = await persistDuplicateControlUpdates(tx as never, [1, 2].map((id, index) => ({
      index,
      previous: previous(id),
      insertData: {
        weldJointId: id,
        method: 'УЗК',
        result: 'ремонт',
      },
    })))

    expect(insertCalls).toBe(1)
    expect(updated.map(({ updated: row }) => [row.id, row.method, row.result])).toEqual([
      [1, 'УЗК', 'ремонт'],
      [2, 'УЗК', 'ремонт'],
    ])
  })
})

describe('duplicate-control repair rules', () => {
  const smallDiameterRow = {
    joint: 'F1',
    d1: 57,
    d2: 57,
  } as WeldInput

  it('enforces ZV-20 for a duplicate-control repair', () => {
    expect(() => assertDuplicateControlRepairAllowed(
      smallDiameterRow,
      { method: 'ВИК', result: 'ремонт' },
      DEFAULT_SAVE_CHECK_SETTINGS,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toThrow(/ЗВ-20.*ВИК \(дубль\)/)
  })

  it('allows the same legacy value when ZV-20 is disabled', () => {
    expect(() => assertDuplicateControlRepairAllowed(
      smallDiameterRow,
      { method: 'ВИК', result: 'ремонт' },
      { ...DEFAULT_SAVE_CHECK_SETTINGS, lnkResultRepairRules: false },
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).not.toThrow()
  })
})
