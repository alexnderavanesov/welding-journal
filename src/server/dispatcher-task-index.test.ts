import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import {
  preHeatTreatmentControls,
  pstoRepeatCycles,
} from '@/db/schema'
import {
  getFinalStatusPersistenceChanges,
  getDispatcherTaskPublicationRevision,
  lockWeldJointWritesForDispatcherReplacement,
  mergeDispatcherTaskFilterOptionCounts,
  prepareDispatcherReportRows,
  replaceScopedDispatcherTaskIndexRows,
} from '@/server/dispatcher-task-index'
import { DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE } from '@/server/dispatcher-task-index-staging'

describe('prepareDispatcherReportRows', () => {
  it('gives a new day or calculation version a new task-page revision even without weld mutations', () => {
    expect(getDispatcherTaskPublicationRevision({ sourceRevision: 7, computedRevision: 7 })).toBe(8)
    expect(getDispatcherTaskPublicationRevision({ sourceRevision: 9, computedRevision: 7 })).toBe(9)
  })
  it('replaces a large scoped task index with bounded database requests', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const where = vi.fn().mockResolvedValue(undefined)
    const deleteRows = vi.fn(() => ({ where }))
    const rowCount = DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE * 2 + 7

    await replaceScopedDispatcherTaskIndexRows(
      { delete: deleteRows, execute } as never,
      Array.from({ length: rowCount }, (_, index) => index + 1),
      Array.from({ length: rowCount }, (_, index) => ({
        rowId: index + 1,
        taskKey: `code:ДЗ-${index % 17}`,
        code: `ДЗ-${index % 17}`,
      })),
    )

    expect(deleteRows).toHaveBeenCalledTimes(1)
    expect(where).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(5)
  })

  it('adds disjoint task counts but uses an exact union count for overlapping codes', () => {
    expect(mergeDispatcherTaskFilterOptionCounts(
      [
        { value: 'ДЗ-1', count: 10 },
        { value: 'ДЗ-2', count: 4 },
      ],
      [
        { value: 'ДЗ-2', count: 3 },
        { value: 'ДЗ-3', count: 8 },
      ],
      [{ value: 'ДЗ-2', count: 5 }],
    )).toEqual([
      { value: 'ДЗ-1', count: 10 },
      { value: 'ДЗ-2', count: 5 },
      { value: 'ДЗ-3', count: 8 },
    ])
  })

  it('persists only genuinely changed calculated final statuses', () => {
    expect(getFinalStatusPersistenceChanges(
      [
        { id: 1, finalStatus: 'ожидает заявку' },
        { id: 2, finalStatus: 'годен' },
        { id: 3, finalStatus: null },
      ],
      [
        { id: 1, finalStatus: 'годен' },
        { id: 2, finalStatus: 'годен' },
        { id: 3, finalStatus: 'ожидает НК' },
      ],
    )).toEqual([
      { id: 1, previousFinalStatus: 'ожидает заявку', finalStatus: 'годен' },
      { id: 3, previousFinalStatus: null, finalStatus: 'ожидает НК' },
    ])
  })

  it('loads pre-TO and repeat-cycle relations before building persisted dispatcher rows', async () => {
    const preControl = {
      id: 31,
      weldJointId: 7,
      method: 'ВИК',
      result: 'ожидает НК',
    }
    const repeatCycle = {
      id: 41,
      weldJointId: 7,
      sequence: 2,
      pstoResult: 'годен',
      tvmtResult: 'ожидает НК',
    }
    const select = vi.fn(() => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: async () => table === preHeatTreatmentControls
            ? [preControl]
            : table === pstoRepeatCycles
              ? [repeatCycle]
              : [],
        }),
      }),
    }))
    const tx = { select } as unknown as Parameters<typeof prepareDispatcherReportRows>[0]
    const rows = [{ id: 7, joint: 'F7', pstoRequired: 'да' }] as unknown as Parameters<
      typeof prepareDispatcherReportRows
    >[1]
    const duplicates = [{
      id: 51,
      weldJointId: 7,
      method: 'РК',
      result: 'годен',
      controlDate: '2026-08-28',
      conclusion: 'Дубль РК',
      conclusionDate: '2026-08-28',
    }] as Parameters<typeof prepareDispatcherReportRows>[2]

    const preparedRows = await prepareDispatcherReportRows(tx, rows, duplicates)

    expect(select).toHaveBeenCalledTimes(2)
    expect(preparedRows[0]?.preHeatTreatmentControls).toEqual([preControl])
    expect(preparedRows[0]?.pstoRepeatCycles).toEqual([repeatCycle])
    expect(preparedRows[0]?.duplicateControls).toHaveLength(1)
    expect(preparedRows[0]?.duplicateControls?.[0]?.conclusion).toBe('Дубль РК')
  })
})

