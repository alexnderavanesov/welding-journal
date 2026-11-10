import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { LineSchemeFilesDialog } from './line-scheme-files-dialog'
import type { SchemeSession } from '@/lib/use-line-scheme-session'
import type { SchemeLine } from '@/lib/line-schemes'

const mocks = vi.hoisted(() => ({ blocker: vi.fn(), confirm: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({}), useBlocker: mocks.blocker }))
vi.mock('@/lib/confirm-action-context', () => ({ useConfirmAction: () => mocks.confirm }))
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: () => true }) }))
vi.mock('@/server/line-schemes-api', () => ({ changeLineSchemeRevision: vi.fn(), updateLineSchemeRevisionNumber: vi.fn() }))

beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue(false) })

it('protects the selected file while the initial session is opening and keeps protection until cancel', async () => {
  const file = new File(['%PDF-'], 'Selected.pdf', { type: 'application/pdf' })
  const line = { lineId: 1, line: 'L1' } as SchemeLine
  const session: SchemeSession = {
    token: '00000000-0000-4000-8000-000000000001', bundle: null, lease: { owned: false, name: null, expiresAt: null }, opening: true, error: '',
    setBundle: vi.fn(), setLease: vi.fn(), setError: vi.fn(), read: vi.fn(), apply: vi.fn(),
  }
  const handled = vi.fn()
  const view = (opening: boolean, initialFile?: File) => <LineSchemeFilesDialog line={line} session={{ ...session, opening }}
    initialFile={initialFile} onFileHandled={handled} onOpen={vi.fn()} onClose={vi.fn()} />
  const { rerender } = render(view(true, file))
  expect(handled).not.toHaveBeenCalled()
  expect(mocks.blocker.mock.lastCall![0].disabled).toBe(false)
  expect(await mocks.blocker.mock.lastCall![0].shouldBlockFn({ current: { pathname: '/line-schemes' }, next: { pathname: '/journal' } })).toBe(true)
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('Выбранный файл') }))

  rerender(view(false, file))
  expect(handled).toHaveBeenCalledOnce()
  expect(screen.getByText('Новый файл: Selected.pdf')).toBeVisible()
  rerender(view(false))
  expect(mocks.blocker.mock.lastCall![0].disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(mocks.blocker.mock.lastCall![0].disabled).toBe(true)
})
