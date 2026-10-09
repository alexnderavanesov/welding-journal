import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { checkTechnologyCardApplicability, createTechnologyCardMatcher, getTechnologyCardAutoAssignment } from '@/lib/technology-card-matching'
import type { TechnologyCardRecord, TechnologyCardWeld } from '@/lib/technology-card-types'
import { getOfficialStampJointDimensionRequirements } from '@/lib/welder-stamp-compatibility-utils'

const settings = DEFAULT_DATA_LIST_SETTINGS
const card: TechnologyCardRecord = {
  id: 12, name: 'ТК №12', weldingMethods: ['РАД', 'РД'], connectionType: 'С17',
  materialGroups: ['М01', 'М05'], diameterFrom: 57, diameterTo: 108,
  thicknessFrom: 3, thicknessTo: 6, psto: 'any', archived: false, revision: 1,
}
const row: TechnologyCardWeld = {
  weldingMethod: 'РАД+РД', connectionType: 'С17', materialGroup: 'М05 + М01',
  d1: 57, t1: 6, d2: 159, t2: 3, pstoRequired: 'да',
}
const check = (weld: TechnologyCardWeld, override: Partial<TechnologyCardRecord> = {}) => checkTechnologyCardApplicability({ ...card, ...override }, weld, settings)

describe('technology card applicability', () => {
  it('does not transfer TK minimum-thickness rules into the deferred homogeneous U19 permit rule', () => {
    const weld = { ...row, connectionType: 'У19', materialGroup: 'М01', d1: 57, t1: 6, d2: 159, t2: 3 }
    expect(check(weld, { connectionType: 'У19', materialGroups: ['М01'], diameterFrom: 57, diameterTo: 57, thicknessFrom: 3, thicknessTo: 3 }).applicable).toBe(true)
    // User explicitly retained the existing permit rule pending a later decision.
    expect(getOfficialStampJointDimensionRequirements(weld)).toMatchObject({ diameters: [57], thicknesses: [6] })
    expect(getOfficialStampJointDimensionRequirements({ ...weld, d1: 159, t1: 3, d2: 57, t2: 6 }))
      .toMatchObject({ diameters: [57], thicknesses: [6] })
  })

  it('uses independent minimum D and T, including reversed material and method order', () => {
    expect(check(row).applicable).toBe(true)
    expect(check({ ...row, weldingMethod: 'РД + РАД', materialGroup: 'М01 + М05' }).applicable).toBe(true)
    expect(check({ ...row, d1: 159, t1: 3, d2: 57, t2: 6 }).applicable).toBe(true)
    expect(check({ ...row, connectionType: 'У19' }, { connectionType: 'У19', diameterTo: 57, thicknessTo: 3 }).applicable).toBe(true)
  })

  it.each(['РАД', 'РД'])('requires the complete method set, not one method (%s)', weldingMethod => {
    expect(check({ ...row, weldingMethod }).mismatchIssues.map(issue => issue.field)).toEqual(['weldingMethods'])
    expect(check(row, { weldingMethods: [weldingMethod] }).applicable).toBe(false)
  })

  it('requires an exact connection type', () => {
    expect(check({ ...row, connectionType: 'У19' }).mismatchIssues.map(issue => issue.field)).toEqual(['connectionType'])
  })

  it.each(['М01', 'М05', 'М11'])('does not apply a two-group card to homogeneous %s', materialGroup => {
    expect(check({ ...row, materialGroup }).applicable).toBe(false)
    expect(check(row, { materialGroups: [materialGroup] }).applicable).toBe(false)
    expect(check({ ...row, materialGroup }, { materialGroups: [materialGroup] }).applicable).toBe(true)
  })

  it.each([['М01', 'М05'], ['М01', 'М11'], ['М05', 'М11']])('accepts both orders only for the same pair %s/%s', (a, b) => {
    for (const materialGroup of [`${a} + ${b}`, `${b} + ${a}`]) {
      expect(check({ ...row, materialGroup }, { materialGroups: [a, b] }).applicable).toBe(true)
    }
    expect(check({ ...row, materialGroup: a }, { materialGroups: [a, b] }).applicable).toBe(false)
  })

  it.each([
    [57, 3, true], [108, 6, true], [56.999, 3, false], [108.001, 6, false],
    [57, 2.999, false], [108, 6.001, false],
  ])('uses inclusive bounds at D%s / T%s', (d1, t1, applicable) => {
    expect(check({ ...row, d1, d2: 159, t1, t2: 12 }).applicable).toBe(applicable)
  })

  it.each([
    ['да', true], ['дополнительный', true], ['yes', true], ['', false],
    [null, false], ['нет', false], ['отменен', false],
  ])('checks PSTO assignment %s regardless of a performed result', (pstoRequired, required) => {
    const weld = { ...row, pstoRequired, pstoResult: 'проведено', heatTreatmentDiagram: 'OLD' }
    expect(check(weld, { psto: 'required' }).applicable).toBe(required)
    expect(check(weld, { psto: 'not-required' }).applicable).toBe(!required)
    expect(check(weld, { psto: 'any' }).applicable).toBe(true)
  })

  it('reports every missing parameter instead of guessing from one side', () => {
    const result = check({ ...row, weldingMethod: '', connectionType: null, materialGroup: '', d1: null, t2: '' })
    expect(result.applicable).toBe(false)
    expect(result.weldIssues.map(issue => issue.field)).toEqual(['weldingMethod', 'connectionType', 'materialGroup', 'd1', 't2'])
    expect(result.weldIssues.every(issue => issue.kind === 'missing')).toBe(true)
    expect(createTechnologyCardMatcher([card], settings).match({ ...row, d2: null }).cards).toEqual([])
  })

  it('keeps all simultaneous mismatches visible', () => {
    const result = check({ ...row, weldingMethod: 'РАД', connectionType: 'У19', materialGroup: 'М11', d1: 219, d2: 325, t1: 12, t2: 14, pstoRequired: '' }, { psto: 'required' })
    expect(result.mismatchIssues.map(issue => issue.field)).toEqual(['weldingMethods', 'connectionType', 'materialGroups', 'diameterFrom', 'thicknessFrom', 'psto'])
  })

  it.each([
    { weldingMethod: 'РАД + РД + НЕИЗВЕСТНО' }, { weldingMethod: 'РАД++РД' },
    { materialGroup: 'M01 + М05' }, { materialGroup: 'М01 + М05 + М11' },
    { materialGroup: 'М01 +' }, { connectionType: 'Т1' }, { pstoRequired: 'ожидает' },
    { d1: -1 }, { d2: Number.NaN }, { t1: 0 }, { t2: '3 мм' },
  ])('does not drop unknown or invalid data: %j', values => {
    const result = check({ ...row, ...values })
    expect(result.applicable).toBe(false)
    expect(result.weldIssues.some(issue => issue.kind === 'invalid')).toBe(true)
  })

  it('uses the shared configurable dictionaries', () => {
    const custom = { ...settings, weldingTypes: [...settings.weldingTypes, 'АФ'], connectionTypes: [...settings.connectionTypes, 'С21'], materialGroups: [...settings.materialGroups, 'М20'] }
    const customCard = { ...card, weldingMethods: ['АФ'], connectionType: 'С21', materialGroups: ['М20'] }
    const customRow = { ...row, weldingMethod: 'АФ', connectionType: 'С21', materialGroup: 'М20' }
    expect(checkTechnologyCardApplicability(customCard, customRow, custom).applicable).toBe(true)
    expect(checkTechnologyCardApplicability(customCard, customRow, settings).applicable).toBe(false)
  })

  it('excludes archive from a new choice while still checking its historical applicability', () => {
    const archived = { ...card, archived: true }
    expect(checkTechnologyCardApplicability(archived, row, settings).applicable).toBe(true)
    expect(createTechnologyCardMatcher([archived], settings).match(row).cards).toEqual([])
    expect(checkTechnologyCardApplicability(archived, { ...row, weldingMethod: 'РАД' }, settings).applicable).toBe(false)
  })
})

