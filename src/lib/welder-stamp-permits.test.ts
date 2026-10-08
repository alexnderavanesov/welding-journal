import { describe, expect, it } from 'vitest'
import { validateDlsPermit, validateNaksPermit } from '@/lib/welder-stamp-permits'
import type { WelderStampDlsPermit, WelderStampNaksPermit } from '@/lib/welder-stamp-types'

const baseNaks: WelderStampNaksPermit = {
  id: 'naks-base',
  weldType: 'РАД',
  materialGroups: 'М01',
  diameterFrom: '1',
  diameterTo: '100',
  thicknessFrom: '1',
  thicknessTo: '10',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
  note: '',
}

const baseDls: WelderStampDlsPermit = {
  id: 'dls-base',
  number: 'ДЛС-1',
  weldType: 'РАД',
  materialGroups: 'М01',
  diameterFrom: '1',
  diameterTo: '100',
  thicknessFrom: '1',
  thicknessTo: '10',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
  note: '',
}

describe('DLS cumulative NAKS coverage', () => {
  it('requires every method/material combination for a multi-group DLS', () => {
    const dls = { ...baseDls, weldType: 'РАД, РД', materialGroups: 'М01, М05, М11' }
    const complete = { ...baseNaks, weldType: 'РАД, РД', materialGroups: 'М11, М01, М05' }
    expect(validateDlsPermit(dls, 0, [complete])).toBe('')
    for (const materialGroups of ['М01', 'М05', 'М11']) {
      const remaining = ['М01', 'М05', 'М11'].filter(group => group !== materialGroups).join(', ')
      expect(validateDlsPermit(dls, 0, [{ ...complete, materialGroups: remaining }])).toContain(materialGroups)
    }
    expect(validateDlsPermit(dls, 0, [{ ...complete, weldType: 'РАД' }])).toContain('РД')
    expect(validateDlsPermit(dls, 0, [{ ...complete, materialGroups: 'M01, М05, М11' }])).toContain('М01')
  })

  it('respects decimal boundaries, open ends and a real gap instead of adding interval widths', () => {
    const dls = { ...baseDls, diameterFrom: '10.5', diameterTo: '', thicknessFrom: '1.5', thicknessTo: '3.5' }
    const first = { ...baseNaks, diameterFrom: '10.5', diameterTo: '57.5', thicknessFrom: '1.5', thicknessTo: '3.5' }
    const next = { ...baseNaks, id: 'next', diameterFrom: '57.5', diameterTo: '' }
    expect(validateDlsPermit(dls, 0, [first, next])).toBe('')
    expect(validateDlsPermit(dls, 0, [first, { ...next, diameterFrom: '57.6' }])).toContain('диаметра')
    expect(validateDlsPermit(dls, 0, [first, { ...next, diameterTo: '9999' }])).toContain('диаметра')
  })
  it('covers D and T independently with different NAKS permits of the same method and group', () => {
    const permits = [
      {
        ...baseNaks,
        id: 'naks-1',
        diameterFrom: '1',
        diameterTo: '50',
        thicknessFrom: '1',
        thicknessTo: '5',
      },
      {
        ...baseNaks,
        id: 'naks-2',
        diameterFrom: '50',
        diameterTo: '100',
        thicknessFrom: '5',
        thicknessTo: '10',
      },
    ]

    expect(validateDlsPermit(baseDls, 0, permits)).toBe('')
  })

  it('covers the DLS validity period with consecutive NAKS permits', () => {
    const permits = [
      {
        ...baseNaks,
        id: 'naks-first-half',
        validTo: '2026-06-30',
      },
      {
        ...baseNaks,
        id: 'naks-second-half',
        validFrom: '2026-07-01',
      },
    ]

    expect(validateDlsPermit(baseDls, 0, permits)).toBe('')
  })

  it('rejects a gap in cumulative NAKS validity', () => {
    const permits = [
      {
        ...baseNaks,
        id: 'naks-first-half',
        validTo: '2026-06-29',
      },
      {
        ...baseNaks,
        id: 'naks-second-half',
        validFrom: '2026-07-01',
      },
    ]

    expect(validateDlsPermit(baseDls, 0, permits)).toContain('не покрыт непрерывной совокупностью НАКС')
  })

  it('does not combine NAKS permits from another method or material group', () => {
    const permits = [
      {
        ...baseNaks,
        id: 'naks-rad-m01',
        diameterTo: '50',
        thicknessTo: '5',
      },
      {
        ...baseNaks,
        id: 'naks-rd-m01',
        weldType: 'РД',
        diameterFrom: '50',
        thicknessFrom: '5',
      },
      {
        ...baseNaks,
        id: 'naks-rad-m05',
        materialGroups: 'М05',
        diameterFrom: '50',
        thicknessFrom: '5',
      },
    ]

    expect(validateDlsPermit(baseDls, 0, permits)).toContain('не покрыт совокупностью НАКС')
  })
})

describe('welder stamp permit date boundary', () => {
  it('allows a permit starting on 01.01.2023', () => {
    expect(validateNaksPermit({ ...baseNaks, validFrom: '2023-01-01' }, 0)).toBe('')
  })

  it('rejects a permit starting before 01.01.2023', () => {
    expect(validateNaksPermit({ ...baseNaks, validFrom: '2022-12-31' }, 0)).toBe(
      'НАКС 1: срок действия от не может быть раньше 01.01.2023.',
    )
  })
})
