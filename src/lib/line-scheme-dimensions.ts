import type { SchemeDimension } from './line-schemes'

type Point = { x: number; y: number }
// WebKit can cull a nearly axial non-scaling stroke in a 1×1 viewBox.
// Keep storage/labels normalized, but draw paths on a larger SVG grid.
export const SCHEME_DIMENSION_EXTENT = 1000
export function schemeDimensionGeometry(a: Point, b: Point, offset: Pick<SchemeDimension, 'offsetX' | 'offsetY'>) {
  const dx = Math.max(-Math.min(a.x, b.x), Math.min(1 - Math.max(a.x, b.x), offset.offsetX))
  const dy = Math.max(-Math.min(a.y, b.y), Math.min(1 - Math.max(a.y, b.y), offset.offsetY))
  const p = (x: number, y: number) => `${x * SCHEME_DIMENSION_EXTENT} ${y * SCHEME_DIMENSION_EXTENT}`
  return { x: (a.x + b.x) / 2 + dx, y: (a.y + b.y) / 2 + dy, offsetX: dx, offsetY: dy,
    main: `M ${p(a.x + dx, a.y + dy)} L ${p(b.x + dx, b.y + dy)}`,
    extensions: `M ${p(a.x, a.y)} L ${p(a.x + dx, a.y + dy)} M ${p(b.x, b.y)} L ${p(b.x + dx, b.y + dy)}` }
}
export const formatSchemeDistance = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 20 })
export function parseSchemeDistance(value: string) {
  const normalized = value.trim().replace(',', '.')
  const number = Number(normalized)
  if (!/^\d+(?:\.\d+)?$/.test(normalized) || !Number.isFinite(number) || number <= 0) throw new Error('Введите положительное расстояние в миллиметрах.')
  return number
}
export const SCHEME_POINT_PREVIEW = 'scheme-point-preview'

export const schemeDimensionStyle = (item: Pick<SchemeDimension, 'color' | 'strokeWidth'>) => {
  const color = item.color ?? '#64748b', strokeWidth = item.strokeWidth ?? 1.5
  return { key: `${color}:${strokeWidth}`, color, strokeWidth }
}
/** At most 7 colors × 4 widths; never one SVG tree per dimension. */
export function groupSchemeDimensionPaths(items: Iterable<{ style: ReturnType<typeof schemeDimensionStyle>; geometry: ReturnType<typeof schemeDimensionGeometry> }>) {
  const groups = new Map<string, { color: string; strokeWidth: number; main: string[]; extensions: string[] }>()
  for (const { style, geometry } of items) {
    let group = groups.get(style.key)
    if (!group) { group = { color: style.color, strokeWidth: style.strokeWidth, main: [], extensions: [] }; groups.set(style.key, group) }
    group.main.push(geometry.main); group.extensions.push(geometry.extensions)
  }
  return groups
}
