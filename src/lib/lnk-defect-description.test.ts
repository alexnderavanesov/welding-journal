import { describe, expect, it } from 'vitest'

import {
  getLnkDefectDescriptionDescriptor,
  getLnkDefectDescriptionDisplayValue,
  getLnkDefectDescriptionEditBlockReason,
  transitionLnkDefectDescription,
} from '@/lib/lnk-defect-description'
import type { WeldInput } from '@/lib/weld-fields'

describe('LNK defect descriptions', () => {
  it.each([
    { currentResult: null, nextResult: 'годен', currentDescription: null, expected: 'ДНО' },
    { currentResult: 'ремонт', nextResult: 'годен', currentDescription: 'Трещина', expected: 'ДНО' },
    { currentResult: 'годен', nextResult: 'ремонт', currentDescription: 'ДНО', expected: null },
    { currentResult: 'ремонт', nextResult: 'вырез', currentDescription: 'Трещина', expected: 'Трещина' },
    { currentResult: 'вырез', nextResult: 'ремонт', currentDescription: 'Пора', expected: 'Пора' },
    { currentResult: 'ремонт', nextResult: null, currentDescription: 'Трещина', expected: null },
    { currentResult: 'годен', nextResult: 'годен (отменен)', currentDescription: 'ДНО', expected: 'ДНО' },
  ])('applies the result transition %#', ({ expected, ...input }) => {
    expect(transitionLnkDefectDescription(input)).toBe(expected)
  })

  it('keeps the three methods and two stages independent', () => {
    const descriptors = [
      'vikDefectDescription',
      'uzkDefectDescription',
      'pvkDefectDescription',
      'preVikDefectDescription',
      'preUzkDefectDescription',
      'prePvkDefectDescription',
    ].map((fieldKey) => getLnkDefectDescriptionDescriptor(fieldKey as never))

    expect(descriptors.map((descriptor) => [descriptor?.method.code, descriptor?.stage])).toEqual([
      ['ВИК', 'primary'],
      ['УЗК', 'primary'],
      ['ПВК', 'primary'],
      ['ВИК', 'beforeHeatTreatment'],
      ['УЗК', 'beforeHeatTreatment'],
      ['ПВК', 'beforeHeatTreatment'],
    ])
  })

  it('shows DNO for a legacy good row and allows editing only rejected results', () => {
    const descriptor = getLnkDefectDescriptionDescriptor('vikDefectDescription')!
    const good = { hasVik: 'да', vikResult: 'годен', vikDefectDescription: null } as WeldInput
    const rejected = { ...good, vikResult: 'ремонт' } as WeldInput

    expect(getLnkDefectDescriptionDisplayValue(good, descriptor)).toBe('ДНО')
    expect(getLnkDefectDescriptionEditBlockReason(good, descriptor)).toContain('автоматически')
    expect(getLnkDefectDescriptionEditBlockReason(rejected, descriptor)).toBe('')
  })

  it('preserves cancelled history but makes it read-only', () => {
    const descriptor = getLnkDefectDescriptionDescriptor('pvkDefectDescription')!
    const row = {
      hasPvk: 'отменен',
      pvkResult: null,
      pvkDefectDescription: 'Старая несплошность',
    } as WeldInput

    expect(getLnkDefectDescriptionDisplayValue(row, descriptor)).toBe('Старая несплошность')
    expect(getLnkDefectDescriptionEditBlockReason(row, descriptor)).toContain('история')
  })
})
