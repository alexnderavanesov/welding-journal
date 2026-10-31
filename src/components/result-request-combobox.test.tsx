import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ResultRequestCombobox } from './result-request-combobox'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'

const api = vi.hoisted(() => ({ getLnkWorkflowRequestSummary: vi.fn(), getPstoWorkflowRequestOptions: vi.fn() }))
vi.mock('@/server/weld-read-api', () => api)
beforeEach(() => vi.resetAllMocks())

it.each(['primary', 'beforeHeatTreatment', 'psto', 'tvmt'] as const)('%s finds a request outside loaded rows without changing selection while typing', async scope => {
  const first = createRequestDocumentIdentity('Initial', '2026-10-02')!
  const remote = createRequestDocumentIdentity('Remote 501', '2026-10-03')!
  api.getLnkWorkflowRequestSummary.mockImplementation(async ({ data }) => ({ requestNames: [], requestOptions: data.search === 'Remote 501' ? [remote] : [first], hasMore: !data.search }))
  api.getPstoWorkflowRequestOptions.mockImplementation(async ({ data }) => ({ options: data.search === 'Remote 501' ? [remote] : [first], hasMore: !data.search }))
  const changed = vi.fn()
  function Harness() {
    const [value, setValue] = useState(first.key)
    return <ResultRequestCombobox ariaLabel="Фильтр по заявке" scope={scope} methodCode={scope === 'primary' || scope === 'beforeHeatTreatment' ? 'РК' : undefined}
      value={value} options={[first]} onChange={request => { changed(request); setValue(request?.key ?? '') }} />
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
  expect(api.getLnkWorkflowRequestSummary).not.toHaveBeenCalled()
  expect(api.getPstoWorkflowRequestOptions).not.toHaveBeenCalled()
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'Remote 501' } })
  await waitFor(() => expect(screen.getByRole('option', { name: /Remote 501/ })).toBeInTheDocument())
  expect(changed).not.toHaveBeenCalled()
  const called = scope === 'psto' || scope === 'tvmt' ? api.getPstoWorkflowRequestOptions : api.getLnkWorkflowRequestSummary
  expect(called).toHaveBeenLastCalledWith({ data: { resultScope: scope, search: 'Remote 501', ...(scope === 'primary' || scope === 'beforeHeatTreatment' ? { methodCode: 'РК' } : {}) } })
  fireEvent.click(screen.getByRole('option', { name: /Remote 501/ }))
  expect(changed).toHaveBeenCalledOnce()
  expect(changed).toHaveBeenCalledWith(remote)
  expect(input).toHaveValue(remote.label)
})
