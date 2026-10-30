import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { DocumentSpecialistAssignmentDialog, DocumentSpecialistCell } from './document-specialist-assignment'
import { assignDocumentSpecialists } from '@/server/specialists'

vi.mock('@/server/specialists', () => ({ assignDocumentSpecialists: vi.fn(async () => ({ count: 1 })) }))
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: () => true }), useSecurityGuard: () => ({ requireEditPassword: async () => true }) }))
vi.mock('./specialist-select', () => ({
  useSpecialistOptions: () => ({ known: new Map([[8, { name: 'Иванов', certificate: '8' }]]) }),
  SpecialistSearch: () => null,
  SpecialistSelect: ({ onChange }: { onChange: (value: number) => void }) => <button onClick={() => onChange(8)}>Выбрать Иванова</button>,
}))
beforeEach(() => vi.clearAllMocks())
it.each(['cell', 'bulk'] as const)('keeps the captured %s token after a background refresh', async entry => {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const doc = { id: 1, documentId: 11, type: 'system:lnkConclusionVik', title: 'ВИК-1', updatedAt: '2026-10-01T00:00:00Z', specialistsRevision: 0, documentVersion: '101' }
  const content = (document: typeof doc) => entry === 'cell'
    ? <DocumentSpecialistCell document={document} role="first" />
    : <DocumentSpecialistAssignmentDialog documents={[document]} onClose={() => {}} />
  const view = render(content(doc), { wrapper })
  if (entry === 'cell') fireEvent.click(screen.getByRole('button', { name: 'Провёл контроль: ВИК-1' }))
  // Composition-only change: even identical displayed date/revision must not
  // replace the token belonging to the already-open editor.
  view.rerender(content({ ...doc, documentVersion: '102' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Выбрать Иванова' })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
  await waitFor(() => expect(assignDocumentSpecialists).toHaveBeenCalledWith({ data: {
    documents: [{ id: 11, revision: 0, updatedAt: doc.updatedAt, documentVersion: '101' }], selection: { first: 8 },
  } }))
})
