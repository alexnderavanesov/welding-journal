import { describe, expect, it } from 'vitest'
import { validateSchemeChanges, schemeChangeNumber, hasSchemePlacementChanges } from './line-schemes'
const id = '33333333-3333-4333-8333-333333333333'
describe('PDF change number', () => {
  it('keeps an optional designation, including zero and leading zeroes', () => {
    for (const empty of [undefined, null, '', '  ']) expect(schemeChangeNumber(empty)).toBeNull()
    expect(schemeChangeNumber(' 0 ')).toBe('0')
    expect(schemeChangeNumber('01')).toBe('01')
    expect(schemeChangeNumber('2.1')).toBe('2.1')
  })
  it.each([0, {}, '1\n2', '1\t2', 'a'.repeat(33)])('rejects malformed metadata before file storage: %j', value => {
    expect(() => schemeChangeNumber(value)).toThrow(/Номер изменения/)
  })
})
describe('scheme point changes', () => {
  it('keeps normalized precision across zoom/rotation and permits removing tombstones', () => {
    const changes = { upsert: [{ id, page: 3, x: .123456789, y: 1, rootId: 15 }], remove: [] }
    expect(validateSchemeChanges(changes, 4)).toEqual(changes)
    expect(validateSchemeChanges({ upsert: [], remove: [id] })).toEqual({ upsert: [], remove: [id] })
  })
  it.each([{ page: 0 }, { page: 5 }, { x: NaN }, { x: -.01 }, { y: 1.1 }, { rootId: -1 }])('rejects invalid draft %j', invalid => {
    expect(() => validateSchemeChanges({ upsert: [{ id, page: 1, x: .2, y: .4, ...invalid }], remove: [] }, 4)).toThrow()
  })
  it('rejects duplicate or contradictory operations atomically', () => {
    const point = { id, page: 1, x: .1, y: .2 }
    expect(() => validateSchemeChanges({ upsert: [point, point], remove: [] })).toThrow(/повторно/)
    expect(() => validateSchemeChanges({ upsert: [point], remove: [id] })).toThrow(/одновременно/)
  })
})

describe('joint list refresh after a scheme save', () => {
  const saved = [{ id, page: 1 }, { id: 'another-point', page: 2 }]
  it('keeps placement badges and filtering unchanged for coordinate-only and non-point edits', () => {
    expect(hasSchemePlacementChanges({ upsert: [{ id, page: 1, x: .9, y: .8 }], remove: [] }, saved)).toBe(false)
    expect(hasSchemePlacementChanges({ upsert: [], remove: [] }, saved)).toBe(false)
  })
  it('refreshes after addition, deletion, another-sheet placement, or a missing saved baseline', () => {
    expect(hasSchemePlacementChanges({ upsert: [{ id: 'new-point', page: 1, x: .2, y: .3 }], remove: [] }, saved)).toBe(true)
    expect(hasSchemePlacementChanges({ upsert: [], remove: [id] }, saved)).toBe(true)
    expect(hasSchemePlacementChanges({ upsert: [{ id, page: 2, x: .2, y: .3 }], remove: [] }, saved)).toBe(true)
    expect(hasSchemePlacementChanges({ upsert: [{ id, page: 1, x: .2, y: .3 }], remove: [] }, [])).toBe(true)
  })
})