describe('technology card automatic choice boundary', () => {
  it('proposes a single matching card only on entering the welding date', () => {
    const matcher = createTechnologyCardMatcher([card], settings)
    expect(getTechnologyCardAutoAssignment(null, { ...row, weldDate: '2026-10-08' }, matcher)).toBe('ТК №12')
    expect(getTechnologyCardAutoAssignment(row, { ...row, weldDate: '2026-10-08' }, matcher)).toBe('ТК №12')
    expect(getTechnologyCardAutoAssignment(row, row, matcher)).toBeNull()
    expect(getTechnologyCardAutoAssignment(row, { ...row, weldDate: 'не дата' }, matcher)).toBeNull()
    expect(getTechnologyCardAutoAssignment({ ...row, weldDate: '2026-10-01' }, { ...row, weldDate: '2026-10-08' }, matcher)).toBeNull()
  })

  it('never fills historical dated rows as cards are added or unrelated values change', () => {
    const dated = { ...row, weldDate: '2026-10-01' }
    expect(getTechnologyCardAutoAssignment(dated, { ...dated, d2: 219 }, createTechnologyCardMatcher([card], settings))).toBeNull()
    expect(getTechnologyCardAutoAssignment(dated, dated, createTechnologyCardMatcher([card], settings))).toBeNull()
  })

  it('preserves an entered unknown or inapplicable number and all other facts', () => {
    const dated = Object.freeze({ ...row, weldDate: '2026-10-08', technologyCardNumber: ' OLD / 7 ', weldingElectrodes: 'Э-1' })
    const before = JSON.stringify(dated)
    expect(getTechnologyCardAutoAssignment(row, dated, createTechnologyCardMatcher([card], settings))).toBeNull()
    expect(JSON.stringify(dated)).toBe(before)
    expect(row.materialGroup).toBe('М05 + М01')
  })

  it('leaves zero, multiple and incomplete matches for an explicit decision', () => {
    const dated = { ...row, weldDate: '2026-10-08' }
    expect(getTechnologyCardAutoAssignment(row, dated, createTechnologyCardMatcher([], settings))).toBeNull()
    expect(getTechnologyCardAutoAssignment(row, dated, createTechnologyCardMatcher([card, { ...card, id: 13, name: 'Техкарта №2' }], settings))).toBeNull()
    expect(getTechnologyCardAutoAssignment(row, { ...dated, t2: null }, createTechnologyCardMatcher([card], settings))).toBeNull()
  })

  it('reads source card values only while building the snapshot, not for every joint', () => {
    let reads = 0
    const cards = Array.from({ length: 2000 }, (_, i) => ({ ...card, id: i + 1, name: String(i + 1),
      get weldingMethods() { reads++; return i === 0 ? ['РАД', 'РД'] : ['РД'] },
    }))
    const matcher = createTechnologyCardMatcher(cards, settings)
    const compilationReads = reads
    for (let i = 0; i < 1000; i++) expect(matcher.match(row).cards.map(item => item.id)).toEqual([1])
    expect(reads).toBe(compilationReads)
    expect(compilationReads).toBeLessThanOrEqual(4000)
  })
})
