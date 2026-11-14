import { act, cleanup, render, screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { LargeDialogShell } from './large-dialog-shell'
import { DialogHeader } from './dialog-header'
import { WorkflowDialogShell } from './workflow-dialog-shell'

const close = () => {}
afterEach(cleanup)

describe('shared modal accessible names', () => {
  it('uses the actual visible header, excluding subtitle and close controls', () => {
    render(<LargeDialogShell><DialogHeader title="Формирование: ЖСР" subtitle="Выбрано стыков: 4" onClose={close} /></LargeDialogShell>)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Формирование: ЖСР')
  })

  it('preserves an explicit label even when the visible heading differs', () => {
    render(<LargeDialogShell ariaLabel="Проверка сохранения"><DialogHeader title="Документы сохранены" onClose={close} /></LargeDialogShell>)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Проверка сохранения')
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-labelledby')
  })

  it('supports custom headings named explicitly by the caller', () => {
    render(<LargeDialogShell ariaLabel="Новый стык"><header><h2>Новый стык</h2></header></LargeDialogShell>)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Новый стык')
  })

  it('keeps distinct parent and nested portal heading identities', () => {
    render(<LargeDialogShell><DialogHeader title="Редактор" onClose={close} />
      <LargeDialogShell><DialogHeader title="Подтверждение" onClose={close} /></LargeDialogShell>
    </LargeDialogShell>)
    const parent = screen.getByRole('dialog', { name: 'Редактор' })
    const child = screen.getByRole('dialog', { name: 'Подтверждение' })
    expect(parent.getAttribute('aria-labelledby')).not.toBe(child.getAttribute('aria-labelledby'))
    for (const dialog of [parent, child]) expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.closest('[role="dialog"]')).toBe(dialog)
  })

  it('updates a changing visible title without changing the heading identity', () => {
    const content = (title: string) => <WorkflowDialogShell><DialogHeader title={title} onClose={close} /></WorkflowDialogShell>
    const view = render(content('Заявка ПСТО'))
    const id = screen.getByRole('dialog').getAttribute('aria-labelledby')
    view.rerender(content('Внесение результатов ПСТО'))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Внесение результатов ПСТО')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', id)
  })

  it('connects a header mounted after an embedded workflow resolves Suspense', async () => {
    let resolve!: () => void
    const ready = new Promise<void>(done => { resolve = done })
    const Deferred = lazy(async () => {
      await ready
      return { default: () => <DialogHeader title="Редактирование заявок ЛНК" onClose={close} /> }
    })
    render(<WorkflowDialogShell><Suspense fallback={<span role="status">Открываем…</span>}><Deferred /></Suspense></WorkflowDialogShell>)
    const id = screen.getByRole('dialog').getAttribute('aria-labelledby')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    await act(async () => { resolve() })
    expect(await screen.findByRole('dialog', { name: 'Редактирование заявок ЛНК' })).toHaveAttribute('aria-labelledby', id)
  })

  it('does not invent an unrelated heading id outside a modal', () => {
    render(<DialogHeader title="Раздел" onClose={close} />)
    expect(screen.getByRole('heading')).not.toHaveAttribute('id')
  })
})
