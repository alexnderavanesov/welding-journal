import { describe, expect, it } from 'vitest'

import { normalizeLnkDefectDescriptionUpdate } from '@/server/lnk-defect-description-workflow'

describe('LNK defect description workflow payload', () => {
  it('normalizes the method and trims a free-text description', () => {
    expect(normalizeLnkDefectDescriptionUpdate({
      rowId: 12,
      expectedVersion: ' 41 ',
      methodCode: ' узк ',
      stage: 'beforeHeatTreatment',
      value: '  Трещина 12 мм  ',
    })).toEqual({
      rowId: 12,
      expectedVersion: '41',
      methodCode: 'УЗК',
      stage: 'beforeHeatTreatment',
      value: 'Трещина 12 мм',
    })
  })

  it('allows clearing a description but rejects RK and invalid stages', () => {
    expect(normalizeLnkDefectDescriptionUpdate({
      rowId: 1,
      expectedVersion: '41',
      methodCode: 'ВИК',
      stage: 'primary',
      value: '   ',
    }).value).toBeNull()
    expect(() => normalizeLnkDefectDescriptionUpdate({
      rowId: 1,
      expectedVersion: '41',
      methodCode: 'РК',
      stage: 'primary',
      value: 'Текст',
    })).toThrow('только для ВИК, УЗК и ПВК')
    expect(() => normalizeLnkDefectDescriptionUpdate({
      rowId: 1,
      expectedVersion: '41',
      methodCode: 'ПВК',
      stage: 'other' as never,
      value: 'Текст',
    })).toThrow('Некорректный этап')
  })

  it('limits unexpectedly large text values', () => {
    expect(() => normalizeLnkDefectDescriptionUpdate({
      rowId: 1,
      expectedVersion: '41',
      methodCode: 'ВИК',
      stage: 'primary',
      value: 'x'.repeat(4001),
    })).toThrow('4000')
  })
})
