import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreHeatTreatmentFillDialog } from './pre-heat-treatment-fill-dialog'
import { previewPreHeatTreatmentFill } from '@/server/pre-heat-treatment-api'
import { DEFAULT_SYSTEM_DOCUMENT_SPLIT_SETTINGS } from '@/lib/system-document-splitting'

vi.mock('@/server/pre-heat-treatment-api', () => ({ previewPreHeatTreatmentFill: vi.fn(), savePreHeatTreatmentFill: vi.fn() }))
vi.mock('./specialist-select', () => ({ SpecialistSelect: () => null, useSpecialistOptions: () => [] }))
type Preview = Awaited<ReturnType<typeof previewPreHeatTreatmentFill>>
const item = { key: '1:result:ВИК', rowId: 1, joint: 'F1', location: 'P · L', action: 'result' as const, methods: ['ВИК' as const], date: '2026-11-01', manualDate: false, manualName: false }
const makePreview = (extra: Partial<Preview> = {}): Preview => ({ items: [item], groups: [{ key: 'g', action: 'result', date: item.date, name: 'Заключение', useSystemName: true, items: [item], positions: [{ rowId: 1, methodCode: 'ВИК' }], splitMode: 'none', splitSettingId: 'lnkConclusionVik' }], token: 'token', errors: [], issues: [], selectedCount: 1, existing: [], specialists: {}, splitModes: DEFAULT_SYSTEM_DOCUMENT_SPLIT_SETTINGS, ...extra })
const pending = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><PreHeatTreatmentFillDialog rowIds={[1]} onClose={vi.fn()} /></QueryClientProvider>)
beforeEach(() => { vi.clearAllMocks(); Element.prototype.scrollIntoView = vi.fn() })
afterEach(cleanup)

describe('preliminary fill preview stability', () => {
  it('keeps the actual input, focus, selection, scroll and open details during a delayed preview and on failure', async () => {
    const response = pending<Preview>()
    vi.mocked(previewPreHeatTreatmentFill).mockResolvedValueOnce(makePreview()).mockReturnValueOnce(response.promise)
    mount()
    const input = await screen.findByLabelText(`Название ${item.key}`) as HTMLInputElement
    const details = screen.getByText(/Состав создаваемых документов/).closest('details')!
    details.open = true
    const body = input.closest('fieldset')!; body.scrollTop = 180
    input.focus()
    fireEvent.change(input, { target: { value: 'Новое название' } })
    input.setSelectionRange(4, 4)
    await waitFor(() => expect(previewPreHeatTreatmentFill).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText(`Название ${item.key}`)).toBe(input)
    expect(input).toHaveFocus(); expect(input.selectionStart).toBe(4)
    expect(details.open).toBe(true); expect(body.scrollTop).toBe(180)
    expect(screen.getByRole('button', { name: 'Заполнить недостающее как «Годен»' })).toBeDisabled()
    await act(async () => response.reject(new Error('Не удалось обновить предпросмотр')))
    expect(await screen.findByText('Не удалось обновить предпросмотр')).toBeVisible()
    expect(screen.getByLabelText(`Название ${item.key}`)).toBe(input)
    expect(input).toHaveValue('Новое название'); expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Заполнить недостающее как «Годен»' })).toBeDisabled()
  })

  it('ignores late obsolete responses and preserves the latest manual text', async () => {
    const first = pending<Preview>(), second = pending<Preview>()
    vi.mocked(previewPreHeatTreatmentFill).mockResolvedValueOnce(makePreview()).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mount()
    const input = await screen.findByLabelText(`Название ${item.key}`)
    fireEvent.change(input, { target: { value: 'Первое' } })
    await waitFor(() => expect(previewPreHeatTreatmentFill).toHaveBeenCalledTimes(2))
    fireEvent.change(input, { target: { value: 'Второе' } })
    await waitFor(() => expect(previewPreHeatTreatmentFill).toHaveBeenCalledTimes(3))
    await act(async () => second.resolve(makePreview({ token: 'new' })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Заполнить недостающее как «Годен»' })).toBeEnabled())
    await act(async () => first.resolve(makePreview({ errors: ['Старая ошибка'] })))
    expect(input).toHaveValue('Второе'); expect(screen.queryByText('Старая ошибка')).not.toBeInTheDocument()
  })

  it('marks only the affected field and navigates to a problem on another page', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ ...item, key: `${i + 1}:result:ВИК`, rowId: i + 1, joint: `F${i + 1}` }))
    const message = 'Стык F51: дата раньше ВИК.'
    vi.mocked(previewPreHeatTreatmentFill).mockResolvedValue(makePreview({ items, errors: [message], issues: [{ rowId: 51, itemKey: items[50]!.key, field: 'date', message }] }))
    mount()
    const link = await screen.findByRole('button', { name: message })
    expect(screen.getByLabelText(`Дата ${item.key}`)).not.toHaveAttribute('aria-invalid')
    fireEvent.click(link)
    const date = screen.getByLabelText('Дата 51:result:ВИК')
    expect(date).toHaveFocus(); expect(date).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Название 51:result:ВИК')).not.toHaveAttribute('aria-invalid')
    expect(date.closest('tr')).toHaveClass('bg-rose-50/70')
  })
})
