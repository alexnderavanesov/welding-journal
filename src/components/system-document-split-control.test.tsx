import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SystemDocumentSplitControl } from './system-document-split-control'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { defaultRequestNamingState } from '@/lib/request-naming-state'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import type { WeldRow } from '@/lib/dispatcher-types'

const mocks = vi.hoisted(() => ({ defaults: vi.fn(), sequences: vi.fn(), preview: vi.fn() }))
vi.mock('@/server/document-grouping-preferences', () => ({ getDocumentGroupingDefaults: mocks.defaults }))
vi.mock('@/server/system-document-sequences', () => ({ getSystemDocumentSequences: mocks.sequences, previewSystemDocumentNames: mocks.preview }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.defaults.mockResolvedValue({ ...REQUEST_CONCLUSION_DEFAULT_SETTINGS, splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, lnkRequest: 'line' } })
  mocks.sequences.mockResolvedValue({ lnkRequest: 10 })
  mocks.preview.mockImplementation(async ({ data }) => data.map(() => ({ name: 'Заявка-09.10.2026-012', pattern: REQUEST_CONCLUSION_DEFAULT_SETTINGS.lnkRequest.systemPattern })))
})
const rows = [1, 2].map(id => ({ id, joint: `S${id}`, projectTitle: 'P', subtitleCode: 'C', line: 'L' })) as WeldRow[]
function Draft({ methodSelected = true }: { methodSelected?: boolean }) {
  const [naming, setNaming] = useState(defaultRequestNamingState)
  const plan = methodSelected ? buildSystemDocumentCreationPlan({ type: 'lnkRequest', date: '2026-10-09', rows, settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS, naming }) : null
  return <SystemDocumentSplitControl plan={plan} naming={naming} onChange={setNaming} />
}
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><Draft /></QueryClientProvider>)
}

it('shows the fresh shared default and exact count; editing the draft does not write or refetch', async () => {
  open()
  const control = screen.getByRole('combobox', { name: 'Разделение документов' })
  await waitFor(() => expect(control).toBeEnabled())
  expect(control).toHaveValue('line')
  expect(screen.getByRole('status')).toHaveTextContent('Будет создано: 1')
  fireEvent.change(control, { target: { value: 'joint' } })
  expect(screen.getByRole('status')).toHaveTextContent('Будет создано: 2')
  expect(mocks.defaults).toHaveBeenCalledTimes(1)
  expect(mocks.sequences).toHaveBeenCalledTimes(1)
  expect(mocks.preview).not.toHaveBeenCalled()
})

it('fetches again on a new opening without reusing the cancelled split', async () => {
  const view = open()
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'joint' } })
  view.unmount()
  open()
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('line'))
  expect(mocks.defaults).toHaveBeenCalledTimes(2)
  expect(mocks.preview).not.toHaveBeenCalled()
})

it('keeps an open draft when the shared value changes and explicitly refreshes only names/numbers', async () => {
  open()
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'joint' } })
  mocks.defaults.mockResolvedValue(REQUEST_CONCLUSION_DEFAULT_SETTINGS)
  expect(screen.queryByRole('button', { name: 'Обновить номера и имена' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Дополнительные действия с номерами и именами' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Обновить номера и имена' })) })
  expect(screen.getByRole('combobox')).toHaveValue('joint')
  expect(mocks.defaults).toHaveBeenCalledTimes(2)
  expect(mocks.preview).toHaveBeenCalledTimes(1)
})

it('explains missing method instead of giving an invented document count', async () => {
  render(<Draft methodSelected={false} />)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Выберите вид контроля'))
  expect(screen.getByRole('combobox')).toBeDisabled()
  expect(screen.queryByText(/Будет создано/)).not.toBeInTheDocument()
})

it('blocks while defaults cannot be loaded and permits an explicit retry', async () => {
  mocks.defaults.mockRejectedValueOnce(new Error('offline'))
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку правил' }))
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  expect(mocks.defaults).toHaveBeenCalledTimes(2)
})
