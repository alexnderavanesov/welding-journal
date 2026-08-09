import { describe, expect, it } from 'vitest'

import {
  buildRkExposureTableFromEditorGrid,
  buildWdiTableFromEditorGrid,
  getRkExposureEditorGrid,
  getWdiEditorGrid,
  moveGridColumn,
  moveGridRow,
  parseClipboardGrid,
  pasteIntoGrid,
} from '@/lib/settings-reference-table-editor'

describe('settings reference table editor', () => {
  it('parses and pastes a rectangular Excel clipboard range from the selected cell', () => {
    expect(parseClipboardGrid('57\t1,5\r\n89\t2\r\n')).toEqual([
      ['57', '1,5'],
      ['89', '2'],
    ])
    expect(pasteIntoGrid([['D \\ T', '3'], ['25', '1']], 1, 0, '57\t2\n89\t3')).toEqual([
      ['D \\ T', '3'],
      ['57', '2'],
      ['89', '3'],
    ])
  })

  it('moves WDI columns with their values and keeps the diameter column fixed', () => {
    const grid = [
      ['D \\ T', '3', '6'],
      ['57', '1', '2'],
      ['89', '3', '4'],
    ]
    expect(moveGridColumn(grid, 2, -1)).toEqual([
      ['D \\ T', '6', '3'],
      ['57', '2', '1'],
      ['89', '4', '3'],
    ])
    expect(moveGridColumn(grid, 1, -1)).toEqual(grid)
  })

  it('moves data rows without moving the WDI header row', () => {
    const grid = [
      ['D \\ T', '3'],
      ['57', '1'],
      ['89', '2'],
    ]
    expect(moveGridRow(grid, 2, -1, 1)).toEqual([
      ['D \\ T', '3'],
      ['89', '2'],
      ['57', '1'],
    ])
    expect(moveGridRow(grid, 1, -1, 1)).toEqual(grid)
  })

  it('builds a WDI table from the editable matrix and preserves empty values', () => {
    const table = buildWdiTableFromEditorGrid([
      ['D \\ T', '3', '6'],
      ['57', '2,24', ''],
      ['89', '3,5', '4'],
    ], { uploadedAt: '2026-08-09T00:00:00.000Z' })

    expect(table).toEqual({
      fileName: 'Таблица WDI',
      uploadedAt: '2026-08-09T00:00:00.000Z',
      diameters: [57, 89],
      thicknesses: [3, 6],
      values: [[2.24, null], [3.5, 4]],
    })
    expect(getWdiEditorGrid(table)).toEqual([
      ['D \\ T', '3', '6'],
      ['57', '2,24', ''],
      ['89', '3,5', '4'],
    ])
  })

  it('rejects duplicate or unordered WDI boundaries', () => {
    expect(() => buildWdiTableFromEditorGrid([
      ['D \\ T', '3', '3'],
      ['57', '1', '2'],
    ])).toThrow('строго по возрастанию без повторов')
    expect(() => buildWdiTableFromEditorGrid([
      ['D \\ T', '3'],
      ['89', '1'],
      ['57', '2'],
    ])).toThrow('строго по возрастанию без повторов')
  })

  it('builds several RK variants for one diameter and round-trips the editable rows', () => {
    const table = buildRkExposureTableFromEditorGrid([
      ['57', '1', '+', ''],
      ['89', '1', '+', ''],
      ['', '2', '', ''],
      ['89', '0-100', '', 'координаты'],
      ['', '100-200', '', ''],
      ['', '200-0', '', ''],
    ], { uploadedAt: '2026-08-09T00:00:00.000Z' })

    expect(table.entries[1].options).toEqual([
      { values: ['1', '2'], isDefault: true, label: 'по 2 экспозициям', note: '' },
      {
        values: ['0-100', '100-200', '200-0'],
        isDefault: false,
        label: 'по координатам 0-100 / 100-200 / 200-0 (координаты)',
        note: 'координаты',
      },
    ])
    expect(getRkExposureEditorGrid(table)).toEqual([
      ['57', '1', '+', ''],
      ['89', '1', '+', ''],
      ['', '2', '', ''],
      ['89', '0-100', '', 'координаты'],
      ['', '100-200', '', ''],
      ['', '200-0', '', ''],
    ])
  })

  it('recognizes common pasted markers for the default RK option', () => {
    const table = buildRkExposureTableFromEditorGrid([
      ['57', '1', 'да', ''],
      ['89', '1', '1', ''],
    ])
    expect(table.entries.map((entry) => entry.options[0].isDefault)).toEqual([true, true])
  })
})
