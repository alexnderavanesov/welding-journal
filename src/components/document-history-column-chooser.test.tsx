import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentHistoryColumnChooser } from '@/components/document-history-column-chooser'
import { SYSTEM_DOCUMENT_HISTORY_COLUMNS } from '@/lib/document-history-columns'

describe('DocumentHistoryColumnChooser', () => {
  it('keeps the document column required and changes optional columns', () => {
    const onChange = vi.fn()
    render(
      <DocumentHistoryColumnChooser
        columns={SYSTEM_DOCUMENT_HISTORY_COLUMNS}
        visibleColumnKeys={SYSTEM_DOCUMENT_HISTORY_COLUMNS.map((column) => column.key)}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Столбцы/ }))
    expect(screen.getByRole('checkbox', { name: /Документ/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Этап' }))
    expect(onChange).toHaveBeenCalledWith(
      SYSTEM_DOCUMENT_HISTORY_COLUMNS
        .filter((column) => column.key !== 'stage')
        .map((column) => column.key),
    )
  })

  it('restores every available column', () => {
    const onChange = vi.fn()
    render(
      <DocumentHistoryColumnChooser
        columns={SYSTEM_DOCUMENT_HISTORY_COLUMNS}
        visibleColumnKeys={['title', 'stage']}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Столбцы/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Показать все' }))
    expect(onChange).toHaveBeenCalledWith(SYSTEM_DOCUMENT_HISTORY_COLUMNS.map((column) => column.key))
  })
})
