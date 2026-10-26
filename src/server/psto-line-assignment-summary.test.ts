import { describe, expect, it, vi } from 'vitest'

import {
  loadPstoLineAssignmentSummaries,
  loadPstoLineAssignmentSummaryPage,
  loadPstoLineFilterOptions,
  normalizePstoLineAssignmentPageRequest,
} from '@/server/psto-line-assignment-summary'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import { PgDialect } from 'drizzle-orm/pg-core'

describe('PSTO line assignment summary query', () => {
  it('counts the legacy replacement value as an active assignment', () => {
    expect(CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES).toContain('замена рк/узк')
  })

  it('returns normalized line summaries from one database query', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{
        projectTitle: ' Проект ',
        subtitleCode: ' Шифр ',
        line: ' Линия 1 ',
        rowCount: '100',
        assignedCount: 80,
        cancelledCount: '5',
        historyRowCount: 25,
        preControlCount: '12',
        repeatCycleCount: 3,
      }, {
        projectTitle: 'Проект',
        subtitleCode: 'Шифр',
        line: '\tЛиния 1\t',
        rowCount: 2,
        assignedCount: 1,
        cancelledCount: 0,
        historyRowCount: 1,
        preControlCount: 1,
        repeatCycleCount: 0,
      }],
    })

    await expect(loadPstoLineAssignmentSummaries({ execute } as never)).resolves.toEqual([{
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия 1',
      key: getPstoLineIdentityKey({
        projectTitle: 'Проект',
        subtitleCode: 'Шифр',
        line: 'Линия 1',
      }),
      rowCount: 102,
      assignedCount: 81,
      cancelledCount: 5,
      historyRowCount: 26,
      removalHistoryRowCount: 0,
      preControlCount: 13,
      repeatCycleCount: 3,
    }])
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('normalizes bounded server pagination and supported filters', () => {
    expect(normalizePstoLineAssignmentPageRequest({
      search: `  ${'x'.repeat(250)}  `,
      filter: 'partial',
      page: -7,
      pageSize: 10_000,
    })).toEqual({
      search: 'x'.repeat(200),
      filters: {},
      filter: 'partial',
      page: 1,
      pageSize: 25,
    })
  })

  it('applies combined column filters before pagination in one database snapshot', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    await loadPstoLineAssignmentSummaryPage({ execute } as never, { page: 2, filters: { line: "X' OR true --", programState: buildWeldColumnValueFilter(['Назначена']) } })
    expect(execute).toHaveBeenCalledOnce()
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.params).toContain("X' OR true --")
    expect(query.sql).not.toContain("X' OR true --")
    expect(query.params).toContainEqual(['Назначена'])
    expect(query.sql.indexOf('where true and')).toBeLessThan(query.sql.indexOf('limit'))
  })

  it('facet search retains other filters, excludes its own and bounds returned values', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: Array.from({ length: 151 }, (_, i) => ({ value: `L${i}`, count: 1 })) })
    const result = await loadPstoLineFilterOptions({ execute } as never, { filters: { line: 'OLD', projectTitle: 'PROJECT' } }, 'line', 'MATCH', 150)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.params).not.toContain('OLD')
    expect(query.params).toEqual(expect.arrayContaining(['PROJECT', 'MATCH', 150]))
    expect(query.sql).toContain('group by 1 order by 1')
    expect(result.options).toHaveLength(150)
    expect(result.next).toBe(150 + 150)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('returns one bounded page with global status counters', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{
        rows: [{
          projectTitle: 'Проект',
          subtitleCode: 'Шифр',
          line: 'Линия 1',
          rowCount: 100,
          assignedCount: 80,
          cancelledCount: 5,
          historyRowCount: 25,
          preControlCount: 12,
          repeatCycleCount: 3,
        }],
        totalCount: 41,
        allCount: 120,
        assignedCount: 20,
        cancelledCount: 10,
        unassignedCount: 70,
        partialCount: 20,
        page: 2,
      }],
    })

    await expect(loadPstoLineAssignmentSummaryPage({ execute } as never, {
      search: 'Линия',
      filter: 'partial',
      page: 2,
      pageSize: 25,
    })).resolves.toEqual({
      rows: [{
        projectTitle: 'Проект',
        subtitleCode: 'Шифр',
        line: 'Линия 1',
        key: getPstoLineIdentityKey({
          projectTitle: 'Проект',
          subtitleCode: 'Шифр',
          line: 'Линия 1',
        }),
        rowCount: 100,
        assignedCount: 80,
        cancelledCount: 5,
        historyRowCount: 25,
        removalHistoryRowCount: 0,
        preControlCount: 12,
        repeatCycleCount: 3,
      }],
      totalCount: 41,
      page: 2,
      pageSize: 25,
      pageCount: 2,
      counts: {
        all: 120,
        assigned: 20,
        cancelled: 10,
        unassigned: 70,
        partial: 20,
      },
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
