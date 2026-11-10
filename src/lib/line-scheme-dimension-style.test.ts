import { expect, it } from 'vitest'
import { SCHEME_DIMENSION_PALETTE, SCHEME_DIMENSION_WIDTHS, validateSchemeDimensions } from './line-schemes'
import { schemeDimensionGeometry, schemeDimensionStyle, groupSchemeDimensionPaths } from './line-scheme-dimensions'

it('keeps the old appearance by default and bounds style groups independently of dimension count', () => {
  const geometry = schemeDimensionGeometry({ x: .1, y: .2 }, { x: .3, y: .4 }, { offsetX: 0, offsetY: .02 })
  expect(schemeDimensionStyle({})).toMatchObject({ color: '#64748b', strokeWidth: 1.5 })
  const styles = SCHEME_DIMENSION_PALETTE.flatMap(({ color }) => SCHEME_DIMENSION_WIDTHS.map(strokeWidth => schemeDimensionStyle({ color, strokeWidth })))
  const groups = groupSchemeDimensionPaths(Array.from({ length: 1000 }, (_, n) => ({ style: styles[n % styles.length], geometry })))
  expect(groups.size).toBe(28)
  expect([...groups.values()].reduce((sum, g) => sum + g.main.length, 0)).toBe(1000)
  for (const g of groups.values()) expect(g.main.every(p => p === geometry.main)).toBe(true)
})
it('rejects unsupported colors and widths before writing a size', () => {
  const dim = { id: '00000000-0000-0000-0000-000000000001', fromPointId: '00000000-0000-0000-0000-000000000002', toPointId: '00000000-0000-0000-0000-000000000003', page: 1, distanceMm: 50, offsetX: 0, offsetY: 0 }
  for (const color of SCHEME_DIMENSION_PALETTE) for (const strokeWidth of SCHEME_DIMENSION_WIDTHS) expect(() => validateSchemeDimensions({ upsert: [{ ...dim, color: color.color, strokeWidth }], remove: [] })).not.toThrow()
  for (const patch of [{ color: 'red' }, { color: 'url(test)' }, { strokeWidth: NaN }, { strokeWidth: 5 }]) expect(() => validateSchemeDimensions({ upsert: [{ ...dim, ...patch }], remove: [] })).toThrow()
})
