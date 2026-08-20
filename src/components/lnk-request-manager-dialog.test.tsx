import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkRequestManagerDialog } from '@/components/lnk-request-manager-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkRequestExtensionOption } from '@/lib/lnk-request-extension'
import { LNK_METHODS } from '@/lib/lnk-report-config'

const openRequest: LnkRequestExtensionOption = {
  key: '["Заявка-001","2026-08-14"]',
  name: 'Заявка-001',
  date: '2026-08-14',
  label: 'Заявка-001 · 14.08.2026',
  rowCount: 1,
  positionCount: 1,
  methodCodes: ['ВИК'],
  searchText: 'линия-1 f1',
  disabledReason: null,
}

const fixedRequest: LnkRequestExtensionOption = {
  key: '["Заявка-002","2026-08-15"]',
  name: 'Заявка-002',
  date: '2026-08-15',
  label: 'Заявка-002 · 15.08.2026',
  rowCount: 1,
  positionCount: 1,
  methodCodes: ['РК'],
  searchText: 'линия-2 f2',
  disabledReason: 'Заявка закрыта для дополнения: уже внесен результат или заключение.',
}

function renderDialog(overrides: Partial<Parameters<typeof LnkRequestManagerDialog>[0]> = {}) {
  const onAddPositions = vi.fn()
  const onChangeRequest = vi.fn()
  const row = {
    id: 1,
    joint: 'F1',
    line: 'Линия-1',
    vikRequest: openRequest.name,
    vikRequestDate: openRequest.date,
  } as WeldRow

  render(
    <LnkRequestManagerDialog
      requestName={openRequest.name}
      requestDate={openRequest.date}
      requestOptions={[openRequest, fixedRequest]}
      requestRows={[row]}
      requestMethods={[LNK_METHODS[0]]}
      requestNameDraft={openRequest.name}
      isManagerPending={false}
      isCorrectionPending={false}
      canOpenDocument
      onClose={vi.fn()}
      onChangeRequest={onChangeRequest}
      onCreateRequest={vi.fn()}
      onAddPositions={onAddPositions}
      onOpenRows={vi.fn()}
      onOpenDocument={vi.fn()}
      onRequestNameDraftChange={vi.fn()}
      onRenameRequest={vi.fn()}
      onClearPosition={vi.fn()}
      onDeleteRequest={vi.fn()}
      {...overrides}
    />,
  )

  return { onAddPositions, onChangeRequest }
}

describe('LnkRequestManagerDialog', () => {
  it('opens add-position flow for the exact selected request', () => {
    const { onAddPositions } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить позиции' }))

    expect(onAddPositions).toHaveBeenCalledWith(openRequest)
  })

  it('filters the registry by status and opens the chosen request', () => {
    const { onChangeRequest } = renderDialog()
    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveClass('h-[92vh]')
    expect(screen.getAllByText('Открыта').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Закрытые' }))
    expect(screen.queryByRole('button', { name: /Заявка-001/ })).not.toBeInTheDocument()
    expect(screen.getByText('Закрыта')).toBeInTheDocument()
    expect(dialog).toHaveClass('h-[92vh]')

    fireEvent.click(screen.getByRole('button', { name: /Заявка-002/ }))
    expect(onChangeRequest).toHaveBeenCalledWith(fixedRequest)
  })

  it('searches by a joint or line included in the request', () => {
    renderDialog()

    fireEvent.change(screen.getByPlaceholderText('Название, дата, стык или линия'), {
      target: { value: 'линия-2' },
    })

    expect(screen.queryByRole('button', { name: /Заявка-001/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Заявка-002/ })).toBeInTheDocument()
  })

  it('blocks removing a completed position and deleting its whole request', () => {
    const vikMethod = LNK_METHODS.find((method) => method.code === 'ВИК')!
    const rkMethod = LNK_METHODS.find((method) => method.code === 'РК')!
    const row = {
      id: 2,
      joint: 'F2',
      line: 'Линия-2',
      vikRequest: fixedRequest.name,
      vikRequestDate: fixedRequest.date,
      vikResult: 'ожидает НК',
      rkRequest: fixedRequest.name,
      rkRequestDate: fixedRequest.date,
      rkResult: 'годен',
    } as WeldRow

    renderDialog({
      requestName: fixedRequest.name,
      requestDate: fixedRequest.date,
      requestRows: [row],
      requestMethods: [vikMethod, rkMethod],
      requestNameDraft: fixedRequest.name,
    })

    expect(screen.getByRole('button', { name: 'ВИК' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'РК' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Дополнительные действия с заявкой' }))
    expect(screen.getByRole('button', { name: 'Удалить выбранную заявку' })).toBeDisabled()
    expect(screen.getByText(/Удаление недоступно: по стыку F2, РК/)).toBeInTheDocument()
  })

  it('allows removing one pending position without affecting the request actions', () => {
    const onClearPosition = vi.fn()
    renderDialog({ onClearPosition })

    fireEvent.click(screen.getByRole('button', { name: 'ВИК' }))

    expect(onClearPosition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'vikRequest',
    )
  })
})
