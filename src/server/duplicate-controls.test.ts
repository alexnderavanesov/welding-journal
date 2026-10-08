import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import {
  assertDuplicateControlResultAllowed,
  assertDuplicateControlSaveBatchLimit,
  assertDuplicateControlSelectionLimit,
  assertDuplicateControlVersion,
  buildDuplicateControlCandidateIdsQuery,
  buildDuplicateControlCandidateSearchWhere,
  getDuplicateControlAffectedWeldJointIds,
  normalizeDuplicateControlPageRequest,
  normalizeDuplicateControlDate,
  persistDuplicateControlUpdates,
  prepareDuplicateControlWrite,
  refreshWeldedFinalStatusesAfterDuplicateControlChange,
  splitDuplicateControlInsertBatches,
} from '@/server/duplicate-controls'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import {
  DUPLICATE_CONTROL_MASS_SELECTION_ERROR,
  DUPLICATE_CONTROL_MASS_SELECTION_LIMIT,
  DUPLICATE_CONTROL_METHOD_ERROR,
} from '@/lib/duplicate-control-types'

describe('duplicate-control supported methods', () => {
  it.each(['годен', 'ремонт', 'вырез'] as const)('forbids any %s duplicate on an unofficial joint', result => {
    for (const method of ['ВИК', 'РК', 'УЗК', 'ПВК'] as const) {
      expect(() => assertDuplicateControlResultAllowed({ joint: 'S1', officiality: 'неофициальный', d1: 108 }, { method, result }, DEFAULT_SYSTEM_INDEX_SETTINGS))
        .toThrow('Дубль-контроль недоступен для неофициального стыка')
    }
  })
  const base = { weldJointId: 1, result: 'годен' as const, controlDate: '2026-09-01', conclusion: 'Дубль-1', conclusionDate: '2026-09-01' }
  it.each(['ВИК', 'РК', 'УЗК', 'ПВК'] as const)('accepts %s in the common single/bulk save boundary', method => {
    expect(prepareDuplicateControlWrite({ ...base, method }).method).toBe(method)
  })
  it.each(['ТВМТ', 'ПСТО'])('rejects %s for creates and edits, including stale clients', method => {
    for (const id of [undefined, 42]) {
      expect(() => prepareDuplicateControlWrite({ ...base, id, method } as Parameters<typeof prepareDuplicateControlWrite>[0])).toThrow(DUPLICATE_CONTROL_METHOD_ERROR)
    }
  })
})

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
    expect(select).toHaveBeenCalledTimes(5) // Includes stable physical-connection state.
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
  it('rejects a save payload larger than the four methods for 5,000 selected joints', () => {
    expect(() => assertDuplicateControlSaveBatchLimit(20_000)).not.toThrow()
    expect(() => assertDuplicateControlSaveBatchLimit(20_001)).toThrow('Слишком много записей')
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

describe('duplicate-control mandatory result rules', () => {
  const smallDiameterRow = {
    joint: 'F1',
    d1: 57,
    d2: 57,
  } as WeldInput

  it('enforces SP-07 for an RK duplicate-control repair', () => {
    expect(() => assertDuplicateControlResultAllowed(
      smallDiameterRow,
      { method: 'РК', result: 'ремонт' },
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toThrow(/СП-07.*РК/)
  })

  it('allows a surface repair on D57', () => {
    expect(() => assertDuplicateControlResultAllowed(
      smallDiameterRow,
      { method: 'ВИК', result: 'ремонт' },
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).not.toThrow()
  })

  it('does not extend the own-PVK good-only setting to customer duplicates', () => {
    const check = (result: 'годен' | 'ремонт', pvkGoodOnly: boolean) => assertDuplicateControlResultAllowed(
      smallDiameterRow, { method: 'ПВК', result },
      DEFAULT_SYSTEM_INDEX_SETTINGS, pvkGoodOnly,
    )
    expect(() => check('ремонт', false)).not.toThrow()
    // The agreed setting applies only to our main/pre-TO PVK, not duplicates.
    expect(() => check('ремонт', true)).not.toThrow()
    expect(() => check('годен', true)).not.toThrow()
  })

  it.each(['ВИК', 'ПВК'] as const)('rejects %s cut and third repair', method => {
    expect(() => assertDuplicateControlResultAllowed(smallDiameterRow,
      { method, result: 'вырез' },
      DEFAULT_SYSTEM_INDEX_SETTINGS)).toThrow('СП-07')
    expect(() => assertDuplicateControlResultAllowed({ ...smallDiameterRow, joint: 'F1R2' },
      { method, result: 'ремонт' },
      DEFAULT_SYSTEM_INDEX_SETTINGS)).toThrow('Третий ремонт')
  })
})
