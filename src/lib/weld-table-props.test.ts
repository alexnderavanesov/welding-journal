import { describe, expect, it, vi } from 'vitest'

import type { ReportRowActionHandlers } from '@/lib/report-row-actions'
import { createWeldTableProps } from '@/lib/weld-table-props'
import { getSystemDocumentReferenceForField } from '@/lib/system-document-types'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('createWeldTableProps joint history routing', () => {
  it.each(['pstoRequest', 'heatTreatmentDiagram', 'tvmtRequest', 'tvmtConclusion'] as const)(
    'opens the cycle actually displayed in the %s cell, even after a repeat starts', field => {
      const row = { preHeatTreatmentMode: 'allPsto' as const,
        id: 1, pstoRequired: 'да', [field]: 'Первичный документ',
        systemDocumentIds: { [field]: 202 },
        pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, [field]: 'Повторный документ' }],
      } as WeldRow
      for (const report of ['weldingJournal', 'heatTreatment'] as const) {
        const onOpenDocument = vi.fn()
        const props = createWeldTableProps({ ...createOptions(report, vi.fn(), vi.fn()), onOpenDocument })
        props.onOpenDocument?.(row, field)
        const [openedRow, openedField] = onOpenDocument.mock.calls[0]
        const reference = getSystemDocumentReferenceForField(openedRow, openedField)
        expect(reference?.title).toBe(props.getDisplayValue?.(row, field))
        expect(reference?.cycleSequences).toEqual([report === 'weldingJournal' ? 1 : 2])
        expect(reference?.documentId).toBe(report === 'weldingJournal' ? undefined : 202)
      }
      expect(row.systemDocumentIds?.[field]).toBe(202)
    },
  )

  it('keeps PSTO history on the joint cell only in the heat-treatment report', () => {
    const onOpenJoint = vi.fn()
    const onOpenJointOverview = vi.fn()

    const lnkProps = createWeldTableProps(createOptions('lnk', onOpenJoint, onOpenJointOverview))
    const pstoProps = createWeldTableProps(createOptions('heatTreatment', onOpenJoint, onOpenJointOverview))

    expect(lnkProps.onOpenJoint).toBeUndefined()
    expect(lnkProps.onOpenJointOverview).toBe(onOpenJointOverview)
    expect(pstoProps.onOpenJoint).toBe(onOpenJoint)
    expect(pstoProps.onOpenJointOverview).toBe(onOpenJointOverview)
    expect(lnkProps.showBlockedEditableCellBackground).toBe(false)
    expect(pstoProps.showBlockedEditableCellBackground).toBe(true)
  })

  it('enables defect cells only for rejected results in the matching stage', () => {
    const props = createWeldTableProps(createOptions('lnk', vi.fn(), vi.fn()))
    const row = {
      id: 1,
      hasVik: 'да',
      hasUzk: 'да',
      vikResult: 'ремонт',
      uzkResult: 'годен',
      preHeatTreatmentControls: [{
        id: 10,
        weldJointId: 1,
        method: 'ПВК',
        result: 'вырез',
      }],
    }

    expect(props.isCellEditable?.(row, 'vikDefectDescription')).toBe(true)
    expect(props.isCellEditable?.(row, 'uzkDefectDescription')).toBe(false)
    expect(props.isCellEditable?.(row, 'prePvkDefectDescription')).toBe(true)
    expect(props.isCellEditable?.(row, 'preVikDefectDescription')).toBe(false)
  })
})

function createOptions(
  activeReport: 'lnk' | 'heatTreatment' | 'weldingJournal',
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
