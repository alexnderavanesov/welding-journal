import { describe, expect, it, vi } from 'vitest'

import type { ReportRowActionHandlers } from '@/lib/report-row-actions'
import { createWeldTableProps } from '@/lib/weld-table-props'

describe('createWeldTableProps joint history routing', () => {
  it('keeps PSTO history on the joint cell only in the heat-treatment report', () => {
    const onOpenJoint = vi.fn()
    const onOpenJointOverview = vi.fn()

    const lnkProps = createWeldTableProps(createOptions('lnk', onOpenJoint, onOpenJointOverview))
    const pstoProps = createWeldTableProps(createOptions('heatTreatment', onOpenJoint, onOpenJointOverview))

    expect(lnkProps.onOpenJoint).toBeUndefined()
    expect(lnkProps.onOpenJointOverview).toBe(onOpenJointOverview)
    expect(pstoProps.onOpenJoint).toBe(onOpenJoint)
    expect(pstoProps.onOpenJointOverview).toBe(onOpenJointOverview)
  })
})

function createOptions(
  activeReport: 'lnk' | 'heatTreatment',
  onOpenJoint: () => void,
  onOpenJointOverview: () => void,
): Parameters<typeof createWeldTableProps>[0] {
  return {
    activeReport,
    rows: [],
    columnFilters: {},
    onColumnFiltersChange: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    stickyLeft: 0,
    highlightedRowIds: new Set(),
    highlightedCellKeys: new Set(),
    onOpenChain: vi.fn(),
    onFilterLine: vi.fn(),
    onOpenLinkedReport: vi.fn(),
    onOpenJoint,
    onOpenJointOverview,
    onOpenDuplicateControl: vi.fn(),
    rowActionHandlers: {} as ReportRowActionHandlers,
  }
}
