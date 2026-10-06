import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CoilRestorationDialog, CoilRestorationHistory } from './coil-restoration-dialog'

const mocks = vi.hoisted(() => ({ preview: vi.fn(), restore: vi.fn(), history: vi.fn(), password: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/server/coil-restoration', () => ({ previewCoilRestoration: mocks.preview, previewEarlyCoilCorrection: mocks.preview,
  restoreErroneousCoil: mocks.restore, cancelErroneousEarlyCoil: mocks.restore, getCoilRestorationHistory: mocks.history }))
vi.mock('@/lib/security-context', () => ({ useSecurityGuard: () => ({ requireEditPassword: mocks.password,
  requireDeletePassword: mocks.password, requireSettingsChangePassword: mocks.password }) }))
vi.mock('@/lib/weld-query-utils', () => ({ scheduleWeldDataRefresh: mocks.invalidate }))
const preview = { rootId: 1, token: 'a'.repeat(64), joint: 'S1', line: 'L', reason: null, chain: [{ id: 1, joint: 'S1' }], cancelledEarlyDecisions: 0,
  before: { joints: 23, calculationJoints: 23, common: { required: 2 } }, after: { joints: 24, calculationJoints: 24 }, stampChanges: [] }
function mount(rootId = 1, earlyDecision = false) {
  const props = { rootId, earlyDecision, onClose: vi.fn(), onSaved: vi.fn(), onOpenReport: vi.fn(), onRestored: vi.fn() }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><CoilRestorationDialog {...props} /></QueryClientProvider>)
  return { ...props, client }
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.preview.mockResolvedValue(preview); mocks.restore.mockResolvedValue({ alreadyApplied: false }); mocks.password.mockResolvedValue(true); mocks.history.mockResolvedValue([])
})
describe('explicit coil restoration UI', () => {
  const source = { id: 1, joint: 'S1', line: 'L', projectTitle: 'P', subtitleCode: 'C' }
  const side = { ...source, id: 3, joint: 'S1Y1' }
  const checklist = { sourceRows: [source], replacementRows: [side], historyRows: [side], weldedRows: [side], earlySources: [], replacedByCoil: true }
  it('opens the relevant saved records without doing a mutation or automatically restoring the root', async () => {
    mocks.preview.mockResolvedValue({ ...preview, chain: [source, side], reason: 'Сохранились стороны катушки', checklist })
    const props = mount()
    await screen.findByRole('region', { name: 'Шаги исправления ошибочной катушки' })
    expect(screen.getByText('Связанные записи: S1, S1Y1')).toBeVisible()
    expect(screen.getByText('2. Ошибочная катушка — осталось записей: 1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть НК сторон' }))
    expect(props.onOpenReport).toHaveBeenCalledWith([side], 'lnk')
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it('rechecks steps from current state, not manually saved checkboxes', async () => {
    mocks.preview.mockResolvedValueOnce({ ...preview, reason: 'Сохранились стороны катушки', checklist })
      .mockResolvedValue({ ...preview, checklist: { ...checklist, replacementRows: [], historyRows: [], weldedRows: [] } })
    mount()
    await screen.findByText('2. Ошибочная катушка — осталось записей: 1')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
    await screen.findByText('3. Исходная цепочка — готова к подтверждению')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Восстановить исходное соединение' })).toBeDisabled()
    expect(mocks.preview).toHaveBeenCalledTimes(2)
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it('opens the dedicated early-decision correction and returns on Escape without closing the helper', async () => {
    mocks.preview.mockResolvedValue({ ...preview, reason: 'Сохранились стороны катушки', checklist: { ...checklist, earlySources: [source] } })
    const props = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить отмену досрочного решения · S1' }))
    await screen.findByRole('heading', { name: 'Отменить ошибочное досрочное решение' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findByRole('heading', { name: 'Отменить ошибочно внесённую катушку' })
    expect(props.onClose).not.toHaveBeenCalled()
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it('does not silently interpret a history loading error as no confirmations', async () => {
    mocks.history.mockRejectedValueOnce(new Error('Нет связи')).mockResolvedValue([])
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить историю отмен')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку истории' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'История отмен ошибочной катушки' })).not.toBeInTheDocument()
  })
  it('does not show empty restoration history on an ordinary F901', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><CoilRestorationHistory rootId={1424} /></QueryClientProvider>)
    await waitFor(() => expect(mocks.history).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'История отмен ошибочной катушки' })).not.toBeInTheDocument()
    expect(screen.queryByText('Подтверждённых отмен нет.')).not.toBeInTheDocument()
  })
  it('requires physical confirmation but does not request a name', async () => {
    mount()
    await screen.findByText('23 → 24')
    expect(screen.queryByLabelText('ФИО подтвердившего')).not.toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Восстановить исходное соединение' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(save).toBeEnabled()
  })
  it('invalidates only the physical root history when the early decision belongs to its repair', async () => {
    const props = mount(2, true)
    props.client.setQueryData(['coil-restoration-history', 1], [])
    await screen.findByText('23 → 24')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Отменить решение и удалить очищенные стороны' }))
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce())
    expect(mocks.restore).toHaveBeenCalledWith({ data: { rootId: 2, token: preview.token, confirmedNotInstalled: true } })
    expect(props.onRestored).not.toHaveBeenCalled()
    expect(props.client.getQueryState(['coil-restoration-history', 1])?.isInvalidated).toBe(false)
    expect(mocks.history).toHaveBeenCalledOnce()
    expect(mocks.history).not.toHaveBeenCalledWith({ data: { rootId: 2 } })
  })
  it.each(['cancel', 'escape'])('does not mutate on %s; loading, focus and reconnect do not multiply requests', async mode => {
    const props = mount()
    await screen.findByText('23 → 24')
    fireEvent.focus(window); window.dispatchEvent(new Event('online'))
    expect(mocks.preview).toHaveBeenCalledOnce()
    expect(mocks.history).toHaveBeenCalledOnce()
    if (mode === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    else fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it('requires explicit physical confirmation, coalesces clicks, and shows real history without another request on expansion', async () => {
    mocks.history.mockResolvedValue([{ confirmedAt: '2026-09-30T09:00:00Z', confirmedBy: 'Иванов И. И.', operation: 'restore', counts: '23 → 24 соединений' }])
    const props = mount()
    const save = screen.getByRole('button', { name: 'Восстановить исходное соединение' })
    await screen.findByText('23 → 24')
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    let release!: (value: { alreadyApplied: boolean }) => void
    mocks.restore.mockImplementation(() => new Promise(resolve => { release = resolve }))
    fireEvent.click(save); fireEvent.click(save)
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledOnce())
    expect(mocks.restore).toHaveBeenCalledWith({ data: { rootId: 1, token: preview.token, confirmedNotInstalled: true } })
    expect(props.onClose).not.toHaveBeenCalled()
    release({ alreadyApplied: false })
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce())
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(props.onRestored).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'История отмен ошибочной катушки' }))
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/Иванов И. И.: подтверждено/)).toBeVisible()
    expect(screen.queryByText(/Последние 20 подтверждений|Имена в прежних записях/)).not.toBeInTheDocument()
  })
  it('shows an incomplete-history blocker without offering a physical confirmation', async () => {
    mocks.preview.mockResolvedValue({ ...preview, reason: 'Сохранилась сторона катушки' })
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Сохранилась сторона')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Восстановить исходное соединение' })).toBeDisabled()
  })
  it('keeps the dialog after a stale-state rejection and requires a new check and confirmation', async () => {
    mocks.restore.mockRejectedValueOnce(new Error('Цепочка изменилась'))
    const props = mount()
    await screen.findByText('23 → 24')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить исходное соединение' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Цепочка изменилась')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2))
    expect(mocks.restore).toHaveBeenCalledOnce()
  })
})
