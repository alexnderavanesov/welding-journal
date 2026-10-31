import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WelderStampSuspensionsPanel } from './welder-stamp-suspensions-panel'

it('keeps the suspension editor open during saving and after rejection without duplicate submissions', async () => {
  let complete!: (saved: boolean) => void
  const save = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve })), reset = vi.fn()
  render(<WelderStampSuspensionsPanel records={[]} stampOptions={['AUD2']} openEditorSignal={1}
    draft={{ id: 0, naksStamp: 'AUD2', suspendedFrom: '2026-10-01', suspendedTo: '2026-10-15' }}
    onDraftChange={vi.fn()} onSave={save} onReset={reset} onEdit={vi.fn()} onDelete={vi.fn()} />)
  const submit = screen.getByRole('button', { name: 'Добавить' })
  fireEvent.click(submit)
  fireEvent.click(submit)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(save).toHaveBeenCalledOnce()
  expect(reset).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeVisible()
  for (const name of ['Отмена', 'Закрыть']) expect(screen.getByRole('button', { name })).toBeDisabled()
  expect(screen.getByLabelText('Отстранен от')).toBeDisabled()
  await act(async () => complete(false))
  expect(screen.getByLabelText('Отстранен от')).toHaveValue('2026-10-01')
  expect(submit).toBeEnabled()
  fireEvent.click(submit)
  await act(async () => complete(true))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(reset).not.toHaveBeenCalled()
})
