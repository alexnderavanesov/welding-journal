import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReportImportDialog } from '@/components/report-import-dialog'
import { FIELD_BY_KEY } from '@/lib/weld-fields'
import { buildReportImportPreview } from '@/lib/report-import-preview'

vi.mock('@/lib/report-import-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/report-import-preview')>()
  return {
    ...actual,
    buildReportImportPreview: vi.fn(),
  }
})

vi.mock('@/server/welds', () => ({
  listWeldingJournalImportScope: vi.fn(),
}))

const preview = {
  fileName: 'import.xlsx',
  fields: [FIELD_BY_KEY.get('joint')!],
  records: [{ joint: 'F1' }],
  validRecords: [{ joint: 'F1' }],
  errors: [],
  skippedRows: 0,
}

describe('ReportImportDialog save result', () => {
  beforeEach(() => {
    vi.mocked(buildReportImportPreview).mockResolvedValue(preview)
  })

  it('keeps the preview open and shows a server rejection', async () => {
    const onClose = vi.fn()
    const onImportRecords = vi.fn().mockRejectedValue(new Error('Импорт остановлен: строка 2. ЗВ-26.'))
    const view = renderDialog({ onClose, onImportRecords })

    await uploadPreviewFile(view.container)
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать 1 строк' }))

    expect(await screen.findByText('Сохранение не выполнено. Импорт остановлен: строка 2. ЗВ-26.')).toBeInTheDocument()
    expect(screen.getByText('Предпросмотр')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the prepared preview open when password entry is cancelled', async () => {
    const onClose = vi.fn()
    const onImportRecords = vi.fn().mockResolvedValue(false)
    const view = renderDialog({ onClose, onImportRecords })

    await uploadPreviewFile(view.container)
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать 1 строк' }))

    await waitFor(() => expect(onImportRecords).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Предпросмотр')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

function renderDialog({
  onClose,
  onImportRecords,
}: {
  onClose: () => void
  onImportRecords: () => Promise<boolean>
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportImportDialog
        open
        activeReport="weldingJournal"
        isPending={false}
        weldFormStampSelectOptions={{}}
        welderStamps={[]}
        welderStampSuspensions={[]}
        columnFilters={{}}
        onClose={onClose}
        onImportRecords={onImportRecords}
        onMassFillRecords={vi.fn().mockResolvedValue(true)}
        onReplaceDataRecords={vi.fn().mockResolvedValue(true)}
      />
    </QueryClientProvider>,
  )
}

async function uploadPreviewFile(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input).not.toBeNull()
  fireEvent.change(input!, {
    target: { files: [new File(['test'], 'import.xlsx')] },
  })
  expect(await screen.findByText('import.xlsx · найдено строк: 1 · к импорту: 1')).toBeInTheDocument()
}
