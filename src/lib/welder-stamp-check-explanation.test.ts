import { describe, expect, it } from 'vitest'
import { DEFAULT_STAMP_CHECK_EXAMPLE as defaults, explainStampCheckExample } from './welder-stamp-check-explanation'

describe('stamp check example explanation (current rules, not eligibility)', () => {
  it('describes independent C alternatives and does not assign one side to each welder', () => {
    const result = explainStampCheckExample({ ...defaults, stampCount: 2, d1: '108', d2: '108', t1: '4', t2: '6' })
    expect(result.errors).toEqual([])
    expect(result.welders).toEqual([{ name: 'Сварщик А', methods: 'РАД' }, { name: 'Сварщик Б', methods: 'РАД' }])
    expect(result.scopes).toEqual([{ group: 'М01', diameter: 'D1 = 108 или D2 = 108 мм', thickness: 'T1 = 4 или T2 = 6 мм', note: expect.stringContaining('D и T могут быть от разных сторон'), diameterFields: ['d1', 'd2'], thicknessFields: ['t1', 't2'], alternatives: true }])
  })
  it.each([
    ['57', '6', '159', '3', 'D1 = 57 мм', 'T1 = 6 мм', 'D2 и T2'],
    ['159', '3', '57', '6', 'D2 = 57 мм', 'T2 = 6 мм', 'D1 и T1'],
  ])('keeps the U thickness paired with the smaller diameter (%s/%s + %s/%s)', (d1, t1, d2, t2, diameter, thickness, ignored) => {
    const result = explainStampCheckExample({ ...defaults, connectionType: 'У19', d1, t1, d2, t2 })
    expect(result.scopes[0]).toMatchObject({ diameter, thickness, note: expect.stringContaining(ignored) })
  })
  it.each([
    ['6', '3', 'T2 = 3 мм'], ['3', '6', 'T1 = 3 мм'], ['3', '3', 'T1 = T2 = 3 мм'],
  ])('uses the current homogeneous equal-D U rule (%s/%s)', (t1, t2, thickness) => {
    expect(explainStampCheckExample({ ...defaults, connectionType: 'У19', d1: '159', d2: '159', t1, t2 }).scopes[0])
      .toMatchObject({ diameter: 'D1 = D2 = 159 мм', thickness })
  })
  it.each(['С17', 'У19'] as const)('checks both material-specific sides for dissimilar %s even at equal D', connectionType => {
    const input = { ...defaults, connectionType, group1: 'М05', group2: 'М01' }
    const result = explainStampCheckExample(input)
    expect(result.scopes).toEqual([
      { group: 'М05', diameter: 'D1 = 108 мм', thickness: 'T1 = 4 мм', note: expect.any(String), diameterFields: ['d1'], thicknessFields: ['t1'], alternatives: false },
      { group: 'М01', diameter: 'D2 = 108 мм', thickness: 'T2 = 6 мм', note: expect.any(String), diameterFields: ['d2'], thicknessFields: ['t2'], alternatives: false },
    ])
    expect(explainStampCheckExample({ ...input, group1: 'М01', group2: 'М05' }).scopes.map(scope => scope.group)).toEqual(['М01', 'М05'])
  })
  it('accepts comma decimals and normalizes the same group into a homogeneous joint', () => {
    const result = explainStampCheckExample({ ...defaults, group1: ' м01 ', group2: 'М01', t1: '4,5' })
    expect(result.scopes).toHaveLength(1)
    expect(result.scopes[0].thickness).toBe('T1 = 4.5 или T2 = 6 мм')
  })
  it('shows all invalid fields without a misleading partial result', () => {
    const result = explainStampCheckExample({ ...defaults, d1: '', t1: '-2', d2: '57мм', t2: '0', group1: '' })
    expect(result.errors).toHaveLength(5)
    expect(result.scopes).toEqual([])
  })
  it('covers one/two welders, single/combined methods and warns on missing team methods', () => {
    expect(explainStampCheckExample({ ...defaults, weldingMethod: 'РАД+РД' }).welders).toEqual([{ name: 'Сварщик А', methods: 'РАД+РД' }])
    const team = { ...defaults, stampCount: 2 as const, weldingMethod: 'РАД+РД' as const }
    expect(explainStampCheckExample(team).welders).toEqual([{ name: 'Сварщик А', methods: 'РАД' }, { name: 'Сварщик Б', methods: 'РД' }])
    expect(explainStampCheckExample(team).teamWarning).toBeNull()
    expect(explainStampCheckExample({ ...team, methodB: 'РАД' }).teamWarning).toContain('исполнитель способа РД')
    expect(explainStampCheckExample({ ...team, methodA: 'РАД+РД', methodB: 'РАД' }).teamWarning).toBeNull()
    expect(explainStampCheckExample({ ...team, weldingMethod: 'РД' }).welders.every(welder => welder.methods === 'РД')).toBe(true)
  })
})
