import { describe, expect, it } from 'vitest'
import { validateSchemeChanges, schemeDimensionPair, schemeDimensionEnds, schemeAnchors, type SchemeAnnotation } from './line-schemes'
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const a: SchemeAnnotation = { id: id(1), page: 1, x: .2, y: .3, shape: 'triangle', label: 'Опора', color: '#475569', size: 24, strokeWidth: 2, rotation: 90 }
const validate = (item: SchemeAnnotation) => validateSchemeChanges({ upsert: [], remove: [], annotations: { upsert: [item], remove: [] } }, 2)
describe('scheme annotations', () => {
  it('validates shape, label, position and bounded rendering styles', () => {
    expect(() => validate(a)).not.toThrow()
    for (const patch of [{ page: 3 }, { x: Infinity }, { y: -1 }, { label: '' }, { label: 'x'.repeat(121) }, { label: 'a\nb' }, { color: 'url(test)' }, { shape: 'polygon' }, { size: 10000 }, { rotation: NaN }, { rotation: 360 }, { strokeWidth: -1 }]) expect(() => validate({ ...a, ...patch } as SchemeAnnotation)).toThrow()
    expect(() => validateSchemeChanges({ upsert: [], remove: [], annotations: { upsert: [a], remove: [a.id] } })).toThrow()
  })
  it('uses typed centers, so an annotation cannot collide with a point UUID', () => {
    const anchors = schemeAnchors([], [a, { ...a, id: id(2), size: 32, rotation: 270 }])
    expect(anchors.map(v => [v.x, v.y])).toEqual([[.2, .3], [.2, .3]])
    const pair = schemeDimensionPair(`p:${a.id}`, `a:${a.id}`)
    const d = { id: id(3), ...pair, page: 1, distanceMm: 100, offsetX: 0, offsetY: -.1 }
    expect(schemeDimensionEnds(d)).toEqual([`a:${a.id}`, `p:${a.id}`])
    expect(() => validateSchemeChanges({ upsert: [], remove: [], dimensions: { upsert: [d], remove: [] } })).not.toThrow()
    expect(() => validateSchemeChanges({ upsert: [], remove: [], dimensions: { upsert: [{ ...d, fromPointId: id(2) }], remove: [] } })).toThrow()
  })
  it('accepts optional multiline notes without confusing them with required names', () => {
    for (const note of [undefined, '', '  ', 'Проверить\nПосле монтажа', 'x'.repeat(1000)]) expect(() => validate({ ...a, note })).not.toThrow()
    for (const note of ['x'.repeat(1001), 'a\0b', 42, null]) expect(() => validate({ ...a, note } as SchemeAnnotation)).toThrow()
    expect(() => validate({ ...a, label: '', note: 'Примечание не заменяет название' })).toThrow()
  })
})
