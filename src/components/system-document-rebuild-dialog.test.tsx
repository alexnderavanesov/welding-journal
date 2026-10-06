import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RebuildItemsPage, SystemDocumentRebuildDialog } from './system-document-rebuild-dialog'
import { GENERATED_DOCUMENT_HISTORY_QUERY_KEY, WELD_COMPLETE_SNAPSHOT_QUERY_KEY } from '@/lib/weld-query-utils'

const rpc = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }))
vi.mock('@/server/system-document-rebuild', () => ({ previewSystemDocumentRebuild: rpc.preview, applySystemDocumentRebuild: rpc.apply }))
beforeEach(() => { rpc.preview.mockReset(); rpc.apply.mockReset() })

it('clears a resolved oversized warning when the same packet is checked again', async () => {
  const preview = { fingerprint: 'f', scopeRevisions: {}, documentsJson: [],
    batch: { cursor: { afterId: 0, throughId: 2 }, nextCursor: null, documentIds: [], documentLimit: 200, positionLimit: 60000,
      blocked: [{ documentId: 1, title: 'Большой документ', reason: 'Превышен безопасный объём' }] } }
  rpc.preview.mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, batch: { ...preview.batch, blocked: [] } })
  const client = new QueryClient()
  render(<QueryClientProvider client={client}><SystemDocumentRebuildDialog open onClose={() => {}} onApplied={() => {}}
    runProtectedSettingsChange={async action => { await action(); return true }} /></QueryClientProvider>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Большой документ')
  fireEvent.click(screen.getByRole('button', { name: 'Обновить предпросмотр' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(rpc.preview.mock.calls[1][0]).toEqual({ data: { cursor: { afterId: 0, throughId: 2 } } })
  expect(rpc.apply).not.toHaveBeenCalled()
  client.clear()
})

it('never automatically applies the next packet and keeps completed packets when the next one fails', async () => {
  const makePreview = (id: number, next: boolean) => ({ fingerprint: `f${id}`, scopeRevisions: {},
    batch: { cursor: { afterId: id - 1, throughId: 2 }, nextCursor: next ? { afterId: id, throughId: 2 } : null,
      documentIds: [id], blocked: [], documentLimit: 200, positionLimit: 60000 },
    documentsJson: [JSON.stringify({ documentId: id, templateId: 'pstoRequest', type: 'pstoRequest', title: `Old${id}`,
      isSystemName: true, willChangeAutomatically: true, groups: [{ key: 'L', label: 'L', rowIds: [id], rowCount: 1, previewName: `New${id}`, joints: [] }] })] })
  rpc.preview.mockResolvedValueOnce(makePreview(1, true)).mockResolvedValueOnce(makePreview(2, false))
  rpc.apply.mockResolvedValueOnce({ rebuiltDocumentCount: 1, affectedRowCount: 1 }).mockRejectedValueOnce(new Error('Failed query: update weld_joints set vik_request=...'))
  const client = new QueryClient(), onClose = vi.fn(), onApplied = vi.fn()
  render(<QueryClientProvider client={client}><SystemDocumentRebuildDialog open onClose={onClose} onApplied={onApplied}
    runProtectedSettingsChange={async action => { await action(); return true }} /></QueryClientProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Применить пересборку' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Применить пересборку' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Пакет 1 сохранён')
  expect(onClose).not.toHaveBeenCalled()
  expect(rpc.preview).toHaveBeenCalledTimes(1)
  expect(rpc.apply).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Следующий пакет' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Применить пересборку' })).toBeEnabled())
  expect(rpc.preview.mock.calls[1][0]).toEqual({ data: { cursor: { afterId: 1, throughId: 2 } } })
  expect(rpc.apply).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Применить пересборку' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подтвердить сохранение пакета')
  expect(screen.getByRole('alert')).not.toHaveTextContent('update weld_joints')
  expect(onApplied).toHaveBeenCalledTimes(1)
  expect(rpc.apply.mock.calls[1][0].data.cursor).toEqual({ afterId: 1, throughId: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  client.clear()
})

