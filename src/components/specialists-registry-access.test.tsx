import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
const state = vi.hoisted(() => ({ permissions: ['references.view'], archive: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/security-context', () => ({
  useAccess: () => ({ can: (permission: string) => state.permissions.includes(permission) }),
  useSecurityGuard: () => ({ requireSettingsChangePassword: async () => false }),
}))
vi.mock('@/server/specialists', () => ({ archiveSpecialist: state.archive, listSpecialists: vi.fn(), saveSpecialist: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useQuery: () => ({ data: { records: [{ id: 9, revision: 2, name: 'Специалист', certificate: '123', kind: 'inspector', methods: ['ВИК'], archived: false }], total: 1, counts: { all: 1, active: 1, archived: 0 } } }),
}))
import { SpecialistsRegistry } from './specialists-registry'
beforeEach(() => { state.permissions = ['references.view']; state.archive.mockReset().mockResolvedValue({}); state.invalidate.mockReset().mockResolvedValue(undefined) })

it('shows read-only specialist cards without offering mutations', () => {
  render(<SpecialistsRegistry />)
  for (const name of ['Добавить специалиста', 'Изменить', 'В архив']) expect(screen.getByRole('button', { name })).toBeDisabled()
})
it('archives with a separate delete permission without requiring settings editing', async () => {
  state.permissions.push('references.delete')
  render(<SpecialistsRegistry />)
  fireEvent.click(screen.getByRole('button', { name: 'В архив' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'В архив' }))
  await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ data: { id: 9, revision: 2, archived: true } }))
})
