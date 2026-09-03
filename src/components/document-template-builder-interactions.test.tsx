import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readWorkbookPreviewMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/document-template-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/document-template-storage')>()
  return {
    ...actual,
    readDocumentTemplateWorkbookPreview: readWorkbookPreviewMock,
  }
})

import { DocumentTemplateBuilder } from '@/components/document-template-builder'
import type {
  DocumentTemplateConstructorConfig,
  DocumentTemplateWorkbookPreview,
  StoredDocumentTemplate,
} from '@/lib/document-template-storage'

const preview: DocumentTemplateWorkbookPreview = {
  sheetNames: ['Лист 1'],
  sheetName: 'Лист 1',
  startRow: 1,
  startColumn: 1,
  rowCount: 1,
  columnCount: 2,
  cells: [
    { address: 'A1', row: 1, column: 1, value: '', rowSpan: 1, columnSpan: 1, style: {} },
    { address: 'B1', row: 1, column: 2, value: '', rowSpan: 1, columnSpan: 1, style: {} },
  ],
  hiddenCells: [],
  columnWidths: [18, 18],
  rowHeights: [24],
  truncated: false,
}

function createTemplate(
  id: StoredDocumentTemplate['id'],
  fileName: string,
  constructorConfig?: DocumentTemplateConstructorConfig,
): StoredDocumentTemplate {
  return {
    id,
    fileName,
    fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: 1,
    uploadedAt: '2026-09-02T00:00:00.000Z',
    sheetNames: ['Лист 1'],
    fields: [],
    markerCount: 0,
    locations: [],
    warnings: [],
    fileData: new ArrayBuffer(0),
    constructorConfig,
  }
}

function createConfiguredTemplate() {
  return createTemplate('weldingJournal', 'ЖСР.xlsx', {
    version: 1,
    sheetName: 'Лист 1',
    repeatRow: 1,
    repeatRowEnd: 1,
    repeatMode: 'rows',
    bindings: [
      {
        cell: 'A1',
        mode: 'row',
        parts: [
          { field: 'joint', prefix: 'Стык ', suffix: '.', lineBreakAfter: true },
          { field: 'd1', numericOperation: 'min', compareField: 'd2', multiplier: '3,14' },
        ],
        uniqueParts: false,
        emptyMode: 'custom',
        emptyText: 'нет данных',
        filledMode: 'custom',
        filledText: 'готово',
      },
    ],
    nameConfig: { parts: [{ type: 'text', text: 'ЖСР' }] },
  })
}

beforeEach(() => {
  window.localStorage.clear()
  readWorkbookPreviewMock.mockReset()
  readWorkbookPreviewMock.mockResolvedValue(preview)
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('document template builder cell clipboard', () => {
  it('copies with the context menu and pastes into another template', async () => {
    const sourceView = render(
      <DocumentTemplateBuilder
        template={createConfiguredTemplate()}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )
    const sourceDialog = await screen.findByRole('dialog')
    const sourceCell = within(sourceDialog).getByLabelText('Ячейка A1')

    fireEvent.contextMenu(sourceCell, { clientX: 20, clientY: 20 })
    fireEvent.click(screen.getByRole('button', { name: /Копировать содержимое/ }))
    sourceView.unmount()

    const onSave = vi.fn().mockResolvedValue(false)
    render(
      <DocumentTemplateBuilder
        template={createTemplate('checklist', 'Чек-лист.xlsx')}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    )
    const targetDialog = await screen.findByRole('dialog')
    const targetCell = within(targetDialog).getByLabelText('Ячейка B1')

    fireEvent.contextMenu(targetCell, { clientX: 40, clientY: 40 })
    const pasteButton = screen.getByRole('button', { name: /Вставить содержимое/ })
    expect(pasteButton).toBeEnabled()
    expect(pasteButton).toHaveTextContent('Из A1 · ЖСР.xlsx')
    fireEvent.click(pasteButton)
    fireEvent.click(within(targetDialog).getByRole('button', { name: 'Сохранить конструктор' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const savedConfig = onSave.mock.calls[0][0] as DocumentTemplateConstructorConfig
    expect(savedConfig.bindings).toEqual([
      expect.objectContaining({
        cell: 'B1',
        mode: 'row',
        parts: [
          { field: 'joint', prefix: 'Стык ', suffix: '.', lineBreakAfter: true },
          { field: 'd1', numericOperation: 'min', compareField: 'd2', multiplier: '3,14' },
        ],
        uniqueParts: false,
        emptyMode: 'custom',
        emptyText: 'нет данных',
        filledMode: 'custom',
        filledText: 'готово',
      }),
    ])
  })

  it('supports keyboard copy and paste while a workbook cell is focused', async () => {
    const onSave = vi.fn().mockResolvedValue(false)
    render(
      <DocumentTemplateBuilder
        template={createConfiguredTemplate()}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    )
    const dialog = await screen.findByRole('dialog')
    const sourceCell = within(dialog).getByLabelText('Ячейка A1')
    const targetCell = within(dialog).getByLabelText('Ячейка B1')

    fireEvent.click(sourceCell)
    fireEvent.keyDown(sourceCell, { key: 'c', metaKey: true })
    fireEvent.click(targetCell)
    fireEvent.keyDown(targetCell, { key: 'v', metaKey: true })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить конструктор' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const savedConfig = onSave.mock.calls[0][0] as DocumentTemplateConstructorConfig
    expect(savedConfig.bindings.map((binding) => binding.cell).sort()).toEqual(['A1', 'B1'])
    expect(savedConfig.bindings.find((binding) => binding.cell === 'B1')?.parts).toEqual(
      savedConfig.bindings.find((binding) => binding.cell === 'A1')?.parts,
    )
  })

  it('keeps ordinary text-field copy and paste untouched', async () => {
    render(
      <DocumentTemplateBuilder
        template={createConfiguredTemplate()}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Содержимое ячейки')
    const textInput = within(dialog).getAllByPlaceholderText(/Например: ст\./)[0]
    fireEvent.keyDown(textInput, { key: 'c', metaKey: true })

    expect(window.localStorage.length).toBe(0)
  })
})