it('does not close or resubmit while saving, and offers correction after failure', async () => {
  rpc.preview.mockResolvedValue({ fingerprint: 'f', scopeRevisions: {}, documentsJson: [JSON.stringify({ documentId: 1, templateId: 'pstoRequest',
    type: 'pstoRequest', label: 'Заявка ПСТО', title: 'Old', date: '2026-09-01', isSystemName: true,
    willChangeAutomatically: true, requiresCustomNameDecision: false,
    groups: [{ key: 'L', label: 'L', rowIds: [1], rowCount: 1, previewName: 'New', joints: ['S1'] }],
  })] })
  let fail!: (reason: Error) => void
  rpc.apply.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), onClose = vi.fn(), onApplied = vi.fn()
  render(<QueryClientProvider client={client}><SystemDocumentRebuildDialog open onClose={onClose} onApplied={onApplied}
    runProtectedSettingsChange={async action => { await action(); return true }} /></QueryClientProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Применить пересборку' })).toBeEnabled())
  const snapshot = await rpc.preview.mock.results[0].value
  let refreshed!: (value: unknown) => void
  rpc.preview.mockImplementationOnce(() => new Promise(resolve => { refreshed = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Обновить предпросмотр' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Применить пересборку' })).toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Применить пересборку' }))
  expect(rpc.apply).not.toHaveBeenCalled()
  await act(async () => refreshed(snapshot))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Применить пересборку' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Применить пересборку' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Применяю...' })).toBeDisabled())
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Применяю...' }))
  expect(rpc.apply).toHaveBeenCalledTimes(1)
  await act(async () => fail(new Error('Предпросмотр устарел. Обновите его.')))
  expect(await screen.findByText('Предпросмотр устарел. Обновите его.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Обновить предпросмотр' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onApplied).not.toHaveBeenCalled()
  client.clear()
})

it('renders bounded pages of 200000 groups and allows viewing beyond the first hundred', () => {
  const items = Array.from({ length: 200_000 }, (_, i) => i + 1)
  const view = (values: number[]) => <RebuildItemsPage items={values} label="группы">{page => page.map(id => <p key={id} data-testid="group">{id}</p>)}</RebuildItemsPage>
  const { rerender } = render(view(items))
  expect(screen.getAllByTestId('group')).toHaveLength(50)
  expect(screen.getAllByTestId('group')[0]).toHaveTextContent('1')
  fireEvent.click(screen.getByRole('button', { name: 'Далее: группы' }))
  fireEvent.click(screen.getByRole('button', { name: 'Далее: группы' }))
  expect(screen.getAllByTestId('group')).toHaveLength(50)
  expect(screen.getAllByTestId('group')[0]).toHaveTextContent('101')
  fireEvent.click(screen.getByRole('button', { name: 'Назад: группы' }))
  expect(screen.getAllByTestId('group')[0]).toHaveTextContent('51')
  rerender(view([1, 2]))
  expect(screen.getAllByTestId('group')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Далее: группы' })).not.toBeInTheDocument()
})

it('invalidates cached history and welds only after success without refetching inactive large datasets', async () => {
  rpc.preview.mockResolvedValue({ fingerprint: 'f', scopeRevisions: {}, documentsJson: [JSON.stringify({ documentId: 1, templateId: 'pstoRequest',
    type: 'pstoRequest', label: 'Заявка ПСТО', title: 'Old', date: '2026-09-01', isSystemName: true, systemNumber: '1',
    willChangeAutomatically: true, requiresCustomNameDecision: false,
    groups: [{ key: 'L', label: 'L', rowIds: [1], rowCount: 1, previewName: 'New', joints: ['S1'], isMissingValueFallback: false }],
  })] })
  rpc.apply.mockResolvedValue({ rebuiltDocumentCount: 1, resultingDocumentCount: 1, affectedRowCount: 1 })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const history = vi.fn(async () => ['Old']), welds = vi.fn(async () => [{ id: 1, pstoRequest: 'Old' }])
  await client.fetchQuery({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY, queryFn: history })
  await client.fetchQuery({ queryKey: WELD_COMPLETE_SNAPSHOT_QUERY_KEY, queryFn: welds })
  const onApplied = vi.fn()
  render(<QueryClientProvider client={client}><SystemDocumentRebuildDialog open onClose={() => {}} onApplied={onApplied}
    runProtectedSettingsChange={async action => { await action(); return true }} /></QueryClientProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Применить пересборку' })).toBeEnabled())
  expect(client.getQueryState(GENERATED_DOCUMENT_HISTORY_QUERY_KEY)?.isInvalidated).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Применить пересборку' }))
  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
  expect(client.getQueryState(GENERATED_DOCUMENT_HISTORY_QUERY_KEY)?.isInvalidated).toBe(true)
  expect(client.getQueryState(WELD_COMPLETE_SNAPSHOT_QUERY_KEY)?.isInvalidated).toBe(true)
  expect(history).toHaveBeenCalledTimes(1)
  expect(welds).toHaveBeenCalledTimes(1)
  expect(rpc.preview).toHaveBeenCalledTimes(1)
  expect(rpc.apply).toHaveBeenCalledTimes(1)
  client.clear()
})
