import { afterEach, describe, expect, it, vi } from 'vitest'

import { openGeneratedDocument } from '@/lib/generated-document-storage'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openGeneratedDocument', () => {
  it('reuses a window opened by the original user click', async () => {
    const previewDocument = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    }
    const previewWindow = {
      closed: false,
      document: previewDocument,
      opener: window,
    } as unknown as Window
    const windowOpen = vi.spyOn(window, 'open')

    await openGeneratedDocument(
      {
        title: 'ЖСР 1',
        fileName: 'ЖСР 1.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      async () => {
        throw new Error('Тестовая ошибка')
      },
      previewWindow,
    )

    expect(windowOpen).not.toHaveBeenCalled()
    expect(previewWindow.opener).toBeNull()
    expect(previewDocument.open).toHaveBeenCalledTimes(2)
    expect(previewDocument.write).toHaveBeenCalledTimes(2)
    expect(previewDocument.write).toHaveBeenLastCalledWith(
      expect.stringContaining('Тестовая ошибка'),
    )
  })
})
