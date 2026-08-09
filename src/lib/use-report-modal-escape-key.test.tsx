import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useReportModalEscapeKey } from '@/lib/use-report-modal-escape-key'

type EscapeKeyOptions = Parameters<typeof useReportModalEscapeKey>[0]

function createOptions(overrides: Partial<EscapeKeyOptions> = {}): EscapeKeyOptions {
  return {
    isReportModalOpen: true,
    isLnkResultPreviewOpen: false,
    isPstoRequestManagerOpen: false,
    isPstoResultManagerOpen: false,
    isLnkRequestManagerOpen: false,
    isLnkResultManagerOpen: false,
    isRkExposureModalOpen: true,
    isPstoResultModalOpen: false,
    isPstoRequestModalOpen: false,
    isLnkOfficialityModalOpen: false,
    isDuplicateControlModalOpen: false,
    isLnkResultModalOpen: false,
    isLnkRequestModalOpen: false,
    isReportImportModalOpen: false,
    canClosePstoRequestManager: true,
    canClosePstoResultManager: true,
    canCloseLnkRequestManager: true,
    canCloseLnkResultManager: true,
    canCloseRkExposureModal: true,
    onCloseLnkResultPreview: vi.fn(),
    onClosePstoRequestManager: vi.fn(),
    onClosePstoResultManager: vi.fn(),
    onCloseLnkRequestManager: vi.fn(),
    onCloseLnkResultManager: vi.fn(),
    onCloseRkExposureModal: vi.fn(),
    onClosePstoResultModal: vi.fn(),
    onClosePstoRequestModal: vi.fn(),
    onCloseLnkOfficialityModal: vi.fn(),
    onCloseDuplicateControlModal: vi.fn(),
    onCloseLnkResultModal: vi.fn(),
    onCloseLnkRequestModal: vi.fn(),
    onCloseReportImportModal: vi.fn(),
    ...overrides,
  }
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
}

describe('useReportModalEscapeKey', () => {
  afterEach(() => {
    document.querySelectorAll('[data-confirm-action-dialog="true"]').forEach((node) => node.remove())
  })

  it('closes the RK exposure editor on Escape', () => {
    const onCloseRkExposureModal = vi.fn()
    const options = createOptions({ onCloseRkExposureModal })

    renderHook(() => useReportModalEscapeKey(options))
    pressEscape()

    expect(onCloseRkExposureModal).toHaveBeenCalledOnce()
  })

  it('does not close the RK exposure editor while it is saving', () => {
    const onCloseRkExposureModal = vi.fn()
    const options = createOptions({
      canCloseRkExposureModal: false,
      onCloseRkExposureModal,
    })

    renderHook(() => useReportModalEscapeKey(options))
    pressEscape()

    expect(onCloseRkExposureModal).not.toHaveBeenCalled()
  })

  it('leaves Escape for a confirmation dialog opened above the editor', () => {
    const onCloseRkExposureModal = vi.fn()
    const confirmationMarker = document.createElement('div')
    confirmationMarker.dataset.confirmActionDialog = 'true'
    document.body.append(confirmationMarker)
    const options = createOptions({ onCloseRkExposureModal })

    renderHook(() => useReportModalEscapeKey(options))
    pressEscape()

    expect(onCloseRkExposureModal).not.toHaveBeenCalled()
  })
})
