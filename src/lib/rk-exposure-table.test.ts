import { describe, expect, it } from 'vitest'

import { parseRkExposureRows } from '@/lib/rk-exposure-table'

describe('RK exposure table', () => {
  it('parses several variants for one diameter and keeps the explicit default', () => {
    expect(parseRkExposureRows([
      [57, '1', '+', ''],
      [89, '1', '+', ''],
      [null, '2', '', ''],
      [89, '0-100', '', 'координаты'],
      [null, '100-200', '', ''],
      [null, '200-0', '', ''],
    ])).toEqual([
      {
        diameter: 57,
        options: [{ values: ['1'], isDefault: true, label: 'по 1 экспозиции', note: '' }],
      },
      {
        diameter: 89,
        options: [
          { values: ['1', '2'], isDefault: true, label: 'по 2 экспозициям', note: '' },
          {
            values: ['0-100', '100-200', '200-0'],
            isDefault: false,
            label: 'по координатам 0-100 / 100-200 / 200-0 (координаты)',
            note: 'координаты',
          },
        ],
      },
    ])
  })

  it('rejects more than one default for a diameter', () => {
    expect(() => parseRkExposureRows([
      [89, '1', '+', ''],
      [89, '0-100', '+', ''],
    ])).toThrow('несколько вариантов по умолчанию')
  })

  it('rejects an exposure line before the first diameter instead of dropping it', () => {
    expect(() => parseRkExposureRows([
      [null, '0-100', '', ''],
      [89, '1', '+', ''],
    ])).toThrow('Первая строка варианта экспозиций должна содержать диаметр')
  })
})
