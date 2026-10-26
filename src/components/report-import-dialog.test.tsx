import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('@/server/weld-import-api', () => ({
  listWeldingJournalImportScope: vi.fn().mockResolvedValue({ rows: [], total: 0, fullyAssignedPstoLineKeys: [], limitExceeded: false }),
}))
vi.mock('@/server/line-program', () => ({ getLineProgramsForImport: vi.fn().mockResolvedValue([]) }))

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
    vi.clearAllMocks()
    vi.mocked(buildReportImportPreview).mockResolvedValue(preview)
  })

  it.each(['Массовое заполнение', 'Замена данных'])('discards an unfinished file preview after switching to %s', async label => {
    let finish!: (value: typeof preview) => void
    vi.mocked(buildReportImportPreview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    renderDialog({ onClose: vi.fn(), onImportRecords: vi.fn() })
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['test'], 'old.xlsx')] } })
    fireEvent.click(screen.getByRole('button', { name: label }))
    await act(async () => { finish(preview) })
    expect(screen.queryByText('Предпросмотр', { exact: true })).toBeNull()
    expect(screen.getByRole('button', { name: label === 'Замена данных' ? /^Заменить/ : /^Заполнить/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Импорт данных' }))
    await uploadPreviewFile()
    expect(screen.getByRole('button', { name: 'Импортировать 1 строк' })).toBeEnabled()
  })

  it('a late failure from the previous mode cannot erase a newer valid preview', async () => {
    let fail!: (error: Error) => void
    vi.mocked(buildReportImportPreview).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
    renderDialog({ onClose: vi.fn(), onImportRecords: vi.fn() })
    fireEvent.change(document.body.querySelector('input[type="file"]')!, { target: { files: [new File(['old'], 'old.xlsx')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Замена данных' }))
    fireEvent.click(screen.getByRole('button', { name: 'Импорт данных' }))
    await uploadPreviewFile()
    await act(async () => { fail(new Error('Old failed request')) })
    expect(screen.getByRole('button', { name: 'Импортировать 1 строк' })).toBeEnabled()
    expect(screen.queryByText('Old failed request')).toBeNull()
  })

  it('keeps the preview open and shows a server rejection', async () => {
    const onClose = vi.fn()
    const onImportRecords = vi.fn().mockRejectedValue(new Error('Импорт остановлен: строка 2. ЗВ-02.'))
    renderDialog({ onClose, onImportRecords })

    await uploadPreviewFile()
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать 1 строк' }))

    expect(await screen.findByText('Сохранение не выполнено. Импорт остановлен: строка 2. ЗВ-02.')).toBeInTheDocument()
    expect(screen.getByText('Предпросмотр')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the prepared preview open when password entry is cancelled', async () => {
    const onClose = vi.fn()
    const onImportRecords = vi.fn().mockResolvedValue(false)
    renderDialog({ onClose, onImportRecords })

    await uploadPreviewFile()
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать 1 строк' }))

    await waitFor(() => expect(onImportRecords).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Предпросмотр')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('highlights all fields when one import row has several errors', async () => {
    vi.mocked(buildReportImportPreview).mockResolvedValue({
      ...preview,
      fields: [FIELD_BY_KEY.get('line')!, FIELD_BY_KEY.get('joint')!],
      records: [{ line: '330-P49-03-000', joint: 'F1' }],
      validRecords: [],
      errors: [
        { rowNumber: 2, title: 'Линия', message: 'Ошибка линии', fieldKeys: ['line'] },
        { rowNumber: 2, title: 'Стык', message: 'Ошибка стыка', fieldKeys: ['joint'] },
      ],
    })
    renderDialog({ onClose: vi.fn(), onImportRecords: vi.fn().mockResolvedValue(true) })

    await uploadPreviewFile('import.xlsx · найдено: 1 · к добавлению: 0')

    expect(screen.getByTitle('330-P49-03-000').closest('.ag-cell')).toHaveClass('bg-amber-50')
    expect(screen.getByTitle('F1').closest('.ag-cell')).toHaveClass('bg-amber-50')
    expect(screen.getByRole('button', { name: 'Только строки с ошибками · 1' })).toBeInTheDocument()
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

async function uploadPreviewFile(summary = 'import.xlsx · найдено: 1 · к добавлению: 1') {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input).not.toBeNull()
  fireEvent.change(input!, {
    target: { files: [new File(['test'], 'import.xlsx')] },
  })
  expect(await screen.findByText(summary)).toBeInTheDocument()
}
