import { describe, expect, it, vi } from 'vitest'

import {
  loadPstoLineAssignmentSummaries,
  loadPstoLineAssignmentSummaryPage,
  normalizePstoLineAssignmentPageRequest,
} from '@/server/psto-line-assignment-summary'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'

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
      filter: 'partial',
      page: 1,
      pageSize: 25,
    })
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