describe('dispatcher index concurrency', () => {
  it('locks the weld parent table against writes during task-index replacement', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await lockWeldJointWritesForDispatcherReplacement({ execute } as never)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql)
      .toBe('lock table "weld_joints" in share row exclusive mode')
  })

  it('locks the welder registry before the dispatcher index', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/dispatcher-task-index.ts'), 'utf8')
    const refreshStart = source.indexOf('async function ensureDispatcherTaskIndexFreshOnce(')
    const stateReaderStart = source.indexOf('async function ensureAndReadDispatcherTaskIndexState()')
    const refreshSource = source.slice(refreshStart, stateReaderStart)
    const registryLockIndex = refreshSource.indexOf('await lockWelderStampRegistry(tx)')
    const weldWriteLockIndex = refreshSource.indexOf('await lockWeldJointWritesForDispatcherReplacement(tx)')
    const dispatcherLockIndex = refreshSource.indexOf('pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})')

    expect(registryLockIndex).toBeGreaterThanOrEqual(0)
    expect(weldWriteLockIndex).toBeGreaterThan(registryLockIndex)
    expect(dispatcherLockIndex).toBeGreaterThan(weldWriteLockIndex)
  })

  it('does the expensive full calculation before taking writer locks', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/dispatcher-task-index.ts'), 'utf8')
    const rebuildStart = source.indexOf('async function rebuildFullDispatcherTaskIndex(')
    const calculationStart = source.indexOf('await calculateFullDispatcherTasks(tx, {', rebuildStart)
    const registryLockIndex = source.indexOf('await lockWelderStampRegistry(tx)', rebuildStart)
    const backgroundLockIndex = source.indexOf('pg_advisory_xact_lock(${DISPATCHER_BACKGROUND_INDEX_LOCK_ID})', rebuildStart)
    const weldWriteLockIndex = source.indexOf('await lockWeldJointWritesForDispatcherReplacement(tx)', rebuildStart)
    const dispatcherLockIndex = source.indexOf(
      'pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})',
      rebuildStart,
    )

    expect(calculationStart).toBeGreaterThan(rebuildStart)
    expect(registryLockIndex).toBeGreaterThan(calculationStart)
    expect(backgroundLockIndex).toBeGreaterThan(registryLockIndex)
    expect(weldWriteLockIndex).toBeGreaterThan(backgroundLockIndex)
    expect(dispatcherLockIndex).toBeGreaterThan(weldWriteLockIndex)
  })

  it('does the background calculation before taking the dispatcher writer lock', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/server/dispatcher-background-task-index.ts'),
      'utf8',
    )
    const refreshStart = source.indexOf('export async function refreshDispatcherBackgroundTaskIndex(')
    const calculationStart = source.indexOf('await calculateFullDispatcherTasks(tx, {', refreshStart)
    const weldWriteLockIndex = source.indexOf('await lockWeldJointWritesForDispatcherReplacement(tx)', refreshStart)
    const dispatcherLockIndex = source.indexOf(
      'pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})',
      refreshStart,
    )

    expect(calculationStart).toBeGreaterThan(refreshStart)
    expect(weldWriteLockIndex).toBeGreaterThan(calculationStart)
    expect(dispatcherLockIndex).toBeGreaterThan(weldWriteLockIndex)
  })
})
