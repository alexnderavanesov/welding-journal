import { describe, expect, it, vi } from 'vitest'

import { getJointNextActionTableColumns } from '@/lib/joint-next-action-table-column'

describe('joint next-action table column', () => {
  it.each(['weldingJournal', 'lnk', 'heatTreatment'] as const)(
    'places the next step after the joint section in %s',
    (activeReport) => {
      const columns = getJointNextActionTableColumns({
        activeReport,
        dispatcherTasks: [],
        onRunNextAction: vi.fn(),
        onOpenOverview: vi.fn(),
      })

      expect(columns).toHaveLength(1)
      expect(columns[0]).toMatchObject({
        section: 'Следующий шаг',
        insertAfterSection: 'Стык',
        collapsible: true,
      })
    },
  )
})
