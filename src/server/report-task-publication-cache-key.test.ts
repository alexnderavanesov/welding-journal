import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import { getReportTaskPublicationCacheIdentity } from './report-task-publication-cache-key'

const mocks = vi.hoisted(() => ({ requireDb: vi.fn(), execute: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: mocks.requireDb }))

const publication = {
  activeComputedRevision: 17,
  activeComputedAt: '2026-10-14T09:00:00.123456Z',
  backgroundComputedSourceRevision: 17,
  backgroundComputedAt: '2026-10-14T09:01:00.123456Z',
  backgroundStatus: 'idle',
  backgroundUpdatedAt: '2026-10-14T09:01:00.123456Z',
}
const taskFilters = { __dispatcherTaskFilter: '{"mode":"codes","codes":["СП-02"]}' }
type FilterRequest = { filters?: Record<string, string>; fieldKey?: string }
const unrelatedRequests: FilterRequest[] = [
  { filters: undefined, fieldKey: undefined },
  { filters: {}, fieldKey: 'line' },
  { filters: { search: 'СП-02', line: '=L1' }, fieldKey: undefined },
  { filters: { dispatcherTasks: '  ', __dispatcherTaskFilter: '\n' }, fieldKey: 'finalStatus' },
]
const dependentRequests: FilterRequest[] = [
  { filters: { dispatcherTasks: 'СП-02' }, fieldKey: undefined },
  { filters: taskFilters, fieldKey: undefined },
  { filters: {}, fieldKey: 'dispatcherTasks' },
  { filters: { ...taskFilters, dispatcherTasks: 'СП-02' }, fieldKey: 'dispatcherTasks' },
]

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireDb.mockReturnValue({ execute: mocks.execute })
  mocks.execute.mockResolvedValue({ rows: [{ ...publication }] })
})

describe('report task publication cache identity', () => {
  it.each(unrelatedRequests)('does no database work for an unrelated request %j', async ({ filters, fieldKey }) => {
    expect(await getReportTaskPublicationCacheIdentity(filters, fieldKey)).toEqual({})
    expect(mocks.requireDb).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each(dependentRequests)('reads both compact singleton states in one read-only statement for %j', async ({ filters, fieldKey }) => {
    expect(await getReportTaskPublicationCacheIdentity(filters, fieldKey)).toEqual({ taskPublication: publication })
    expect(mocks.requireDb).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql.trim()).toMatch(/^select\b/i)
    expect(query.sql).toContain('from (values (1))')
    expect(query.sql).toContain('left join "dispatcher_task_index_state"')
    expect(query.sql).toContain('left join "dispatcher_background_task_index_state"')
    expect(query.params).toEqual([1, 1])
    expect(query.sql).not.toMatch(/\b(insert|update|delete|count|sum)\b/i)
    expect(query.sql).not.toMatch(/"(weld_joints|dispatcher_row_tasks|dispatcher_background_row_tasks|repeated_tasks|dirty_scopes)"/)
    expect(query.sql.match(/to_char\(/g)).toHaveLength(3)
    expect(query.sql.match(/at time zone 'UTC'/g)).toHaveLength(3)
    expect(query.sql).toContain('SS.US')
  })

  it.each([
    ['activeComputedRevision', 18],
    ['activeComputedAt', '2026-10-14T09:00:00.123457Z'],
    ['backgroundComputedSourceRevision', 18],
    ['backgroundComputedAt', '2026-10-14T09:01:00.123457Z'],
    ['backgroundStatus', 'disabled'],
    ['backgroundUpdatedAt', '2026-10-14T09:01:00.123457Z'],
  ] as const)('changes the serialized cache key when only %s changes', async (field, value) => {
    const first = await getReportTaskPublicationCacheIdentity(taskFilters)
    mocks.execute.mockResolvedValueOnce({ rows: [{ ...publication, [field]: value }] })
    const second = await getReportTaskPublicationCacheIdentity(taskFilters)
    expect(buildDerivedCalculationCacheKey('report-summary:v1', first))
      .not.toBe(buildDerivedCalculationCacheKey('report-summary:v1', second))
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })

  it('keeps equal publications stable without locally caching away later changes', async () => {
    const first = await getReportTaskPublicationCacheIdentity(taskFilters)
    const second = await getReportTaskPublicationCacheIdentity(taskFilters)
    expect(buildDerivedCalculationCacheKey('report-summary:v1', second))
      .toBe(buildDerivedCalculationCacheKey('report-summary:v1', first))
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })

  it('distinguishes absent state from an existing but unpublished index without initializing either', async () => {
    const absent = Object.fromEntries(Object.keys(publication).map(key => [key, null]))
    mocks.execute.mockResolvedValueOnce({ rows: [absent] })
    const first = await getReportTaskPublicationCacheIdentity(taskFilters)
    expect(first).toEqual({ taskPublication: absent })
    mocks.execute.mockResolvedValueOnce({ rows: [{ ...absent, activeComputedRevision: -1,
      backgroundComputedSourceRevision: -1, backgroundStatus: 'disabled',
      backgroundUpdatedAt: publication.backgroundUpdatedAt }] })
    const second = await getReportTaskPublicationCacheIdentity(taskFilters)
    expect(second).not.toEqual(first)
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })

  it('does not turn a failed state read into a reusable missing-publication key', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('State read failed'))
    await expect(getReportTaskPublicationCacheIdentity(taskFilters)).rejects.toThrow('State read failed')
    mocks.execute.mockResolvedValueOnce({ rows: [] })
    await expect(getReportTaskPublicationCacheIdentity(taskFilters)).rejects.toThrow('Не удалось прочитать версии публикации')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })
})
