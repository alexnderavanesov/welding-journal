import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { createEmptyTechnologyCardDraft, parseTechnologyCardDimension, validateTechnologyCard } from '@/lib/technology-card-validation'
import { normalizeTechnologyCardName } from '@/lib/technology-card-name'

const draft = {
  name: '  ТК-12/А  ', weldingMethods: ['РАД', 'РД'], connectionType: 'С17',
  materialGroups: ['М05', 'М01'], diameterFrom: '57', diameterTo: '159',
  thicknessFrom: '3,5', thicknessTo: '6', psto: 'any',
}
const validate = (value: unknown) => validateTechnologyCard(value, DEFAULT_DATA_LIST_SETTINGS)

describe('technology card registry validation', () => {
  it('preserves identifiers and returns validated numeric ranges', () => {
    expect(validate(draft)).toEqual({ issues: [], card: { ...draft, name: 'ТК-12/А', diameterFrom: 57, diameterTo: 159, thicknessFrom: 3.5, thicknessTo: 6 } })
    expect(normalizeTechnologyCardName(' ab-12 / 01 ')).toBe('ab-12 / 01')
    expect(normalizeTechnologyCardName('0012')).toBe('0012')
    expect(normalizeTechnologyCardName(' ТК  №12 ')).toBe('ТК  №12')
    expect(normalizeTechnologyCardName(' ТК\u00a0№12 ')).toBe('ТК\u00a0№12')
    expect(normalizeTechnologyCardName(' - ')).toBe('')
    expect(validate({ ...draft, name: '-' }).issues.map(issue => issue.field)).toEqual(['name'])
  })

  it('returns all missing fields at once, including both ends of both ranges', () => {
    const result = validate(createEmptyTechnologyCardDraft())
    expect(result.card).toBeNull()
    expect(new Set(result.issues.map(issue => issue.field))).toEqual(new Set(['name', 'weldingMethods', 'connectionType', 'materialGroups', 'diameterFrom', 'diameterTo', 'thicknessFrom', 'thicknessTo']))
  })

  it('limits even valid dictionary methods to two and reports other errors together', () => {
    const settings = { ...DEFAULT_DATA_LIST_SETTINGS, weldingTypes: ['РАД', 'РД', 'АФ'] }
    expect(validateTechnologyCard(draft, settings).card).not.toBeNull()
    const result = validateTechnologyCard({ ...draft, weldingMethods: settings.weldingTypes, diameterFrom: '219', thicknessTo: 'нет' }, settings)
    expect(result.card).toBeNull()
    expect(new Set(result.issues.map(issue => issue.field))).toEqual(new Set(['weldingMethods', 'diameterFrom', 'diameterTo', 'thicknessTo']))
    expect(result.issues.find(issue => issue.field === 'weldingMethods')?.message).toContain('не больше двух')
  })

  it('reports overlapping dictionary, dimension and PSTO errors together', () => {
    const result = validate({ ...draft, weldingMethods: ['РАД', 'BAD'], materialGroups: ['M01', 'М05', 'М11'], connectionType: 'Т1', diameterFrom: '219', thicknessTo: 'нет', psto: 'проведено' })
    expect(result.card).toBeNull()
    expect(new Set(result.issues.map(issue => issue.field))).toEqual(new Set(['weldingMethods', 'materialGroups', 'connectionType', 'diameterFrom', 'diameterTo', 'thicknessTo', 'psto']))
  })

  it.each(['weldingMethods', 'materialGroups'])('rejects duplicate %s without silently changing the selection', field => {
    expect(validate({ ...draft, [field]: field === 'weldingMethods' ? ['РД', 'РД'] : ['М01', 'М01'] }).issues.some(issue => issue.field === field)).toBe(true)
  })

  it('rejects malformed requests without exceptions or coercing objects to text', () => {
    for (const value of [null, [], 'card', 3, { ...draft, name: {}, materialGroups: [null, {}], weldingMethods: 'РД' }]) {
      expect(validate(value).card).toBeNull()
    }
  })

  it.each(['', 'NaN', 'Infinity', '-1', '0', '0x39', '5e2', '3 мм', '1.2345', 1e12, Number.NaN, false, {}, null])('rejects invalid dimension %j', value => {
    expect(parseTechnologyCardDimension(value)).toBeNull()
  })

  it.each([['0,001', 0.001], ['57.123', 57.123], [159, 159]])('accepts dimension %s', (value, expected) => {
    expect(parseTechnologyCardDimension(value)).toBe(expected)
  })

  it('allows inclusive single-value ranges', () => {
    expect(validate({ ...draft, diameterTo: '57', thicknessTo: '3.5' }).issues).toEqual([])
  })
})
