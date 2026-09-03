import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { getWeldTableBodyCellTooltip, WeldTableBodyCell } from '@/components/weld-table-body-cell'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldField } from '@/lib/weld-fields'

describe('WeldTableBodyCell LNK request link', () => {
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
      <table><tbody><tr>
        <WeldTableBodyCell
          row={row}
          field={field}
          displayValue={row.joint}
          isEditableCell={false}
          isBlockedEditableCell={false}
          isHighlightedRow={false}
          isSelectedRow={false}
          hasDispatcherTask={false}
          isHighlightedCell={false}
          isResultField={false}
          stickyLeft={0}
          stickyIdentityLeadingWidth={0}
          stickyIdentityColumns={false}
          stickyBackgroundClassName="bg-white"
          isSectionEnd={false}
          onOpenJoint={onOpenJoint}
        />
      </tr></tbody></table>,
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
      <table><tbody><tr>
        <WeldTableBodyCell
          row={row}
          field={field}
          displayValue={row.finalStatus}
          isEditableCell={false}
          isBlockedEditableCell={false}
          isHighlightedRow={false}
          isSelectedRow={false}
          hasDispatcherTask={false}
          isHighlightedCell={false}
          isResultField
          stickyLeft={0}
          stickyIdentityLeadingWidth={0}
          stickyIdentityColumns={false}
          stickyBackgroundClassName="bg-white"
          isSectionEnd={false}
          onOpenJoint={onOpenJoint}
          onOpenJointOverview={onOpenJointOverview}
        />
      </tr></tbody></table>,
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
      <table><tbody><tr>
        <WeldTableBodyCell
          row={row}
          field={field}
          displayValue={row.joint}
          isEditableCell={false}
          isBlockedEditableCell={false}
          isHighlightedRow={false}
          isSelectedRow={false}
          hasDispatcherTask={false}
          isHighlightedCell={false}
          isResultField={false}
          stickyLeft={0}
          stickyIdentityLeadingWidth={0}
          stickyIdentityColumns={false}
          stickyBackgroundClassName="bg-white"
          isSectionEnd={false}
          onOpenJoint={onOpenJoint}
          onOpenJointOverview={onOpenJointOverview}
        />
      </tr></tbody></table>,
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
      <table><tbody><tr>
        <WeldTableBodyCell
          row={row}
          field={field}
          displayValue={row.joint}
          isEditableCell
          isBlockedEditableCell={false}
          isHighlightedRow={false}
          isSelectedRow={false}
          hasDispatcherTask={false}
          isHighlightedCell={false}
          isResultField={false}
          stickyLeft={0}
          stickyIdentityLeadingWidth={0}
          stickyIdentityColumns={false}
          stickyBackgroundClassName="bg-white"
          isSectionEnd={false}
          onEdit={onEdit}
          onOpenJointOverview={onOpenJointOverview}
        />
      </tr></tbody></table>,
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
      availableSystemDocumentTypes: new Set(),
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
      <table>
        <tbody>
          <tr>
            <WeldTableBodyCell
              row={row}
              field={field}
              displayValue={row.controlBasisSummary}
              isEditableCell={false}
              isBlockedEditableCell={false}
              isHighlightedRow={false}
              isSelectedRow={false}
              hasDispatcherTask={false}
              isHighlightedCell={false}
              isResultField={false}
              stickyLeft={0}
              stickyIdentityLeadingWidth={0}
              stickyIdentityColumns={false}
              stickyBackgroundClassName="bg-white"
              isSectionEnd={false}
              onEdit={onEdit}
              controlBasisEditorEnabled
            />
          </tr>
        </tbody>
      </table>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Открыть назначения контроля для стыка S3' }))

    expect(onEdit).toHaveBeenCalledWith(row, 'controlBasisSummary')
  })

  it('opens the request card instead of guessing or opening the document preview', () => {
    const onOpenLnkRequest = vi.fn()
    const onOpenDocument = vi.fn()
    const row = {
      id: 1,
      vikRequest: 'Заявка-001',
      vikRequestDate: '2026-08-14',
    } as WeldRow
    const field = {
      key: 'vikRequest',
      dbName: 'vik_request',
      label: 'Заявка ВИК',
      kind: 'text',
      group: 'Контроль',
    } satisfies WeldField

    render(
      <table>
        <tbody>
          <tr>
            <WeldTableBodyCell
              row={row}
              field={field}
              displayValue={row.vikRequest}
              isEditableCell={false}
              isBlockedEditableCell={false}
              isHighlightedRow={false}
              isSelectedRow={false}
              hasDispatcherTask={false}
              isHighlightedCell={false}
              isResultField={false}
              stickyLeft={0}
              stickyIdentityLeadingWidth={0}
              stickyIdentityColumns={false}
              stickyBackgroundClassName="bg-white"
              isSectionEnd={false}
              onOpenDocument={onOpenDocument}
              onOpenLnkRequest={onOpenLnkRequest}
              availableSystemDocumentTypes={new Set(['lnkRequest'])}
            />
          </tr>
        </tbody>
      </table>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Заявка-001' }))

    expect(onOpenLnkRequest).toHaveBeenCalledWith(row, 'vikRequest')
    expect(onOpenDocument).not.toHaveBeenCalled()
  })

  it('opens the conclusion document in a new tab instead of the result card', () => {
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
      <table>
        <tbody>
          <tr>
            <WeldTableBodyCell
              row={row}
              field={field}
              displayValue={row.vikConclusion}
              isEditableCell={false}
              isBlockedEditableCell={false}
              isHighlightedRow={false}
              isSelectedRow={false}
              hasDispatcherTask={false}
              isHighlightedCell={false}
              isResultField={false}
              stickyLeft={0}
              stickyIdentityLeadingWidth={0}
              stickyIdentityColumns={false}
              stickyBackgroundClassName="bg-white"
              isSectionEnd={false}
              onOpenDocument={onOpenDocument}
              onOpenLnkResult={onOpenLnkResult}
              availableSystemDocumentTypes={new Set(['lnkConclusionVik'])}
            />
          </tr>
        </tbody>
      </table>,
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
      <table>
        <tbody>
          <tr>
            <WeldTableBodyCell
              row={row}
              field={field}
              displayValue={row.vikResult}
              isEditableCell={false}
              isBlockedEditableCell={false}
              isHighlightedRow={false}
              isSelectedRow={false}
              hasDispatcherTask={false}
              isHighlightedCell={false}
              isResultField
              stickyLeft={0}
              stickyIdentityLeadingWidth={0}
              stickyIdentityColumns={false}
              stickyBackgroundClassName="bg-white"
              isSectionEnd={false}
              onOpenDocument={onOpenDocument}
              onOpenLnkResult={onOpenLnkResult}
              availableSystemDocumentTypes={new Set(['lnkConclusionVik'])}
            />
          </tr>
        </tbody>
      </table>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'годен' }))

    expect(onOpenLnkResult).toHaveBeenCalledWith(row, 'vikResult')
    expect(onOpenDocument).not.toHaveBeenCalled()
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
      <table><tbody><tr>
        <WeldTableBodyCell
          row={row}
          field={field}
          displayValue={row.layeredVikDocuments}
          isEditableCell={false}
          isBlockedEditableCell={false}
          isHighlightedRow={false}
          isSelectedRow={false}
          hasDispatcherTask={false}
          isHighlightedCell={false}
          isResultField={false}
          stickyLeft={0}
          stickyIdentityLeadingWidth={0}
          stickyIdentityColumns={false}
          stickyBackgroundClassName="bg-white"
          isSectionEnd={false}
          onOpenDocument={onOpenDocument}
        />
      </tr></tbody></table>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Кромки' }))
    fireEvent.click(screen.getByRole('button', { name: 'Слои' }))
    expect(onOpenDocument).toHaveBeenNthCalledWith(1, row, 'layeredVikEdgesDocument')
    expect(onOpenDocument).toHaveBeenNthCalledWith(2, row, 'layeredVikLayersDocument')
  })
})
