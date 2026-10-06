import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultDialogFooter } from '@/components/result-dialog-footer'

describe('ResultDialogFooter', () => {
  it('keeps a blocking reason and all corrections separate from disabled save', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const onFixDate = vi.fn()
    const onFixWeld = vi.fn()
    const onOpenDocuments = vi.fn()
    const reason = 'ЗВ-15 · Дата контроля раньше даты сварки. '.repeat(20)
    render(<ResultDialogFooter
      saveBlockReason={reason}
      saveBlockReasonVariant="danger"
      blockReasonActions={[
        { key: 'date', label: 'Исправить дату контроля', onAction: onFixDate },
        { key: 'weld', label: 'Исправить дату сварки', onAction: onFixWeld },
      ]}
      blockReasonActionLabel="Открыть заключения и имена"
      onBlockReasonAction={onOpenDocuments}
      isSaveDisabled
      onSave={onSave}
      onClose={onClose}
    />)
    const footer = screen.getByRole('group', { name: 'Сохранение результата' })
    const warningArea = footer.firstElementChild!
    const actionArea = footer.lastElementChild!
    expect(warningArea).toHaveTextContent(`Сохранение заблокировано: ${reason}`.trim())
    expect(warningArea).toHaveClass('overflow-y-auto')
    expect(actionArea).toContainElement(screen.getByRole('button', { name: 'Сохранить результат' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    const save = within(footer).getByRole('button', { name: 'Сохранить результат' })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату контроля' }))
    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату сварки' }))
    fireEvent.click(screen.getByRole('button', { name: 'Открыть заключения и имена' }))
    expect(onFixDate).toHaveBeenCalledOnce()
    expect(onFixWeld).toHaveBeenCalledOnce()
    expect(onOpenDocuments).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('preserves the ordinary footer without optional controls', () => {
    const onSave = vi.fn()
    render(<ResultDialogFooter saveBlockReason={null} isSaveDisabled={false} onSave={onSave} onClose={vi.fn()} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Сохранение результата' }).childElementCount).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить результат' }))
    expect(onSave).toHaveBeenCalledOnce()
  })
})
