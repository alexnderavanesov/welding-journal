import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import { useWeldReportViewState } from '@/lib/use-weld-report-view-state'
import { DEFAULT_JOURNAL_APPEARANCE } from '@/lib/welding-journal-grid-state'
import { JournalGridToolbar } from './welding-journal-grid-toolbar'

const sections = [
  { section: 'Проект', fields: [FIELD_BY_KEY.get('line')!] },
  { section: 'Материалы', fields: (['material1', 'material2'] as WeldFieldKey[]).map(key => FIELD_BY_KEY.get(key)!) },
]
const required = new Set(['line']), collapsed = new Set<string>()
const filtersChanged = vi.fn(), sortChanged = vi.fn()

function Toolbar() {
  const view = useWeldReportViewState({ storageKey: 'column-choice-test', sections, alwaysVisibleFieldKeys: required,
    defaultCollapsedSections: collapsed, columnFilters: { line: 'keep' }, sort: null,
    onColumnFiltersChange: filtersChanged, onSortChange: sortChanged })
  return <JournalGridToolbar settingsLabel="Настройка вида" sections={sections} extraSections={[]}
    alwaysVisible={required} view={view} openColumnsRequest={1} appearance={DEFAULT_JOURNAL_APPEARANCE}
    onAppearanceChange={vi.fn()} onResetLayout={vi.fn()} hasFilters={false} onClearFilters={vi.fn()} />
}

beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })
afterEach(cleanup)

it('enables only the chosen column after hiding its section, then saves that exact choice', () => {
  const first = render(<Toolbar />)
  const group = screen.getByRole('checkbox', { name: 'Раздел: Материалы' })
  const material = (key: WeldFieldKey) => screen.getByRole('checkbox', { name: FIELD_BY_KEY.get(key)!.label, hidden: true })
  fireEvent.click(group)
  expect(material('material1')).not.toBeChecked()
  fireEvent.click(material('material1'))
  expect(material('material1')).toBeChecked()
  expect(material('material2')).not.toBeChecked()
  expect(group).toBePartiallyChecked()
  first.unmount()
  render(<Toolbar />)
  expect(material('material1')).toBeChecked()
  expect(material('material2')).not.toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Раздел: Материалы' }))
  expect(material('material1')).toBeChecked()
  expect(material('material2')).toBeChecked()
  expect(filtersChanged).not.toHaveBeenCalled()
  expect(sortChanged).not.toHaveBeenCalled()
})

it('can hide every optional column from a partial view and choose one, preserving required fields', () => {
  render(<Toolbar />)
  const material = (key: WeldFieldKey) => screen.getByRole('checkbox', { name: FIELD_BY_KEY.get(key)!.label, hidden: true })
  fireEvent.click(material('material2'))
  fireEvent.click(screen.getByRole('button', { name: 'Скрыть все' }))
  expect(material('material1')).not.toBeChecked()
  expect(material('material2')).not.toBeChecked()
  const line = screen.getByRole('checkbox', { name: /^Линия/, hidden: true })
  expect(line).toBeChecked()
  expect(line).toBeDisabled()
  fireEvent.click(material('material2'))
  expect(material('material2')).toBeChecked()
  expect(material('material1')).not.toBeChecked()
  fireEvent.click(material('material2'))
  expect(material('material2')).not.toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Раздел: Материалы' }))
  expect(material('material1')).toBeChecked()
  expect(material('material2')).toBeChecked()
  expect(within(screen.getByRole('dialog')).getByText('3 из 3 столбцов · сохраняется в этом браузере')).toBeVisible()
})

it('reveals only one field from a section hidden by an older saved view', () => {
  localStorage.setItem('welding-report-view:v1:column-choice-test', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: ['Материалы'], savedViews: [],
  }))
  render(<Toolbar />)
  fireEvent.click(screen.getByRole('checkbox', { name: FIELD_BY_KEY.get('material2')!.label, hidden: true }))
  expect(screen.getByRole('checkbox', { name: FIELD_BY_KEY.get('material2')!.label, hidden: true })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: FIELD_BY_KEY.get('material1')!.label, hidden: true })).not.toBeChecked()
})

it('hides a partially selected section through mixed, all and none and persists the result', () => {
  localStorage.setItem('welding-report-view:v1:column-choice-test', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: ['material2'], customHiddenFieldKeys: ['material2'], collapsedSections: [], savedViews: [],
  }))
  const first = render(<Toolbar />)
  const group = screen.getByRole('checkbox', { name: 'Раздел: Материалы' })
  const material = (key: WeldFieldKey) => screen.getByRole('checkbox', { name: FIELD_BY_KEY.get(key)!.label, hidden: true })
  expect(group).toBePartiallyChecked()
  // Mixed selection is not the same as every child being checked.
  expect(group).not.toBeChecked()
  fireEvent.click(group)
  expect(group).toBeChecked()
  expect(group).not.toBePartiallyChecked()
  expect(material('material1')).toBeChecked()
  expect(material('material2')).toBeChecked()
  fireEvent.click(group)
  expect(group).not.toBeChecked()
  expect(group).not.toBePartiallyChecked()
  expect(material('material1')).not.toBeChecked()
  expect(material('material2')).not.toBeChecked()
  first.unmount()
  render(<Toolbar />)
  expect(material('material1')).not.toBeChecked()
  expect(material('material2')).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: /^Линия/, hidden: true })).toBeChecked()
  expect(filtersChanged).not.toHaveBeenCalled()
  expect(sortChanged).not.toHaveBeenCalled()
})
