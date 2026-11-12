import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { FIELD_BY_KEY } from './weld-fields'
import { filterWeldRowsByColumns, buildWeldColumnValueFilter } from './weld-table-filtering'
import { journalClipboardValue } from './welding-journal-grid-state'
import { formatReportFieldValue } from './weld-export-utils'
import { getPreHeatTreatmentColumnText, getPreHeatTreatmentColumnTooltip, getPreHeatTreatmentColumnValue } from './pre-heat-treatment-column'

const field = FIELD_BY_KEY.get('preHeatTreatmentRequired')!
const rows = [
  { id: 1, preHeatTreatmentRequired: false, pstoRequired: null },
  { id: 2, preHeatTreatmentRequired: false, pstoRequired: 'да' },
  { id: 3, preHeatTreatmentRequired: true, pstoRequired: 'да' },
  { id: 4, preHeatTreatmentRequired: true, pstoRequired: null },
  { id: 5, preHeatTreatmentRequired: null, pstoRequired: ' дополнительный ' },
  { id: 6, preHeatTreatmentRequired: null, pstoRequired: 'отменен' },
] as WeldRow[]

it('separates applicability from the stored mark, including historical and legacy records', () => {
  expect(rows.map(getPreHeatTreatmentColumnValue)).toEqual(['—', '', 'да', 'да', '', '—'])
  for (const [value, ids] of [['—', [1, 6]], ['', [2, 5]], ['да', [3, 4]]] as const) {
    expect(filterWeldRowsByColumns(rows, { preHeatTreatmentRequired: buildWeldColumnValueFilter([value]) }).map(row => row.id)).toEqual(ids)
  }
  expect(getPreHeatTreatmentColumnTooltip(rows[0])).toContain('не применяется')
  expect(getPreHeatTreatmentColumnTooltip(rows[1])).toContain('не отмечен')
  expect(getPreHeatTreatmentColumnTooltip(rows[2])).toContain('а не его выполнение')
  expect(getPreHeatTreatmentColumnTooltip(rows[3])).toContain('Отметка НК до ТО сохранена')
})

it('keeps copied and exported values identical to cells without changing stored flags', () => {
  const before = structuredClone(rows)
  const expected = ['—', '', 'Да', 'Да', '', '—']
  expect(rows.map(getPreHeatTreatmentColumnText)).toEqual(expected)
  expect(rows.map(row => formatReportFieldValue(row, field))).toEqual(expected)
  expect(rows.map(row => journalClipboardValue(row, field.key, row.preHeatTreatmentRequired))).toEqual(expected)
  expect(rows).toEqual(before)
  // The bounded SQL copy path returns computed scalar values without a hydrated card.
  for (const [value, text] of [['—', '—'], ['', ''], ['да', 'Да']] as const) {
    const scalar = { preHeatTreatmentRequired: value } as unknown as WeldRow
    expect(journalClipboardValue(scalar, field.key, value)).toBe(text)
  }
})
