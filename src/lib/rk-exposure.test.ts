import { describe, expect, it } from 'vitest'
import type { RkExposureTableSettings } from '@/lib/other-settings'
import {
  RK_EXPOSURE_CUSTOM_SCHEME_LABEL,
  RK_EXPOSURE_REVIEW_LABEL,
  applyRkExposureResultTransition,
  getRkEffectiveDiameter,
  getRkExposureSchemeState,
  parseRkExposureDescription,
  serializeRkExposureLines,
} from '@/lib/rk-exposure'

const table: RkExposureTableSettings = {
  fileName: 'Экспозиции.xlsx',
  uploadedAt: '2026-08-07T00:00:00.000Z',
  entries: [
    {
      diameter: 57,
      options: [{ label: 'по 1 экспозиции', values: ['1'], isDefault: true, note: '' }],
    },
    {
      diameter: 89,
      options: [
        { label: 'по 2 экспозициям', values: ['1', '2'], isDefault: true, note: '' },
        { label: 'по координатам 0-100 / 100-200 / 200-0', values: ['0-100', '100-200', '200-0'], isDefault: false, note: '' },
      ],
    },
    {
      diameter: 108,
      options: [{ label: 'по 3 экспозициям', values: ['1', '2', '3'], isDefault: true, note: '' }],
    },
  ],
}

describe('RK exposures', () => {
  it('uses the largest diameter for ordinary joints and the smallest for У joints', () => {
    expect(getRkEffectiveDiameter({ d1: 89, d2: 530, connectionType: 'С17' })).toBe(530)
    expect(getRkEffectiveDiameter({ d1: 89, d2: 530, connectionType: 'У17' })).toBe(89)
    expect(getRkEffectiveDiameter({ d1: null, d2: 108, connectionType: 'У17' })).toBe(108)
  })

  it('creates the default good description and confirms the actual diameter', () => {
    const updated = applyRkExposureResultTransition<{
      d1: number
      d2: number
      connectionType: string
      rkResult: string | null
      lnkDefectDescription: string | null
      rkExposureConfirmedDiameter?: number | null
    }>(
      { d1: 95, d2: 95, connectionType: 'С17', rkResult: null, lnkDefectDescription: null },
      'годен',
      table,
    )
    expect(updated.lnkDefectDescription).toBe('1: ДНО\n2: ДНО')
    expect(updated.rkExposureConfirmedDiameter).toBe(95)
  })

  it('creates blank descriptions for repair and cut results', () => {
    const updated = applyRkExposureResultTransition(
      { d1: 95, d2: 95, connectionType: 'С17', rkResult: null, lnkDefectDescription: null },
      'ремонт',
      table,
    )
    expect(updated.lnkDefectDescription).toBe('1:\n2:')
  })

  it('preserves manual text when the same result is saved again', () => {
    const record = {
      d1: 95,
      d2: 95,
      connectionType: 'С17',
      rkResult: 'ремонт',
      lnkDefectDescription: '1: 1a\n2: 2b',
      rkExposureConfirmedDiameter: 95,
    }
    expect(applyRkExposureResultTransition(record, 'ремонт', table)).toEqual(record)
  })

  it('keeps coordinates but updates descriptions when the real RK result changes', () => {
    const repaired = applyRkExposureResultTransition(
      {
        d1: 95,
        d2: 95,
        connectionType: 'С17',
        rkResult: 'годен',
        lnkDefectDescription: '0-100: ДНО\n100-200: ДНО\n200-0: ДНО',
        rkExposureConfirmedDiameter: 95,
      },
      'вырез',
      table,
    )
    expect(repaired.lnkDefectDescription).toBe('0-100:\n100-200:\n200-0:')
  })

  it('does not erase the history for a cancelled result', () => {
    const record = {
      d1: 95,
      d2: 95,
      connectionType: 'С17',
      rkResult: 'годен',
      lnkDefectDescription: '1: ДНО\n2: ДНО',
      rkExposureConfirmedDiameter: 95,
    }
    expect(applyRkExposureResultTransition(record, 'годен (отменен)', table)).toEqual(record)
  })

  it('shows review only when the confirmed and current diameters fall into different buckets', () => {
    const base = {
      d1: 95,
      d2: 95,
      connectionType: 'С17',
      lnkDefectDescription: '1: ДНО\n2: ДНО',
      rkExposureConfirmedDiameter: 95,
    }
    expect(getRkExposureSchemeState({ ...base, d1: 100, d2: 100 }, table).label).toBe('по 2 экспозициям')
    expect(getRkExposureSchemeState({ ...base, d1: 108, d2: 108 }, table).label).toBe(RK_EXPOSURE_REVIEW_LABEL)
  })

  it('treats changed coordinates as a custom scheme but not changed right-side descriptions', () => {
    const base = { d1: 95, d2: 95, connectionType: 'С17', rkExposureConfirmedDiameter: 95 }
    expect(getRkExposureSchemeState({ ...base, lnkDefectDescription: '1: 1a\n2: 2b' }, table).label).toBe('по 2 экспозициям')
    expect(getRkExposureSchemeState({ ...base, lnkDefectDescription: 'A: 1a\nB: 2b' }, table).label).toBe(RK_EXPOSURE_CUSTOM_SCHEME_LABEL)
  })

  it('round-trips values containing a colon in the description', () => {
    const serialized = serializeRkExposureLines([{ coordinate: '0-100', description: 'дефект: 12 мм' }])
    expect(parseRkExposureDescription(serialized)).toEqual([{ coordinate: '0-100', description: 'дефект: 12 мм' }])
  })
})
