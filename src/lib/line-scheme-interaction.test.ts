import { describe, expect, it } from 'vitest'
import { selectSchemeItems } from './line-scheme-interaction'
import { SCHEME_ANNOTATION_COLORS, SCHEME_ANNOTATION_PALETTE, validateSchemeAnnotations } from './line-schemes'

describe('scheme symbol interaction', () => {
  it('toggles an additive selection, replaces a plain selection and leaves the source intact', () => {
    const selected = new Set(['a', 'b'])
    expect([...selectSchemeItems(selected, 'b', true)]).toEqual(['a'])
    expect([...selectSchemeItems(selected, 'c', true)]).toEqual(['a', 'b', 'c'])
    expect([...selectSchemeItems(selected, 'c', false)]).toEqual(['c'])
    expect([...selected]).toEqual(['a', 'b'])
  })
  it('accepts the new palette and preserves previously saved colors', () => {
    expect(SCHEME_ANNOTATION_PALETTE.map(a => a.name)).toEqual(['чёрный', 'красный', 'синий', 'зелёный', 'оранжевый', 'серый'])
    for (const color of SCHEME_ANNOTATION_COLORS) expect(() => validateSchemeAnnotations({ upsert: [{ id: '00000000-0000-0000-0000-000000000001', page: 1, x: .5, y: .5, label: 'Опора', shape: 'triangle', color, size: 24, strokeWidth: 2, rotation: 0 }], remove: [] })).not.toThrow()
  })
})
