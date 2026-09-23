import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PreHeatTreatmentLnkWorkflowDialog } from '@/components/pre-heat-treatment-lnk-workflow-dialog'
import { PstoRepeatWorkflowDialog } from '@/components/psto-repeat-workflow-dialog'
import { TvmtWorkflowDialog } from '@/components/tvmt-workflow-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'
import { useLnkWorkflowRowsQuery } from '@/lib/use-lnk-workflow-context-query'
import { usePstoWorkflowRowsQuery } from '@/lib/use-psto-workflow-context-query'
import { SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY } from '@/lib/system-document-sequence-storage'

const mocks = vi.hoisted(() => ({ listLnkWorkflowRows: vi.fn(), listPstoWorkflowRows: vi.fn() }))
vi.mock('@/server/weld-read-api', () => mocks)
const noSelection = new Set<number>()
const noop = () => undefined

function WorkflowHarness({ kind }: { kind: 'pre' | 'psto' | 'tvmt' }) {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const lnk = useLnkWorkflowRowsQuery({ request: kind === 'pre'
    ? { scope: 'preHeatTreatmentRequestCandidates', search, includeRowIds: selectedIds }
    : null })
  const psto = usePstoWorkflowRowsQuery({ request: kind !== 'pre'
    ? { scope: kind === 'tvmt' ? 'tvmtRequestCandidates' : 'requestCandidates', search, includeRowIds: selectedIds }
    : null })
  const Dialog = kind === 'pre' ? PreHeatTreatmentLnkWorkflowDialog
    : kind === 'psto' ? PstoRepeatWorkflowDialog : TvmtWorkflowDialog
  return <Dialog mode="request" rows={(kind === 'pre' ? lnk : psto).data ?? []}
    initialSelectedIds={noSelection} onCandidateSelectionChange={setSelectedIds}
    onCandidateSearchChange={setSearch} onClose={noop} onSaved={noop}
    onOpenJournalRows={noop} onRunProtectedEdit={(_label, action) => action()} />
}

describe('workflow selection across server searches', () => {
  beforeEach(() => vi.resetAllMocks())

  it.each(['pre', 'psto', 'tvmt'] as const)('warns visibly and preserves all 5,000 selected %s rows', async (kind) => {
    const rows = Array.from({ length: 5001 }, (_, index) => ({
      id: index + 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `F${index + 1}`,
      weldDate: '2026-08-01', pstoRequired: 'да', hasVik: 'да',
      ...(kind === 'psto' ? { preHeatTreatmentLnkEnabled: false } : {}),
      ...(kind === 'tvmt' ? { pstoRequest: 'P1', pstoRequestDate: '2026-08-01',
        pstoResult: 'проведено', pstoDate: '2026-08-02' } : {}),
    } as WeldRow))
    const Dialog = kind === 'pre' ? PreHeatTreatmentLnkWorkflowDialog
      : kind === 'psto' ? PstoRepeatWorkflowDialog : TvmtWorkflowDialog
    const onSelection = vi.fn()
    const initialSelectedIds = new Set(rows.slice(0, 5000).map((row) => row.id))
    rows.unshift(rows.pop()!)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY, { lnkRequest: 1, pstoRequest: 1, tvmtRequest: 1 })
    render(<QueryClientProvider client={client}><Dialog mode="request" rows={rows}
      initialSelectedIds={initialSelectedIds} onCandidateSelectionChange={onSelection}
      onClose={noop} onSaved={noop} onOpenJournalRows={noop}
      onRunProtectedEdit={(_label, action) => action()} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'Выбрано: 5000' })).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: /Выбрать стык L F5001/ })
    fireEvent.click(checkbox)
    expect(screen.getByRole('alert')).toHaveTextContent('не более 5 000')
    expect(checkbox).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Выбрано: 5000' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Выбрать доступные|Выбрать найденные/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Прежний выбор сохранён')
    expect(new Set(onSelection.mock.lastCall?.[0])).toEqual(initialSelectedIds)
  })

  it.each(['pre', 'psto', 'tvmt'] as const)('keeps selected %s rows during and after a search without a request per checkbox', async (kind) => {
    const first = {
      id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1',
      weldDate: '2026-08-01', pstoRequired: 'да', hasVik: 'да',
      ...(kind === 'psto' ? { preHeatTreatmentLnkEnabled: false } : {}),
      ...(kind === 'tvmt' ? { pstoRequest: 'P1', pstoRequestDate: '2026-08-01',
        pstoResult: 'проведено', pstoDate: '2026-08-02' } : {}),
    } as WeldRow
    const second = { ...first, id: 2, joint: 'F2' }
    const server = kind === 'pre' ? mocks.listLnkWorkflowRows : mocks.listPstoWorkflowRows
    let finishSearch!: (rows: WeldRow[]) => void
    server.mockResolvedValueOnce([first]).mockImplementationOnce(() => new Promise<WeldRow[]>((resolve) => { finishSearch = resolve }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY, { lnkRequest: 1, pstoRequest: 1, tvmtRequest: 1 })
    render(<QueryClientProvider client={client}><WorkflowHarness kind={kind} /></QueryClientProvider>)
    await screen.findByRole('checkbox', { name: /Выбрать стык L F1/ })
    if (kind === 'pre') fireEvent.click(screen.getByRole('button', { name: 'ВИК' }))
    const checkbox = screen.getByRole('checkbox', { name: /Выбрать стык L F1/ })
    expect(checkbox).toBeEnabled()
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })
    expect(server).toHaveBeenCalledTimes(1)
    const search = screen.getByPlaceholderText('Проект, шифр, линия, спул или стык')
    fireEvent.change(search, { target: { value: 'F2' } })
    await waitFor(() => expect(server).toHaveBeenCalledTimes(2))
    expect(server.mock.calls[1][0].data.includeRowIds, JSON.stringify(server.mock.calls)).toEqual([1])
    expect(screen.getByRole('button', { name: 'Выбрано: 1' })).toBeInTheDocument()
    await act(async () => finishSearch([first, second]))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Выбрать стык L F2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Выбрано: 2' }))
    expect(screen.getByRole('checkbox', { name: /Выбрать стык L F1/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Выбрать стык L F2/ })).toBeChecked()
    expect(server).toHaveBeenCalledTimes(2)
  })
})
