import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { DocumentSpecialistsPanel } from './document-specialists-panel'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import type { WeldRow } from '@/lib/dispatcher-types'

const list = vi.hoisted(() => vi.fn(async () => ({ records: [{ id: 1, name: 'Иванов', certificate: '123', kind: 'inspector', methods: ['ВИК'], revision: 1 }], hasMore: false })))
vi.mock('@/server/specialists', () => ({ listSpecialists: list }))

it('shares one filtered registry request for 1000 documents, bounds rendering, and ignores focus/reconnect', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const naming = { mode: 'system' as const, customName: '', splitModes: { lnkConclusionVik: 'line' as const } }
  const plan = buildSystemDocumentCreationPlan({ type: 'lnkConclusion', methodCode: 'ВИК', date: '2026-10-12', naming,
    settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS, rows: Array.from({ length: 1000 }, (_, id) => ({ id, projectTitle: 'P', subtitleCode: 'S', line: `L${id}` } as WeldRow)) })
  const view = render(<QueryClientProvider client={client}><DocumentSpecialistsPanel plan={plan} naming={naming} onChange={vi.fn()} /></QueryClientProvider>)
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  expect(list.mock.calls[0]).toEqual([{ data: { search: '', kind: 'inspector', methods: ['ВИК'] } }])
  expect(screen.getAllByRole('combobox')).toHaveLength(102)
  expect(screen.getAllByRole('row')).toHaveLength(51)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('combobox')[2])
  expect(screen.getAllByRole('listbox')).toHaveLength(1)
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  expect(screen.getAllByRole('combobox')).toHaveLength(102)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true) })
  expect(list).toHaveBeenCalledTimes(1)
  view.unmount(); client.clear(); focusManager.setFocused(undefined)
})
