import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgramAssignmentTable, ProgramReadOnlyTable } from './line-program-assignment-table'
import { JointDetails } from './line-program-joint-details'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getProgramAssignmentError } from '@/lib/line-program-assignment-validation'

const mocks = vi.hoisted(() => ({ open: vi.fn(), registry: vi.fn(async () => ({ stamps: [] })) }))
vi.mock('@/server/welder-stamps', () => ({ loadWelderStampRegistrySnapshot: mocks.registry }))
vi.mock('@/lib/system-document-storage', () => ({ openSystemDocument: mocks.open }))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.clearAllMocks() })
const row: WeldRow = { id: 1, joint: 'F1', connectionType: 'С17', hasRk: 'да', vikResult: 'годен', rkResult: 'ремонт', rkRequest: 'Заявка-1', rkConclusion: 'Заключение-1' }
const duplicate = { id: 1, weldJointId: 1, method: 'УЗК' as const, result: 'вырез' as const, conclusion: 'ДУБЛЬ-1', conclusionDate: '2026-09-01', controlDate: '2026-09-01' }
function mountContent(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}
function mount(rows: WeldRow[]) {
  mountContent(<ProgramReadOnlyTable rows={rows} onAssignment={vi.fn()} />)
}

describe('compact joint rows preserve meaningful details', () => {
  const good: WeldRow = { id: 1, joint: 'F1', connectionType: 'С17', weldDate: '2026-09-01', hasVik: 'да', vikResult: 'годен' }
  const colorCases: [string, WeldRow, string, string | null][] = [
    ['good', good, 'годен', 'bg-emerald-50/70'],
    ['rejected', { ...good, vikResult: 'ремонт' }, 'не годен', 'bg-rose-50/70'],
    ['duplicate rejection', { ...good, duplicateControls: [duplicate] }, 'не годен по дублю', 'bg-rose-50/70'],
    ['cancelled method with rejection', { ...good, hasRk: 'отменен', rkResult: 'вырез' }, 'не годен', 'bg-rose-50/70'],
    ['one good method and another pending', { ...good, hasRk: 'да', finalStatus: 'годен' }, 'ожидает заявку', null],
    ['assignment without result', { ...good, vikResult: null }, 'ожидает заявку', null],
    ['error is not a good joint', { ...good, hasRk: null, rkResult: 'годен' }, 'ошибка', null],
    ['inactive historical good joint', { ...good, revisionActuality: 'не актуален', officiality: 'неофициальный' }, 'годен', 'bg-emerald-50/70'],
    ['disabled preheat rejection stays history', { ...good, preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'ремонт' }] }, 'годен', 'bg-emerald-50/70'],
  ]

  it.each(colorCases)('uses the same saved final-state tint in the list and assignments: %s', (_name, source, status, tone) => {
    mountContent(<><ProgramReadOnlyTable rows={[source]} onAssignment={vi.fn()} /><ProgramAssignmentTable rows={[source]} selected={new Set()} draft={new Map()} busy={false} canSelect={() => true} onSelect={vi.fn()} onSelectAll={vi.fn()} onChange={vi.fn()} getError={() => ''} /></>)
    for (const testId of ['line-program-readonly-joint', 'line-program-joint']) {
      const rendered = screen.getByTestId(testId)
      expect(rendered).toHaveAttribute('data-final-status', status)
      expect(rendered).toHaveAttribute('title', `Итоговое состояние: ${status}`)
      if (tone) expect(rendered).toHaveClass(tone)
      else expect(rendered.className).not.toMatch(/bg-(emerald|rose)-/)
    }
    if (source.revisionActuality === 'не актуален') {
      expect(screen.getAllByText('Неактуальный')).toHaveLength(2)
      expect(screen.getAllByText('Неофициальный')).toHaveLength(2)
    }
    expect(mocks.registry).not.toHaveBeenCalled()
  })

  it.each([['годен', 'bg-emerald-50/70'], ['ремонт', 'bg-rose-50/70']])('preserves %s tint on expansion, selection, focus and an unsaved assignment draft', (result, tone) => {
    const source = { ...good, vikResult: result }
    mountContent(<><ProgramReadOnlyTable rows={[source]} onAssignment={vi.fn()} /><ProgramAssignmentTable rows={[source]} selected={new Set([1])} focusedJoint={1} draft={new Map([[1, { ...source, hasRk: 'да' }]])} busy={false} canSelect={() => true} onSelect={vi.fn()} onSelectAll={vi.fn()} onChange={vi.fn()} getError={() => ''} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'F1' }))
    expect(screen.getByTestId('line-program-readonly-joint')).toHaveClass(tone, 'shadow-[inset_1px_0_0_#0284c7]')
    const assignment = screen.getByTestId('line-program-joint')
    expect(assignment).toHaveClass(tone)
    expect(assignment).toHaveAttribute('data-highlighted', 'true')
    expect(assignment).not.toHaveClass('bg-sky-50')
    expect(screen.getByRole('checkbox', { name: 'Выбрать F1' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'F1 · РК' })).toHaveValue('да')
  })

  it.each(['отменен', 'дополнительный'])('omits the redundant PVK hint but preserves layered validation for %s', hasPvk => {
    const source: WeldRow = { id: 1, joint: 'F1', connectionType: 'У19', weldDate: '2026-09-01', stamp1K: 'D1', hasPvk }
    mountContent(<ProgramAssignmentTable rows={[source]} selected={new Set()} draft={new Map()} busy={false} canSelect={() => true} onSelect={vi.fn()} onSelectAll={vi.fn()} onChange={vi.fn()} getError={(current, method, value) => getProgramAssignmentError(current, { [method]: value })} />)
    expect(screen.queryByText('Сначала ПВК → Да')).not.toBeInTheDocument()
    const layered = screen.getByRole('combobox', { name: 'F1 · Послойный ПВК' })
    expect(within(layered).getByRole('option', { name: 'Да' })).toBeDisabled()
    expect(getProgramAssignmentError(source, { 'Послойный ПВК': 'да' })).toMatch(/Подтвердите перевод ПВК/)
    expect(getProgramAssignmentError(source, { ПВК: 'да', 'Послойный ПВК': 'да' })).toBe('')
  })

  it('labels every result stage consistently and keeps the result column part of the same table', () => {
    const source = { ...row, id: 2, joint: 'F2', duplicateControls: [duplicate], preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ id: 1, weldJointId: 2, method: 'ВИК' as const, result: 'годен' }] }
    const onSelect = vi.fn(), onChange = vi.fn(), open = vi.spyOn(window, 'open')
    mountContent(<ProgramAssignmentTable rows={[row, source]} selected={new Set([2])} draft={new Map()} busy={false} canSelect={() => true} onSelect={onSelect} onSelectAll={vi.fn()} onChange={onChange} getError={() => ''} />)
    const table = screen.getByRole('table', { name: 'Стыки и назначения всех методов' })
    expect(table.parentElement).not.toHaveClass('border-y')
    expect(table).toHaveClass('border-collapse')
    expect(screen.getByRole('columnheader', { name: 'Результат' }).className).toBe(screen.getByRole('columnheader', { name: 'РК' }).className)
    for (const joint of ['F1', 'F2']) {
      const result = screen.getByLabelText(`Результат ${joint}`)
      expect(result).not.toBeVisible()
      fireEvent.click(result.closest('details')!.querySelector('summary')!)
      expect(within(result).getByText('Основной этап')).toBeVisible()
      expect(result.closest('td')?.className).toBe(result.closest('tr')?.querySelector('td')?.className)
      expect(within(result).queryByRole('button')).not.toBeInTheDocument()
      expect(within(result).queryByRole('link')).not.toBeInTheDocument()
      fireEvent.click(within(result).getByText('РК: ремонт')) // has a linked conclusion
    }
    const result = screen.getByLabelText('Результат F2')
    expect(result).toHaveTextContent('НК до ТО · не учитывается')
    expect(result).toHaveTextContent('Дубли контроля')
    expect(open).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.registry).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('colors a legacy rejected result red in the compact summary', () => {
    mountContent(<ProgramAssignmentTable rows={[{ id: 1, joint: 'F1', vikResult: 'не годен' }]} selected={new Set()} draft={new Map()} busy={false} canSelect={() => true} onSelect={vi.fn()} onSelectAll={vi.fn()} onChange={vi.fn()} getError={() => ''} />)
    expect(screen.getByText('ВИК: не годен')).toHaveClass('text-rose-700')
  })

  it('shows four distinct stamps from both sets and saved results independently of a draft', () => {
    const source = { ...row, stamp1K: 'D1', stamp1Z: 'D2', stamp1O: 'D1', stamp2K: 'D3', stamp2Z: 'D4', stamp2O: 'D2', weldDate: '2026-09-01' }
    const onSelect = vi.fn()
    mountContent(<ProgramAssignmentTable rows={[source]} selected={new Set()} draft={new Map([[1, { ...source, hasRk: 'отменен', rkResult: null }]])} busy={false} canSelect={() => true} onSelect={onSelect} onSelectAll={vi.fn()} onChange={vi.fn()} getError={() => ''} />)
    const metadata = screen.getByTestId('program-joint-metadata')
    expect(within(metadata).getByText('01.09.2026')).toBeVisible()
    for (const stamp of ['D1', 'D2', 'D3', 'D4']) expect(within(metadata).getByText(stamp)).toBeVisible()
    expect(screen.getByLabelText('Результат F1')).toHaveTextContent('РК: ремонт')
    expect(screen.getByRole('combobox', { name: 'F1 · РК' })).toHaveValue('отменен')
    fireEvent.click(screen.getByText('ВИК: годен'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(mocks.registry).not.toHaveBeenCalled()
  })

  it('hides the preheat counter and opens an empty assignment without expanding history', () => {
    const onAssignment = vi.fn()
    mountContent(<ProgramReadOnlyTable rows={[{ ...row, hasRk: null, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'годен' }] }]} onAssignment={onAssignment} />)
    expect(screen.queryByRole('button', { name: /НК до ТО/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /В журнал/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Назначение F1: нет назначений' }))
    expect(onAssignment).toHaveBeenCalledWith(1)
    expect(screen.queryByLabelText('История контроля F1')).not.toBeInTheDocument()
  })

  it.each([
    ['годен', 'bg-emerald-50/70'], ['ремонт', 'bg-rose-50/80'], ['вырез', 'bg-rose-50/80'],
    ['не годен', 'bg-rose-50/80'], ['ожидает НК', 'bg-amber-50/70'], [null, 'bg-slate-50'],
  ])('colors history %s and formats dates without changing document identity', (result, tone) => {
    mountContent(<JointDetails row={{ id: 1, joint: 'F1', line: 'L-1', vikResult: result, vikConclusion: 'ИСТОРИЯ', vikConclusionDate: '2026-09-11' }} />)
    expect(screen.getByText('Стык F1')).toBeVisible()
    expect(screen.getByText('· L-1')).toBeVisible()
    expect(screen.getByTestId('control-history-row')).toHaveClass(tone)
    expect(screen.getByText('11.09.2026')).toBeVisible()
    expect(screen.queryByText('2026-09-11')).not.toBeInTheDocument()
  })

  it('shows compact ordered colored statuses and toggles details by the entire row without editing', () => {
    const onAssignment = vi.fn()
    mountContent(<ProgramReadOnlyTable rows={[{ ...row, hasRk: 'отменен', hasUzk: 'дополнительный', hasPvk: 'да' }]} onAssignment={onAssignment} />)
    const table = screen.getByRole('table', { name: 'Назначения и результаты' })
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Стык', 'Сварка / клейма', 'Назначения', 'Результаты'])
    expect(within(table).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(table).getByText('РК: отменен')).toHaveClass('text-rose-700')
    expect(within(table).getByText('УЗК: доп')).toHaveClass('text-sky-700')
    expect(within(table).getByText('ПВК: да')).toHaveClass('text-emerald-700')
    expect(within(table).getByRole('button', { name: 'РК ремонт · назначение отменено' })).toHaveClass('text-rose-700')
    const joint = screen.getByTestId('line-program-readonly-joint')
    fireEvent.click(joint)
    expect(screen.getByRole('button', { name: 'F1' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(table).getByRole('button', { name: 'Заявка-1' })).toBeVisible()
    expect(within(table).getByRole('button', { name: 'Заключение-1' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Назначение F1 · ПВК: да' }))
    expect(onAssignment).toHaveBeenCalledWith(1, 'ПВК')
    expect(screen.getByLabelText('История контроля F1')).toBeVisible()
    fireEvent.click(joint)
    expect(screen.queryByLabelText('История контроля F1')).not.toBeInTheDocument()
    expect(mocks.registry).not.toHaveBeenCalled()
  })

  it('keeps saved results beside assignment columns and independent checkbox/cell editing', () => {
    const onSelect = vi.fn(), onChange = vi.fn()
    mountContent(<ProgramAssignmentTable rows={[row]} selected={new Set()} draft={new Map()} busy={false} canSelect={() => true} onSelect={onSelect} onSelectAll={vi.fn()} onChange={onChange} getError={() => ''} />)
    expect(screen.getAllByRole('columnheader').slice(-5).map(node => node.textContent)).toEqual(['РК', 'УЗК', 'ПВК', 'Послойный ПВК', 'Результат'])
    expect(screen.getByRole('columnheader', { name: 'Результат' })).toBeVisible()
    expect(screen.getByLabelText('Результат F1')).toHaveTextContent('ВИК: годенРК: ремонт')
    expect(screen.queryByText('Заключение-1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Выбрать F1'))
    expect(onSelect).toHaveBeenCalledWith(1, true)
    fireEvent.change(screen.getByRole('combobox', { name: 'F1 · РК' }), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(row, 'РК', '')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows rejected pre-heat history and duplicate results before expansion and labels disabled history honestly', () => {
    mount([{ ...row, preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'ремонт', requestName: 'ДО-ТО-1', conclusionName: 'ИСТОРИЯ-1' }], duplicateControls: [duplicate] }])
    const history = screen.getByRole('button', { name: 'НК до ТО · история, не учитывается: РК ремонт' })
    expect(history).toHaveClass('text-rose-700')
    expect(screen.getByRole('button', { name: 'Дубли: УЗК вырез' })).toHaveClass('text-rose-700')
    const cells = within(screen.getByTestId('line-program-readonly-joint')).getAllByRole('cell')
    expect(cells[0]).not.toContainElement(history)
    expect(cells[3]).toContainElement(history)
    const results = within(cells[3]).getAllByRole('button')
    expect(results[0]).toBe(history)
    expect(results.at(-1)).toBe(screen.getByRole('button', { name: 'Дубли: УЗК вырез' }))
    expect(screen.queryByText('ДУБЛЬ-1')).not.toBeInTheDocument()
    fireEvent.click(history)
    expect(screen.getByText('История: НК до ТО выключен, в расчёте не учитывается.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'ИСТОРИЯ-1' })).toBeVisible()
    expect(screen.getByText('ДУБЛЬ-1')).toBeVisible()
    expect(screen.getByText('Контроль: 01.09.2026')).toBeVisible()
  })

  it('shows waiting-only preheat and layered assignments without inventing performed results; expands multiple joints independently', () => {
    mount([{ ...row, id: 1, joint: 'F1', connectionType: 'У17', layeredControlAssigned: true, rkResult: null, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', requestName: 'ОЖИДАНИЕ' }] }, { ...row, id: 2, joint: 'F2' }])
    fireEvent.click(screen.getByRole('button', { name: 'Послойный ПВК Назначен · ожидает основного ПВК' }))
    expect(screen.getByText('Назначен · документов: 0 / 4')).toBeVisible()
    expect(screen.getByText('ВИК: результата нет')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'F2' }))
    expect(screen.getByText('Назначен · документов: 0 / 4')).toBeVisible()
    expect(within(screen.getByLabelText('История контроля F2')).getByRole('button', { name: 'Заключение-1' })).toBeVisible()
  })

  it('orders stages and preserves separate primary/repeated PSTO documents and partial records', async () => {
    const preview = { closed: false, opener: null, document: { title: '', body: { textContent: '' } } } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(preview)
    mountContent(<JointDetails row={{ ...row, rkRequestDate: '2026-09-10', rkConclusionDate: '2026-09-11',
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', requestName: 'ДО-ТО', requestDate: '2026-09-01', conclusionName: 'ДО-ТО-РЕЗ', conclusionDate: '2026-09-02' }],
      pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-09-03', pstoResult: 'проведено', heatTreatmentDiagram: 'ДИАГРАММА-1', pstoDate: '2026-09-04',
      tvmtRequest: 'ТВМТ-1', tvmtRequestDate: '2026-09-05', tvmtConclusion: 'ТВМТ-РЕЗ-1', tvmtConclusionDate: '2026-09-06',
      pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО-2', pstoRequestDate: '2026-09-07', tvmtConclusion: 'ТВМТ-РЕЗ-2', tvmtConclusionDate: '2026-09-09' }],
    }} />)
    expect(screen.getAllByRole('heading').map(node => node.textContent)).toEqual(['НК до ТО', 'ПСТО и ТВМТ', 'Основной этап'])
    expect(screen.getAllByRole('columnheader').slice(0, 4).map(node => node.textContent)).toEqual(['Контроль', 'Заявка', 'Заключение', 'Дефекты'])
    for (const [title, scope] of [
      ['ДО-ТО', { type: 'lnkRequest', sourceKind: 'beforeHeatTreatment', date: '2026-09-01' }],
      ['ДО-ТО-РЕЗ', { type: 'lnkConclusion', sourceKind: 'beforeHeatTreatment', methodCode: 'РК' }],
      ['ПСТО-1', { type: 'pstoRequest', sourceKind: 'pstoCycle', cycleSequences: [1] }],
      ['ТВМТ-РЕЗ-2', { type: 'lnkConclusion', sourceKind: 'pstoCycle', cycleSequences: [2], methodCode: 'ТВМТ' }],
      ['Заключение-1', { type: 'lnkConclusion', methodCode: 'РК', date: '2026-09-11' }],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: title }))
      await vi.waitFor(() => expect(mocks.open).toHaveBeenLastCalledWith(expect.objectContaining({ reference: expect.objectContaining({ title, ...scope }), previewWindow: preview })))
    }
    expect(mocks.registry).toHaveBeenCalledOnce()
    expect(screen.getByText('РК: результата нет')).toBeVisible()
    expect(screen.getByText('ПСТО · цикл 2: результата нет')).toBeVisible()
  })
})
