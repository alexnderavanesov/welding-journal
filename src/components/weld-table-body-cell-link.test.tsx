import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { getWeldTableBodyCellTooltip, WeldTableBodyCell } from '@/components/weld-table-body-cell'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldField } from '@/lib/weld-fields'
import { LAYERED_CONTROL_WAITING_LABEL } from '@/lib/layered-control-documents'

describe.each([false, true])('cell workflow links (journal=%s)', journalTooltips => {
describe('WeldTableBodyCell background', () => {
  it.each(['Vik', 'Pvk'] as const)('shows a compact, non-clickable waiting state in the %s cell and removes it on cancellation', (method) => {
    const onOpenDocument = vi.fn()
    const field = { key: `layered${method}Documents`, dbName: '__layered', label: 'Послойный', kind: 'text', group: 'Документы', virtual: true } satisfies WeldField
    const draw = (row: WeldRow) => <WeldTableBodyCell journalTooltips={journalTooltips}
      row={row} field={field} displayValue="" isEditableCell={false}
      isResultField={false} onOpenDocument={onOpenDocument}
    />
    const row = { id: 42, layeredControlAssigned: true, pvkResult: 'ожидает заявку' } as WeldRow
    const { rerender } = render(draw(row))
    fireEvent.click(screen.getByText(LAYERED_CONTROL_WAITING_LABEL))
    expect(onOpenDocument).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(draw({ ...row, layeredControlAssigned: false }))
    expect(screen.queryByText(LAYERED_CONTROL_WAITING_LABEL)).not.toBeInTheDocument()
    rerender(draw({ ...row, [`layered${method}EdgesDocument`]: 'Историческое заключение', [`layered${method}EdgesDocumentId`]: 42 }))
    expect(screen.queryByText(LAYERED_CONTROL_WAITING_LABEL)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Кромки' })).toBeVisible()
  })

})

describe('WeldTableBodyCell LNK request link', () => {
  it.each(['pstoRequest', 'heatTreatmentDiagram'] as const)('opens the saved %s document without a template-availability gate', (fieldKey) => {
    const onOpenDocument = vi.fn()
    const row = { id: 1, [fieldKey]: 'ПСТО-17', systemDocumentIds: { [fieldKey]: 17 } } as WeldRow
    const field = { key: fieldKey, dbName: fieldKey, label: fieldKey, kind: 'text', group: 'Контроль' } satisfies WeldField
    const draw = (displayValue: string) => <WeldTableBodyCell journalTooltips={journalTooltips}
      row={row} field={field} displayValue={displayValue}
      isEditableCell={false} isResultField={false}
      onOpenDocument={onOpenDocument}
    />
    const { rerender } = render(draw('ПСТО-17'))
    fireEvent.click(screen.getByRole('button', { name: 'ПСТО-17' }))
    expect(onOpenDocument).toHaveBeenCalledExactlyOnceWith(row, fieldKey)
    rerender(draw(''))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens PSTO history from the joint cell when the report enables that transition', () => {
    const onOpenJoint = vi.fn()
    const row = { id: 8, joint: 'F8' } as WeldRow
    const field = {
      key: 'joint',
      dbName: 'joint',
      label: 'Стык',
      kind: 'text',
      group: 'Стык',
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row.joint}
        isEditableCell={false}
        isResultField={false}
        onOpenJoint={onOpenJoint}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'F8' }))
    expect(onOpenJoint).toHaveBeenCalledWith(row)
  })

  it('opens the complete joint picture from the calculated final status', () => {
    const onOpenJoint = vi.fn()
    const onOpenJointOverview = vi.fn()
    const row = { id: 9, joint: 'F9', finalStatus: 'ожидает НК' } as WeldRow
    const field = {
      key: 'finalStatus',
      dbName: 'final_status',
      label: 'Итоговый статус',
      kind: 'text',
      group: 'Статусы/отчетность',
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row.finalStatus}
        isEditableCell={false}
        isResultField
        onOpenJoint={onOpenJoint}
        onOpenJointOverview={onOpenJointOverview}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ожидает НК' }))
    expect(onOpenJointOverview).toHaveBeenCalledWith(row)
    expect(onOpenJoint).not.toHaveBeenCalled()
  })

  it('opens the complete joint picture from the joint number when both routes exist', () => {
    const onOpenJoint = vi.fn()
    const onOpenJointOverview = vi.fn()
    const row = { id: 10, joint: 'F10' } as WeldRow
    const field = {
      key: 'joint',
      dbName: 'joint',
      label: 'Стык',
      kind: 'text',
      group: 'Стык',
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row.joint}
        isEditableCell={false}
        isResultField={false}
        onOpenJoint={onOpenJoint}
        onOpenJointOverview={onOpenJointOverview}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'F10' }))
    expect(onOpenJointOverview).toHaveBeenCalledWith(row)
    expect(onOpenJoint).not.toHaveBeenCalled()
  })

  it('opens the safe joint picture from an editable journal joint cell', () => {
    const onEdit = vi.fn()
    const onOpenJointOverview = vi.fn()
    const row = { id: 11, joint: 'F11' } as WeldRow
    const field = {
      key: 'joint',
      dbName: 'joint',
      label: 'Стык',
      kind: 'text',
      group: 'Стык',
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row.joint}
        isEditableCell
        isResultField={false}
        onEdit={onEdit}
        onOpenJointOverview={onOpenJointOverview}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'F11' }))
    expect(onOpenJointOverview).toHaveBeenCalledWith(row)
    expect(onEdit).not.toHaveBeenCalled()
    expect(getWeldTableBodyCellTooltip({
      row,
      fieldKey: 'joint',
      displayValue: row.joint,
      isEditableCell: true,
      isBlockedEditableCell: false,
      canOpenDocument: false,
      canOpenLnkRequest: false,
      canOpenLnkResult: false,
      canOpenJointOverview: true,
      canOpenWeldEditor: true,
    })).toContain('Открыть картину')
  })

  it('opens the weld editor from the read-only control basis summary', () => {
    const onEdit = vi.fn()
    const row = {
      id: 3,
      joint: 'S3',
      controlBasisSummary: 'ВИК: ТР №1; РК: Письмо №2',
    } as WeldRow
    const field = {
      key: 'controlBasisSummary',
      dbName: '__control_basis_summary',
      label: 'Основания назначения',
      kind: 'text',
      group: 'Контроль',
      virtual: true,
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row.controlBasisSummary}
        isEditableCell={false}
        isResultField={false}
        onEdit={onEdit}
        controlBasisEditorEnabled
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Открыть назначения контроля для стыка S3' }))

    expect(onEdit).toHaveBeenCalledWith(row, 'controlBasisSummary')
  })

  it.each([
    'vikRequest', 'rkRequest', 'uzkRequest', 'pvkRequest', 'tvmtRequest',
    'preVikRequest', 'preRkRequest', 'preUzkRequest', 'prePvkRequest',
  ] as const)('opens the exact request preview for %s, including while templates are unavailable', (fieldKey) => {
    const onOpenLnkRequest = vi.fn()
    const onOpenDocument = vi.fn()
    const row = {
      id: 1,
      [fieldKey]: 'Заявка-001',
    } as WeldRow
    const field = {
      key: fieldKey,
      dbName: fieldKey,
      label: fieldKey,
      kind: 'text',
      group: 'Контроль',
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row[fieldKey]}
        isEditableCell={false}
        isResultField={false}
        onOpenDocument={onOpenDocument}
        onOpenLnkRequest={onOpenLnkRequest}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Заявка-001' }))

    expect(onOpenDocument).toHaveBeenCalledWith(row, fieldKey)
    expect(onOpenLnkRequest).not.toHaveBeenCalled()
  })

  it('opens the conclusion preview instead of the result card', () => {
    const onOpenLnkResult = vi.fn()
    const onOpenDocument = vi.fn()
    const row = {
      id: 2,
      vikRequest: 'Заявка-002',
      vikResult: 'годен',
      vikConclusion: 'ВИК-17',
    } as WeldRow
    const field = {
      key: 'vikConclusion',
      dbName: 'vik_conclusion',
      label: 'Заключение ВИК',
      kind: 'text',
      group: 'Контроль',
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row.vikConclusion}
        isEditableCell={false}
        isResultField={false}
        onOpenDocument={onOpenDocument}
        onOpenLnkResult={onOpenLnkResult}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ВИК-17' }))

    expect(onOpenDocument).toHaveBeenCalledWith(row, 'vikConclusion')
    expect(onOpenLnkResult).not.toHaveBeenCalled()
  })

  it('keeps opening the exact result card from the result value', () => {
    const onOpenLnkResult = vi.fn()
    const onOpenDocument = vi.fn()
    const row = {
      id: 2,
      vikRequest: 'Заявка-002',
      vikResult: 'годен',
      vikConclusion: 'ВИК-17',
    } as WeldRow
    const field = {
      key: 'vikResult',
      dbName: 'vik_result',
      label: 'Результат ВИК',
      kind: 'text',
      group: 'Контроль',
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row.vikResult}
        isEditableCell={false}
        isResultField
        onOpenDocument={onOpenDocument}
        onOpenLnkResult={onOpenLnkResult}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'годен' }))

    expect(onOpenLnkResult).toHaveBeenCalledWith(row, 'vikResult')
    expect(onOpenDocument).not.toHaveBeenCalled()
  })

  it('leaves rejected pre-TO defect editing to the grid instead of linking to the result card', () => {
    const onEdit = vi.fn()
    const onOpenLnkResult = vi.fn()
    const row = {
      id: 13,
      joint: 'F13',
      hasPvk: 'да',
      preHeatTreatmentControls: [{
        id: 130,
        weldJointId: 13,
        method: 'ПВК',
        result: 'вырез',
        defectDescription: 'Пора до ТО',
      }],
    } as WeldRow
    const field = {
      key: 'prePvkDefectDescription',
      dbName: '__pre_pvk_defect_description',
      label: 'Дефекты ПВК до ТО',
      kind: 'text',
      group: 'Контроль',
      virtual: true,
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue="Пора до ТО"
        isEditableCell
        isResultField={false}
        onEdit={onEdit}
        onOpenLnkResult={onOpenLnkResult}
      />,
    )

    fireEvent.click(screen.getByText('Пора до ТО'))

    // AG Grid owns double-click editing; a single click selects the cell.
    // The real edit/save flow is covered by lnk-defect-descriptions.spec.ts.
    expect(onEdit).not.toHaveBeenCalled()
    expect(onOpenLnkResult).not.toHaveBeenCalled()
  })

  it('shows two compact layered conclusions in one method cell and opens the exact document', () => {
    const onOpenDocument = vi.fn()
    const row = {
      id: 12,
      joint: 'F12',
      layeredVikEdgesDocument: 'ВИК - кромки - F12 - 01.09.2026',
      layeredVikEdgesDocumentId: 41,
      layeredVikLayersDocument: 'ВИК - слои - F12 - 01.09.2026',
      layeredVikLayersDocumentId: 42,
      layeredVikDocuments: 'Кромки\nСлои',
    } as WeldRow
    const field = {
      key: 'layeredVikDocuments',
      dbName: '__layered_vik_documents',
      label: 'Послойный ВИК',
      kind: 'text',
      group: 'Документы',
      virtual: true,
    } satisfies WeldField

    render(
      <WeldTableBodyCell journalTooltips={journalTooltips}
        row={row}
        field={field}
        displayValue={row.layeredVikDocuments}
        isEditableCell={false}
        isResultField={false}
        onOpenDocument={onOpenDocument}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Кромки' }))
    fireEvent.click(screen.getByRole('button', { name: 'Слои' }))
    expect(onOpenDocument).toHaveBeenNthCalledWith(1, row, 'layeredVikEdgesDocument')
    expect(onOpenDocument).toHaveBeenNthCalledWith(2, row, 'layeredVikLayersDocument')
  })
})

})
