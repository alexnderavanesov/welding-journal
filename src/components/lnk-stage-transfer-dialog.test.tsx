import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LnkStageTransferDialog } from '@/components/lnk-stage-transfer-dialog'
import type { LnkDocumentStageTransferPreview } from '@/lib/lnk-stage-transfer'

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  transfer: vi.fn(),
  requireEditPassword: vi.fn(),
}))

vi.mock('@/server/lnk-document-stage-transfer', () => ({
  previewLnkDocumentStageTransfer: mocks.preview,
  transferLnkDocumentStage: mocks.transfer,
}))

vi.mock('@/lib/security-context', () => ({
  useSecurityGuard: () => ({ requireEditPassword: mocks.requireEditPassword }),
}))

describe('LnkStageTransferDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reviews only selectable packages and requests the password immediately before transfer', async () => {
    const initial = makePreview()
    const review = makePreview({
      rowCount: 1,
      positionCount: 1,
      methodCodes: ['ВИК'],
      completedResultCount: 1,
      resultingSystemWarningCount: 1,
    })
    mocks.preview.mockImplementation(({ data }: { data: { positions?: unknown[] } }) =>
      Promise.resolve(data.positions ? review : initial),
    )
    mocks.requireEditPassword.mockResolvedValue(true)
    const transferResult = { preview: review, rows: [] }
    mocks.transfer.mockResolvedValue(transferResult)
    const onTransferred = vi.fn()
    const onClose = vi.fn()

    render(
      <LnkStageTransferDialog
        reference={{
          documentId: 77,
          type: 'lnkRequest',
          title: 'Заявка ВИК-1',
          date: '2026-09-01',
        }}
        onClose={onClose}
        onTransferred={onTransferred}
      />,
    )

    const available = await screen.findByRole('checkbox', { name: /F1/ })
    const blocked = screen.getByRole('checkbox', { name: /F2/ })
    expect(available).toBeChecked()
    expect(blocked).not.toBeChecked()
    expect(blocked).toBeDisabled()
    expect(mocks.requireEditPassword).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Проверить перенос' }))
    await screen.findByRole('button', { name: 'Подтвердить перенос' })
    expect(mocks.preview).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        positions: [{ rowId: 1, methodCode: 'ВИК' }],
      }),
    })
    expect(mocks.requireEditPassword).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    await waitFor(() => expect(mocks.transfer).toHaveBeenCalledTimes(1))
    expect(mocks.requireEditPassword).toHaveBeenCalledTimes(1)
    expect(mocks.transfer).toHaveBeenCalledWith({
      data: expect.objectContaining({
        positions: [{ rowId: 1, methodCode: 'ВИК' }],
        expectedVersions: initial.expectedVersions,
      }),
    })
    expect(onTransferred).toHaveBeenCalledWith(transferResult)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes with Escape before a transfer starts', async () => {
    mocks.preview.mockResolvedValue(makePreview())
    const onClose = vi.fn()

    render(
      <LnkStageTransferDialog
        reference={{
          documentId: 77,
          type: 'lnkRequest',
          title: 'Заявка ВИК-1',
          date: '2026-09-01',
        }}
        onClose={onClose}
        onTransferred={vi.fn()}
      />,
    )

    await screen.findByRole('checkbox', { name: /F1/ })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close from the header while the atomic transfer is pending', async () => {
    const preview = makePreview()
    mocks.preview.mockResolvedValue(preview)
    mocks.requireEditPassword.mockResolvedValue(true)
    let resolveTransfer: ((value: { preview: LnkDocumentStageTransferPreview; rows: [] }) => void) | undefined
    mocks.transfer.mockReturnValue(new Promise((resolve) => {
      resolveTransfer = resolve
    }))
    const onClose = vi.fn()

    render(
      <LnkStageTransferDialog
        reference={{
          documentId: 77,
          type: 'lnkRequest',
          title: 'Заявка ВИК-1',
          date: '2026-09-01',
        }}
        onClose={onClose}
        onTransferred={vi.fn()}
      />,
    )

    await screen.findByRole('checkbox', { name: /F1/ })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить перенос' }))
    await screen.findByRole('button', { name: 'Подтвердить перенос' })
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить перенос' }))
    await waitFor(() => expect(mocks.transfer).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    resolveTransfer?.({ preview, rows: [] })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})

function makePreview(
  overrides: Partial<LnkDocumentStageTransferPreview> = {},
): LnkDocumentStageTransferPreview {
  return {
    documentId: 77,
    expectedVersions: [
      { id: 1, version: 'v1' },
      { id: 2, version: 'v2' },
    ],
    sourceStage: 'primary',
    targetStage: 'beforeHeatTreatment',
    rowCount: 1,
    positionCount: 1,
    completedResultCount: 1,
    methodCodes: ['ВИК'],
    transferablePositionCount: 1,
    blockedPositionCount: 1,
    resultingSystemWarningCount: 0,
    positions: [
      {
        rowId: 1,
        methodCode: 'ВИК',
        projectTitle: 'Проект',
        subtitleCode: 'Шифр',
        line: 'Линия 1',
        joint: 'F1',
        disabledReason: null,
        source: {
          requestName: 'Заявка ВИК-1',
          requestDate: '2026-09-01',
          result: 'годен',
          conclusionDate: '2026-09-02',
          conclusionName: 'Заключение ВИК-1',
          defectDescription: 'ДНО',
          rkExposureConfirmedDiameter: null,
        },
      },
      {
        rowId: 2,
        methodCode: 'РК',
        projectTitle: 'Проект',
        subtitleCode: 'Шифр',
        line: 'Линия 1',
        joint: 'F2',
        disabledReason: 'целевой комплект РК до ТО уже заполнен.',
        source: {
          requestName: 'Заявка РК-1',
          requestDate: '2026-09-01',
          result: '',
          conclusionDate: '',
          conclusionName: '',
          defectDescription: '',
          rkExposureConfirmedDiameter: null,
        },
      },
    ],
    ...overrides,
  }
}
