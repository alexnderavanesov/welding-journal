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

  it('portals above clipped/sticky table cells, keeps inside clicks open and returns focus on Escape', () => {
    const onChange = vi.fn()
    render(<div className="overflow-hidden"><DocumentHistoryColumnChooser columns={SYSTEM_DOCUMENT_HISTORY_COLUMNS}
      visibleColumnKeys={SYSTEM_DOCUMENT_HISTORY_COLUMNS.map(column => column.key)} onChange={onChange} /></div>)
    const trigger = screen.getByRole('button', { name: /Столбцы/ })
    fireEvent.click(trigger)
    const menu = screen.getByRole('dialog', { name: 'Столбцы истории документов' })
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveClass('fixed')
    fireEvent.pointerDown(screen.getByRole('checkbox', { name: 'Этап' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Этап' }))
    expect(menu).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(menu).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
