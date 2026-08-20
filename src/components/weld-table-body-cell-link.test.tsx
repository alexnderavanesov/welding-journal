import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldTableBodyCell } from '@/components/weld-table-body-cell'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldField } from '@/lib/weld-fields'

describe('WeldTableBodyCell LNK request link', () => {
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

  it('opens the exact result card before the conclusion document preview', () => {
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

    expect(onOpenLnkResult).toHaveBeenCalledWith(row, 'vikConclusion')
    expect(onOpenDocument).not.toHaveBeenCalled()
  })
})
