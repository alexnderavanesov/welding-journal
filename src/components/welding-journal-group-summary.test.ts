import { expect, it } from 'vitest'
import type { ICellRendererParams } from 'ag-grid-community'
import { JournalServerGroupValue } from './welding-journal-group-summary'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { JournalGridRow, JournalGroup } from '@/lib/journal-server-grid'

const group: JournalGroup = { key: 'L', route: ['L'], ordinal: 0, childCount: 4, recordCount: 4,
  summary: { lines: 1, joints: 2, wdi: 3.5, missingWdi: 1, weldDate: '01.10.2026', missingDates: 1,
    projectTitle: '<script>text</script>', subtitleCode: 'S', status: 'ожидает НК', rejected: 1, errors: 2, partialChains: 1 } }
const params = (field: string, data: JournalGroup = group) => ({ data: { id: -1, journalGroup: data } as JournalGridRow,
  column: { getColId: () => field } }) as ICellRendererParams<WeldRow>

it('preserves physical totals, warnings and the joint-only tooltip without a React subscription', () => {
  const cell = new JournalServerGroupValue()
  cell.init(params('joint'))
  const element = cell.getGui()
  expect(element.textContent).toBe('2')
  expect(element.dataset.journalTipBody).toContain('Физических соединений: 2. Строк истории: 4.')
  cell.refresh(params('wdi'))
  expect(element.textContent).toBe('3,5*')
  expect(element.querySelector('[aria-label="Неполная сумма WDI"]')).not.toBeNull()
  expect(element.dataset.journalTipBody).toBeUndefined()
  cell.refresh(params('finalStatus'))
  expect(element.classList.contains('journal-group-status-pending')).toBe(true)
  expect(element.querySelector('.journal-group-rejected')?.textContent).toBe('не годен: 1')
  expect(element.lastChild?.textContent).toBe('2')
  cell.refresh(params('projectTitle'))
  expect(element.textContent).toBe('<script>text</script>')
  expect(element.querySelector('script')).toBeNull()
  cell.refresh(params('vikRequest'))
  expect(element.textContent).toBe('')
  expect(element.className).toBe('')
  expect(element.dataset.groupSummary).toBeUndefined()
})

it('refreshes changed summaries and does not lose a known zero WDI', () => {
  const cell = new JournalServerGroupValue()
  cell.init(params('wdi'))
  cell.refresh(params('wdi', { ...group, summary: { ...group.summary, wdi: 0, missingWdi: 0 } }))
  expect(cell.getGui().textContent).toBe('0')
  cell.refresh(params('wdi', { ...group, summary: { ...group.summary, wdi: null, missingWdi: 2 } }))
  expect(cell.getGui().textContent).toBe('—*')
})
