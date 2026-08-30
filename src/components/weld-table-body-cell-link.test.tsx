import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldTableBodyCell } from '@/components/weld-table-body-cell'
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
})
