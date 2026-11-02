import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ActivityDetailPage, ActivityDetails } from './activity-details'
import { ActivityValue } from './activity-value'
import type { ActivityRecord } from '@/lib/activity-presentation'
import { getActivityDetails } from '@/server/activity-api'

vi.mock('@/server/activity-api', () => ({ getActivityDetails: vi.fn() }))
const record: ActivityRecord = { id: 1, entity: 'generated_documents', label: 'Заявка ПСТО-126', jointId: null, kind: 'update', changes: {
  sourceMetadata: { before: JSON.stringify({ positionCount: 1, lines: ['Линия А'], rowIds: [1] }), after: JSON.stringify({ positionCount: 2, lines: ['Линия А', 'Линия Б'], rowIds: [1, 2] }) },
  type: { before: 'system:pstoRequest', after: 'system:pstoConclusion' },
} }
describe('activity details', () => {
  it('mounts one comparison at a time and searches only the loaded page', () => {
    render(<ActivityDetailPage rows={Array.from({ length: 50 }, (_, i) => ({ ...record, id: i + 1, label: `Заявка ${i + 1}` }))} page={1} hasNext />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Документ · Заявка 1 · Изменение' }))
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.getByText('Заявка ПСТО', { exact: true })).toBeVisible()
    expect(screen.queryByText('system:pstoRequest')).not.toBeInTheDocument()
    expect(screen.queryByText(/rowIds/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Документ · Заявка 2 · Изменение' }))
    expect(screen.getAllByRole('table')).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти запись на этой странице' }), { target: { value: 'Заявка 50' } })
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
  it('keeps old/unknown saved values intact without displaying technical dumps', () => {
    const saved = { ...record, changes: { futureField: { after: 'Сохранённое значение' }, sourceMetadata: { after: '{broken' }, blobKey: { after: 'sha-value' } } }
    const original = JSON.stringify(saved)
    render(<ActivityDetailPage rows={[saved]} page={1} hasNext={false} />)
    expect(screen.getByText('Обновлены дополнительные сведения.')).toBeVisible()
    expect(screen.queryByText(/Технические подробности/)).not.toBeInTheDocument()
    expect(screen.queryByText('Сохранённое значение')).not.toBeInTheDocument()
    expect(screen.queryByText('{broken')).not.toBeInTheDocument()
    expect(screen.queryByText('sha-value')).not.toBeInTheDocument()
    expect(JSON.stringify(saved)).toBe(original)
  })
  it('shows readable document fields without a second raw table or empty rows', () => {
    render(<ActivityDetailPage rows={[{ ...record, changes: { type: { after: 'system:pstoRequest' }, uploadedAt: { after: '2026-09-23T12:34:56.789Z' } } }]} page={1} hasNext={false} />)
    expect(screen.queryByText('system:pstoRequest')).not.toBeInTheDocument()
    expect(screen.getByText('Заявка ПСТО', { exact: true })).toBeVisible()
    expect(screen.queryByText('2026-09-23T12:34:56.789Z')).not.toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })
  it('compacts relation-only pages without exposing IDs or claiming missing records', () => {
    render(<ActivityDetailPage rows={Array.from({ length: 50 }, (_, i) => ({ ...record, id: i + 1, entity: 'generated_document_weld_joints', label: '', jointId: 1138,
      changes: { documentId: { before: 268, after: 217 } } }))} page={2} hasNext />)
    expect(screen.getByText('Обновлён состав связанных документов.')).toBeVisible()
    expect(screen.getByText('Записей на странице: 50')).toBeVisible()
    expect(screen.getByText('Страница 2 · есть продолжение')).toBeVisible()
    expect(screen.queryByText(/совпадений нет/)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/1138|268|217|documentId/)).not.toBeInTheDocument()
  })
  it('still reports a changed composition when only position identities differ', () => {
    const before = { positionCount: 1, lines: ['Линия А'], sourcePositions: [{ weldJointId: 2881, relationId: 2881, sequence: 1 }] }
    const after = { ...before, sourcePositions: [{ weldJointId: 6832, relationId: 6832, sequence: 1 }] }
    render(<ActivityDetailPage rows={[{ ...record, changes: { sourceMetadata: { before: JSON.stringify(before), after: JSON.stringify(after) } } }]} page={1} hasNext={false} />)
    expect(screen.getByText('Состав позиций документа изменён.')).toBeVisible()
    expect(screen.queryByText(/2881|6832|relationId|sourcePositions/)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
  it('does not expose nested internal fields or raw JSON at the expansion boundary', () => {
    const { rerender } = render(<ActivityValue entity="specialists" field="first" value={{ name: 'Иванов', id: 1234, sha256: 'private-hash', futureProperty: 'opaque-value' }} />)
    expect(screen.getByText('Иванов')).toBeVisible()
    expect(screen.queryByText(/1234|private-hash|futureProperty|opaque-value/)).not.toBeInTheDocument()
    rerender(<ActivityValue entity="specialists" field="first" value={{ id: 1234 }} depth={6} />)
    expect(screen.queryByText(/1234|"id"/)).not.toBeInTheDocument()
  })
  it('uses one value column for creation/deletion and preserves zero and false', () => {
    const { rerender } = render(<ActivityDetailPage rows={[{ ...record, kind: 'create', changes: { title: { after: 'Документ' }, rowCount: { after: 0 }, archived: { after: false } } }]} page={1} hasNext={false} />)
    expect(screen.queryByRole('columnheader', { name: 'Было' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Сохранено' })).toBeInTheDocument()
    expect(screen.getByText('0')).toBeVisible(); expect(screen.getByText('Нет')).toBeVisible()
    rerender(<ActivityDetailPage rows={[{ ...record, kind: 'delete', changes: { title: { before: 'Документ' } } }]} page={1} hasNext={false} />)
    expect(screen.getByRole('columnheader', { name: 'До удаления' })).toBeInTheDocument()
  })
  it('bounds rendered list items and text while keeping every part reachable', () => {
    const { unmount } = render(<ActivityValue entity="" field="lines" value={Array.from({ length: 2000 }, (_, i) => `Линия ${i + 1}`)} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: 'Следующая часть значения' }))
    expect(screen.getByText('Линия 21')).toBeVisible()
    expect(screen.queryByText('Линия 1')).not.toBeInTheDocument()
    unmount()
    render(<ActivityValue entity="" field="sourceMetadata" value={'x'.repeat(4000) + 'Последний фрагмент'} />)
    expect(screen.queryByText('Последний фрагмент')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Следующая часть значения' }))
    expect(screen.getByText('Последний фрагмент')).toBeVisible()
  })
  it('does not request details on expansion/search and releases pages after navigation/close', async () => {
    const load = vi.mocked(getActivityDetails)
    load.mockImplementation(async ({ data }) => ({ rows: [{ ...record, id: data.afterId ? 51 : 1 }, { ...record, id: data.afterId ? 52 : 2 }], nextCursor: data.afterId ? null : 50 }) as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { unmount } = render(<QueryClientProvider client={client}><ActivityDetails operationId="saved-operation" /></QueryClientProvider>)
    await screen.findByText('Записей на странице: 2')
    fireEvent.click(screen.getAllByRole('button', { name: /Документ · Заявка ПСТО-126/ })[0])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Состав' } })
    expect(load).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Следующие записи операции' }))
    await screen.findByText('Страница 2')
    expect(load).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущие записи' }))
    await screen.findByText('Страница 1 · есть продолжение')
    expect(load).toHaveBeenCalledTimes(3)
    unmount()
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0))
  })
})


describe('activity provenance sections', () => {
  it('opens the user change immediately and mounts automatic details only on demand', () => {
    const rows: ActivityRecord[] = [{ id: 1, entity: 'weld_joints', label: 'F1', kind: 'update', jointId: 7, changes: {
      vikResult: { before: 'ожидает НК', after: 'годен', origin: 'user' },
      finalStatus: { before: 'ожидает НК', after: 'годен', origin: 'automatic' },
    } }, { ...record, id: 2, changes: { title: { after: 'Заключение ВИК', origin: 'automatic' } } }]
    const snapshot = JSON.stringify(rows)
    render(<ActivityDetailPage rows={rows} page={1} hasNext={false} />)
    const user = screen.getByRole('region', { name: 'Изменения пользователя' })
    expect(within(user).getByText('годен', { exact: true })).toBeVisible()
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.queryByText('Итоговый результат', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Документ · Заявка ПСТО-126 · Изменение' })).not.toBeInTheDocument()
    const automatic = screen.getByRole('button', { name: /Автоматические изменения/ })
    expect(automatic).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(automatic)
    const recordButtons = screen.getAllByRole('button', { name: 'Стык · F1 · Изменение' })
    expect(recordButtons).toHaveLength(2)
    expect(recordButtons[0].getAttribute('aria-controls')).not.toBe(recordButtons[1].getAttribute('aria-controls'))
    fireEvent.click(recordButtons[1])
    expect(screen.getAllByRole('table')).toHaveLength(2)
    fireEvent.click(automatic)
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(JSON.stringify(rows)).toBe(snapshot)
  })
  it('keeps legacy records neutral and does not fabricate an author for them', () => {
    render(<ActivityDetailPage rows={[record]} page={1} hasNext={false} />)
    expect(screen.queryByRole('region', { name: 'Изменения пользователя' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Автоматические изменения/ })).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toBeVisible()
  })
  it('keeps large automatic pages unmounted and searchable without extra fetches', () => {
    render(<ActivityDetailPage rows={Array.from({ length: 50 }, (_, i) => ({ ...record, id: i + 1, label: `Заключение ${i + 1}`, changes: {
      sourceMetadata: { after: JSON.stringify({ lines: Array.from({ length: 2000 }, (_, n) => `Линия ${n}`) }), origin: 'automatic' as const },
    } }))} page={2} hasNext />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Линия 1999')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Заключение 50' } })
    fireEvent.click(screen.getByRole('button', { name: /Автоматические изменения/ }))
    expect(screen.getByRole('button', { name: 'Документ · Заключение 50 · Изменение' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Документ · Заключение 49 · Изменение' })).not.toBeInTheDocument()
    expect(screen.queryByText('Линия 1999')).not.toBeInTheDocument()
  })
})


it('retains historical events with no field snapshot instead of reporting no matches', () => {
  render(<ActivityDetailPage rows={[{ ...record, entity: 'account', label: 'Пользователь', changes: {} }]} page={1} hasNext={false} />)
  expect(screen.getByText('Обновлены дополнительные сведения.')).toBeVisible()
  expect(screen.queryByText(/совпадений нет/)).not.toBeInTheDocument()
})
