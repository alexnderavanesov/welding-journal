import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PstoProgramDiagnosticBoundary, PstoProgramLoading } from './psto-program-diagnostic-boundary'
import { PSTO_PROGRAM_DIAGNOSTICS_KEY, readPstoProgramDiagnostics } from '@/lib/psto-program-diagnostics'

it('keeps a loading window closable and gives a bounded diagnostic on render failure', () => {
  const close = vi.fn()
  const loading = render(<PstoProgramLoading open onClose={close} />)
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(close).toHaveBeenCalledTimes(1)
  loading.unmount()
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  function Failed(): never { throw new Error('private project data') }
  try {
    render(<PstoProgramDiagnosticBoundary open onClose={close}><Failed /></PstoProgramDiagnosticBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('сохраните диагностику')
    expect(screen.getByText(/"render-error"/)).toBeInTheDocument()
    expect(screen.queryByText(/private project data/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(close).toHaveBeenCalledTimes(2)
  } finally { spy.mockRestore() }
})

it('does not record closing when the still-open dialog switches to its error view', () => {
  sessionStorage.removeItem(PSTO_PROGRAM_DIAGNOSTICS_KEY)
  const close = vi.fn(), spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  function Failed(): never { throw new Error('render') }
  const view = render(<PstoProgramDiagnosticBoundary open onClose={close}><span>Loaded</span></PstoProgramDiagnosticBoundary>)
  try {
    view.rerender(<PstoProgramDiagnosticBoundary open onClose={close}><Failed /></PstoProgramDiagnosticBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(readPstoProgramDiagnostics().filter(entry => entry.event === 'close')).toHaveLength(0)
    view.unmount()
    expect(readPstoProgramDiagnostics().filter(entry => entry.event === 'close')).toHaveLength(1)
  } finally { spy.mockRestore() }
})
