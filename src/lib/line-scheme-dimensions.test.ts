import { describe, expect, it } from 'vitest'
import { parseSchemeDistance, schemeDimensionGeometry } from './line-scheme-dimensions'
import { validateSchemeChanges, type SchemeDimension } from './line-schemes'

const a = '00000000-0000-0000-0000-000000000001', b = '00000000-0000-0000-0000-000000000002'
const dimension: SchemeDimension = { id: '00000000-0000-0000-0000-000000000003', fromPointId: a, toPointId: b, page: 1, distanceMm: 1250.5, offsetX: 0, offsetY: -.05 }
const validate = (patch: Partial<SchemeDimension> = {}) => validateSchemeChanges({ upsert: [], remove: [], dimensions: { upsert: [{ ...dimension, ...patch }], remove: [] } }, 2)

describe('manual dimensions', () => {
  it.each([['1250', 1250], [' 1250,5 ', 1250.5], ['0.25', .25]])('accepts positive millimetres %s', (text, value) => expect(parseSchemeDistance(text)).toBe(value))
  it.each(['', '0', '-12', 'Infinity', '1e9', '12мм', '12,3.4'])('rejects invalid distance %s', value => expect(() => parseSchemeDistance(value)).toThrow())
  it('rejects same/reversed endpoints and duplicate pairs', () => {
    expect(() => validate()).not.toThrow()
    expect(() => validate({ toPointId: a })).toThrow()
    expect(() => validate({ fromPointId: b, toPointId: a })).toThrow()
    expect(() => validateSchemeChanges({ upsert: [], remove: [], dimensions: { upsert: [dimension, { ...dimension, id: '00000000-0000-0000-0000-000000000004' }], remove: [] } })).toThrow(/уже указан/)
  })
  it.each([0, -1, NaN, Infinity])('rejects non-positive or non-finite value %s', distanceMm => expect(() => validate({ distanceMm })).toThrow())
  it('rejects invalid pages, positions and conflicting removal', () => {
    for (const patch of [{ page: 3 }, { page: 0 }, { page: 1.5 }, { offsetY: NaN }, { offsetX: 1.1 }]) expect(() => validate(patch)).toThrow()
    expect(() => validateSchemeChanges({ upsert: [], remove: [], dimensions: { upsert: [dimension], remove: [dimension.id] } })).toThrow()
  })
  it('keeps extension endpoints inside the sheet without changing the stored number', () => {
    const original = { ...dimension, offsetX: 1, offsetY: -1 }
    const result = schemeDimensionGeometry({ x: .1, y: .2 }, { x: .7, y: .8 }, original)
    expect(result.offsetX).toBeCloseTo(.3); expect(result.offsetY).toBeCloseTo(-.2)
    expect(result.x).toBeCloseTo(.7); expect(result.y).toBeCloseTo(.3)
    expect(original.distanceMm).toBe(1250.5); expect(original.offsetX).toBe(1)
    const moved = schemeDimensionGeometry({ x: .2, y: .3 }, { x: .8, y: .9 }, dimension)
    expect(moved.x).toBe(.5); expect(moved.y).toBeCloseTo(.55); expect(dimension.distanceMm).toBe(1250.5)
  })
})
