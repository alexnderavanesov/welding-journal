import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ProgramAssignmentTable } from './line-program-assignment-table'

afterEach(cleanup)
const source: WeldRow = { id: 1, joint: 'F1', connectionType: 'У19', hasVik: 'да', vikResult: 'годен', weldDate: '2026-09-01', stamp1K: 'D503', stamp1Z: 'D504', stamp1O: 'D505' }
const props = { rows: [source], selected: new Set<number>(), draft: new Map<number, WeldRow>(), busy: false, canSelect: () => true, onSelect: vi.fn(), onSelectAll: vi.fn(), onChange: vi.fn(), getError: () => '' }

it('omits the invariant VIK assignment without hiding saved VIK results or any participant stamp', () => {
  render(<ProgramAssignmentTable {...props} />)
  expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['', 'Стык', 'РК', 'УЗК', 'ПВК', 'Послойный ПВК', 'Результат'])
  expect(screen.queryByRole('combobox', { name: 'F1 · ВИК' })).not.toBeInTheDocument()
  expect(screen.queryByText('ВИК обязателен')).not.toBeInTheDocument()
  const metadata = screen.getByTestId('program-joint-metadata')
  for (const stamp of ['D503', 'D504', 'D505']) expect(within(metadata).getByText(stamp)).toBeVisible()
  fireEvent.click(screen.getByText('годен', { exact: true }).closest('summary')!)
  expect(screen.getByText('ВИК: годен')).toBeVisible()
})

it('reserves the previous-value line before a draft exists, including unavailable layered cells', () => {
  const rows = [source, { ...source, id: 2, joint: 'F2', connectionType: 'С17' }]
  const view = render(<ProgramAssignmentTable {...props} rows={rows} />)
  const slots = () => view.container.querySelectorAll('[data-program-previous-assignment]')
  expect(slots()).toHaveLength(8)
  for (const slot of slots()) expect(slot).toHaveClass('h-4')
  expect(screen.queryByText(/^было:/)).not.toBeInTheDocument()
  view.rerender(<ProgramAssignmentTable {...props} rows={rows} draft={new Map([[1, { ...source, hasRk: 'да' }]])} />)
  expect(slots()).toHaveLength(8)
  expect(screen.getByText('было: —')).toBeVisible()
  view.rerender(<ProgramAssignmentTable {...props} rows={rows} />)
  expect(slots()).toHaveLength(8)
  expect(screen.queryByText(/^было:/)).not.toBeInTheDocument()
})

it('keeps mandatory-method hints in a separate stable line for the entire repair row', () => {
  const repair: WeldRow = { ...source, joint: 'F1R1', programRepairRequirements: [{ method: 'РК', reason: 'Обязателен после негодного РК на F1', sourceRowId: 9, sourceJoint: 'F1' }] }
  const view = render(<ProgramAssignmentTable {...props} rows={[repair]} />)
  expect(view.container.querySelectorAll('[data-program-repair-hint]')).toHaveLength(4)
  expect(screen.getByText('Обязательный метод')).toHaveAttribute('title', 'Обязателен после негодного РК на F1')
  view.rerender(<ProgramAssignmentTable {...props} rows={[repair]} draft={new Map([[1, { ...repair, hasRk: 'да' }]])} />)
  expect(screen.getByText('было: —')).toBeVisible()
  expect(screen.getByText('Обязательный метод')).toBeVisible()
})
