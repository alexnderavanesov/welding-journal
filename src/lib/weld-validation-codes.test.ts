import { describe, expect, it } from 'vitest'

import type { WeldInput } from '@/lib/weld-fields'
import {
  validateManualJointNamesForImport,
  validateRequiredRootStampForSave,
  validateWeldDatesForImport,
} from '@/lib/weld-validation'

describe('weld validation codes', () => {
  it.each([
    ['testDate', 'Дата ГИ'],
    ['vikRequestDate', 'Дата заявки ВИК'],
    ['rkConclusionDate', 'Дата РК'],
    ['pstoRequestDate', 'Дата заявки ПСТО'],
    ['pstoDate', 'Дата ПСТО'],
    ['tvmtConclusionDate', 'Дата ТВМТ'],
  ] as const)('routes invalid %s to %s', (fieldKey, expectedCode) => {
    expect(() => validateWeldDatesForImport([
      { joint: 'F1', [fieldKey]: '31.02.2026' } as WeldInput,
    ])).toThrow(expectedCode)
  })

  it('adds codes to direct root-stamp and manual-name validators', () => {
    expect(() => validateRequiredRootStampForSave({
      joint: 'F1',
      weldDate: '2026-09-04',
    })).not.toThrow()
    expect(() => validateManualJointNamesForImport([
      { joint: 'F1R1' } as WeldInput,
    ])).toThrow('СП-09')
  })

  it('reports all invalid date fields from one import row together', () => {
    expect(() => validateWeldDatesForImport([{
      joint: 'F1',
      testDate: '31.02.2026',
      vikRequestDate: '32.03.2026',
      pstoDate: 'not-a-date',
    } as WeldInput])).toThrow(/Дата заявки ВИК.*Дата ПСТО.*Дата ГИ/)
  })
})
