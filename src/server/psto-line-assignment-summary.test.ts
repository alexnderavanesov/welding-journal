import { describe, expect, it, vi } from 'vitest'

import { loadPstoLineAssignmentSummaries } from '@/server/psto-line-assignment-summary'

describe('PSTO line assignment summary query', () => {
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
      key: JSON.stringify(['Проект', 'Шифр', 'Линия 1']),
      rowCount: 102,
      assignedCount: 81,
      cancelledCount: 5,
      historyRowCount: 26,
      preControlCount: 13,
      repeatCycleCount: 3,
    }])
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
