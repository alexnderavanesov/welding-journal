import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LnkResultChangesSummary } from './lnk-result-changes-summary'
import { ConfirmActionDialog } from './confirm-action-dialog'
import type { LnkResultEditChange } from '@/lib/lnk-result-edit-plan'

const changes: LnkResultEditChange[] = [
  { key: '1:vik', rowId: 1, joint: 'S1', method: 'ВИК', line: 'L1', project: 'Проект', subtitleCode: 'Ш-1', from: 'ремонт', to: 'годен' },
  { key: '2:vik', rowId: 2, joint: 'S1', method: 'ВИК до ТО', line: 'L1', project: 'Проект', subtitleCode: 'Ш-2', from: 'годен', to: null },
]

describe('LNK result edit confirmation', () => {
  it('lists each factual old/new result and disambiguates namesake joints by drawing', () => {
    render(<LnkResultChangesSummary changes={changes} />)
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('СтыкМетодБылоСтанет')
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('S1Линия L1ПроектШифр Ш-1')
    expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('S1Линия L1ПроектШифр Ш-2')
    expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['ВИК', 'Былоремонт', 'Станетгоден'])
    expect(within(rows[2]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['ВИК до ТО', 'Былогоден', 'СтанетУдаление результата'])
    expect(screen.getByText(/Остальные позиции общего документа сохранятся/)).toHaveTextContent('название заключения и дата контроля')
    expect(screen.getByText('Изменений: 2')).toBeVisible()
  })

  it('shows replacement-only changes without a misleading deletion warning', () => {
    render(<LnkResultChangesSummary changes={[changes[0]]} />)
    expect(within(screen.getByRole('table')).getByText('годен')).toBeVisible()
    expect(within(screen.getByRole('table')).getByText('ремонт')).toHaveClass('bg-slate-50')
    expect(screen.getByRole('table').querySelector('[class*="rose-"]')).toBeNull()
    expect(screen.queryByText(/При удалении/)).not.toBeInTheDocument()
  })

  it('bounds a large confirmation DOM while keeping the full total and scrolling region', () => {
    render(<LnkResultChangesSummary changes={Array.from({ length: 2000 }, (_, index) => ({ ...changes[0], key: `row-${index}`, rowId: index, joint: `S${index}` }))} />)
    expect(screen.getByText('Изменений: 2000')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Список изменений результатов' })).toHaveClass('overflow-auto', 'max-h-[min(44dvh,24rem)]')
    expect(screen.getAllByRole('row').length).toBeLessThan(30)
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
  })

  it('stacks statuses at mobile width without splitting words and retains desktop table columns', () => {
    render(<LnkResultChangesSummary changes={changes} />)
    expect(screen.getByRole('table')).toHaveClass('block', 'sm:table')
    const rows = screen.getAllByRole('row').slice(1)
    for (const row of rows) {
      expect(row).toHaveClass('grid', 'sm:table-row')
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveClass('col-span-2', 'sm:table-cell')
      expect(cells[2]).toHaveClass('col-span-2', 'sm:table-cell')
    }
    expect(screen.getByText('ремонт')).toHaveClass('break-normal', '[overflow-wrap:normal]')
    expect(screen.getByText('Удаление результата').parentElement?.parentElement).toHaveClass('break-normal', '[overflow-wrap:normal]')
  })

  it('keeps confirmation controls outside the scroll area with exact primary/preTO labels', () => {
    const onConfirm = vi.fn(), onClose = vi.fn()
    render(<ConfirmActionDialog title="Подтвердить изменения результатов" tone="neutral"
      description={<LnkResultChangesSummary changes={changes} />}
      confirmLabel="Применить изменения" cancelLabel="Вернуться к редактированию"
      onConfirm={onConfirm} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Подтвердить изменения результатов' })
    expect(within(dialog).getByRole('heading', { name: 'Подтвердить изменения результатов' })).toBeVisible()
    const back = within(dialog).getByRole('button', { name: 'Вернуться к редактированию' })
    expect(back.parentElement).toHaveClass('shrink-0', 'flex-col-reverse', 'sm:flex-row')
    expect(within(dialog).getByRole('button', { name: 'Применить изменения' })).toHaveClass('bg-sky-50')
    expect(within(dialog).getByRole('region', { name: 'Список изменений результатов' }).closest('section')?.parentElement?.parentElement).toHaveClass('bg-slate-50')
    expect(within(dialog).getByText('Удаление результата').parentElement).toHaveClass('bg-rose-50')
    fireEvent.click(back)
    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить изменения' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it.each([
    { tone: undefined, label: 'Удалить', card: 'bg-red-50', button: 'bg-rose-50' },
    { tone: 'warning' as const, label: 'Принять', card: 'bg-amber-50', button: 'bg-sky-50' },
  ])('preserves existing confirmation tone and default action: $tone', ({ tone, label, card, button }) => {
    render(<ConfirmActionDialog title="Существующее действие" description="Проверьте операцию" tone={tone}
      onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Проверьте операцию').parentElement).toHaveClass(card)
    expect(screen.getByRole('button', { name: label })).toHaveClass(button)
  })
})
