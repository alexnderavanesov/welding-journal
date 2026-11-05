import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import type { ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { LineProgramRecord } from '@/lib/line-program'
import type { LineProgramOverview } from '@/lib/line-program-overview'
import { ProgramOverviewGrid } from './line-program-overview-grid'

type Program = LineProgramRecord & { overview?: LineProgramOverview }
const metrics = vi.hoisted(() => ({ renders: vi.fn() }))
vi.mock('./line-program-compact-metrics', () => ({
  CompactLineMetrics: ({ select }: { select: (selection: { slice: 'all' }) => void }) => {
    metrics.renders()
    return <button onClick={() => select({ slice: 'all' })}>Квота</button>
  },
}))
vi.mock('./line-program-grid', async () => {
  const React = await import('react')
  return { ProgramGrid: ({ rows, columns, detailRenderer: Detail }: {
    rows: Program[]; columns: ColDef<Program>[]; detailRenderer: ComponentType<ICellRendererParams<Program>>
  }) => {
    // AG may retain params for the unchanged name/value and cached detail.
    // Keep those actual initial React children; only context can refresh them.
    const [retained] = React.useState(() => {
      const Identity = columns.find(column => column.colId === 'line')!.cellRenderer as ComponentType<ICellRendererParams<Program>>
      const Actions = columns.find(column => column.colId === 'actions')!.cellRenderer as ComponentType<ICellRendererParams<Program>>
      const Metric = columns.find(column => column.colId === 'common')!.cellRenderer as ComponentType<ICellRendererParams<Program>>
      const params = { data: rows[0], colDef: { colId: 'common' } } as ICellRendererParams<Program>
      return <><div data-testid="identity"><Identity {...params} /></div><Actions {...params} /><Metric {...params} /><Detail {...params} /></>
    })
    return retained
  } }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('uses the current version and percentages for retained identity, actions and detail without remounting them', () => {
  const before: Program = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L1', category: 'II', groupName: 'A',
    family: 'supports', version: 'before', weldControlPercent: 100, pvkControlPercent: 0.5, configurationIssue: null,
    inheritedWeldControlPercent: 30, inheritedPvkControlPercent: 10,
    overview: { joints: 60, calculationJoints: 60, stamps: 1, additional: 0, approved: 0, reducible: 0, pending: 60, rejected: 0,
      common: { required: 60, covered: 0, missing: 60, actionableRequired: 60, excess: 0 }, pvk: null } }
  const after = { ...before, version: 'after', weldControlPercent: 25, pvkControlPercent: 80 }
  const onEdit = vi.fn(), onSelect = vi.fn(), onAssignments = vi.fn()
  const props = { family: 'supports' as const, rows: [before], expanded: new Map([[1, before]]),
    onEdit, onSelect, onAssignments, onToggle: vi.fn(), onMenu: vi.fn(),
    renderDetail: (line: Program) => <button onClick={() => onEdit(line)}>Настроить из расчёта</button> }
  const view = render(<ProgramOverviewGrid {...props} />)
  const retainedDetailButton = screen.getByRole('button', { name: 'Настроить из расчёта' })
  const rows = [after]
  view.rerender(<ProgramOverviewGrid {...props} rows={rows} />)
  fireEvent.click(retainedDetailButton)
  expect(onEdit).toHaveBeenLastCalledWith(after)
  fireEvent.click(screen.getByRole('button', { name: 'Настроить' }))
  expect(onEdit).toHaveBeenLastCalledWith(after)
  fireEvent.click(screen.getByRole('button', { name: 'Квота' }))
  expect(onSelect).toHaveBeenLastCalledWith(after, { slice: 'all' })
  fireEvent.click(screen.getByRole('button', { name: 'Открыть назначения линии L1' }))
  expect(onAssignments).toHaveBeenLastCalledWith(after)
  expect(within(screen.getByTestId('identity')).getByText('25%', { exact: true })).toBeVisible()
  expect(screen.getByTestId('line-description')).toHaveTextContent('ПВК 80%')
  expect(screen.getByRole('button', { name: 'Настроить из расчёта' })).toBe(retainedDetailButton)

  // Merely toggling disclosure does not change records or force quota renders.
  const renderCount = metrics.renders.mock.calls.length
  view.rerender(<ProgramOverviewGrid {...props} rows={rows} expanded={new Map()} />)
  expect(metrics.renders).toHaveBeenCalledTimes(renderCount)
})
