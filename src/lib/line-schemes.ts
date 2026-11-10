export const SCHEME_MAX_BYTES = 100 * 1024 * 1024
export const SCHEME_MAX_PAGES = 100
export const SCHEME_PAGE_SIZE = 50
export const SCHEME_LOCK_MS = 180_000
export const SCHEME_CHANGE_NUMBER_MAX_LENGTH = 32
export function schemeChangeNumber(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || value.trim().length > SCHEME_CHANGE_NUMBER_MAX_LENGTH) throw new Error('Номер изменения: не более 32 символов, без переносов строк.')
  return value.trim() || null
}
export type SchemeColor = 'planned' | 'waiting' | 'good' | 'rejected' | 'repair' | 'inactive' | 'error'
export const SCHEME_LEGEND: Record<SchemeColor, { label: string; fill: string; stroke: string }> = {
  planned: { label: 'Ещё не сварен', fill: '#e8edf2', stroke: '#64748b' },
  waiting: { label: 'Ожидает обязательные этапы', fill: '#e8cf7b', stroke: '#a48b3b' },
  good: { label: 'Итоговое «Годен»', fill: '#a1c8b2', stroke: '#568469' },
  rejected: { label: 'Брак — ожидает исправление', fill: '#dfa3a4', stroke: '#ad6267' },
  repair: { label: 'Ремонт выполнен — ожидает НК', fill: '#e7bd8c', stroke: '#ad7e4f' },
  inactive: { label: 'Стык больше не действует', fill: '#94a3b8', stroke: '#64748b' },
  error: { label: 'Не удалось определить состояние', fill: '#fff', stroke: '#475569' },
}
export type SchemeLine = { lineId: number; bundleId: number | null; projectTitle: string; subtitleCode: string; line: string; deleted: boolean; total: number; welded: number; placedCount: number; placedPercent: number | null; revisionCount: number; fileName: string | null }
export const SCHEME_FILTER_FIELDS = ['projectTitle', 'subtitleCode', 'line'] as const
export type SchemeFilterField = typeof SCHEME_FILTER_FIELDS[number]
export type SchemeFilters = Partial<Record<SchemeFilterField, string[]>>
export type SchemeRegistryRequest = { page?: number; search?: string; filters?: SchemeFilters }
export type SchemeRevision = { id: string; fileName: string; changeNumber: string | null; size: number; pageCount: number; version: number; authorName: string; createdAt: string }
export type SchemeBundle = { id: number; lineId: number; projectTitle: string; subtitleCode: string; line: string; deleted: boolean; activeRevisionId: string | null; version: number; revisions: SchemeRevision[] }
export type SchemeLease = { owned: boolean; name: string | null; expiresAt: string | null }
/** Details follow the same current representative as the marker's label. */
export type SchemeWeldInfo = {
  date: string | null; material1: string | null; material2: string | null; d1: number | null; d2: number | null;
  element1: string | null; element2: string | null; t1: number | null; t2: number | null;
  stamp1: string | null; stamp1Fact: string | null; stamp2: string | null; stamp2Fact: string | null;
}
export type SchemeJoint = { key: string; rootId: number; physicalId: number | null; rowId: number | null; inspectionRowId?: number; label: string; color: SchemeColor; reason: string; welded: boolean; placedPage: number | null; weldInfo?: SchemeWeldInfo }
// Control diagnostics do not make a known physical joint ambiguous.
export function canPlaceSchemeJoint(joint: SchemeJoint) { return joint.rowId !== null && joint.color !== 'inactive' }
export type SchemePoint = { id: string; physicalId: number; page: number; x: number; y: number; joint: SchemeJoint }
export type SchemePointChange = { id: string; page: number; x: number; y: number; rootId?: number; physicalId?: number }
export type SchemeDimension = { id: string; fromPointId: string | null; toPointId: string | null; fromAnnotationId?: string | null; toAnnotationId?: string | null; page: number; distanceMm: number; offsetX: number; offsetY: number; color?: string; strokeWidth?: number }
export const SCHEME_ANNOTATION_PALETTE = [
  { color: '#111827', name: 'чёрный' }, { color: '#dc2626', name: 'красный' },
  { color: '#2563eb', name: 'синий' }, { color: '#16a34a', name: 'зелёный' },
  { color: '#ea580c', name: 'оранжевый' }, { color: '#6b7280', name: 'серый' },
] as const
// Preserve saved colors when an existing symbol is moved or renamed.
export const SCHEME_ANNOTATION_COLORS: readonly string[] = [...SCHEME_ANNOTATION_PALETTE.map(item => item.color), '#475569', '#0284c7', '#7c3aed', '#0f766e']
export const SCHEME_DIMENSION_PALETTE = [{ color: '#64748b', name: 'исходный' }, ...SCHEME_ANNOTATION_PALETTE]
export const SCHEME_DIMENSION_WIDTHS = [1, 1.5, 2, 3] as const
export type SchemeAnnotation = { id: string; page: number; x: number; y: number; shape: 'dot' | 'triangle' | 'line'; label: string; note?: string; color: string; size: number; strokeWidth: number; rotation: number }
export type SchemeAnchor = { key: string; id: string; kind: 'point' | 'annotation'; page: number; x: number; y: number; label: string }
export const schemeDimensionEnds = (item: SchemeDimension): [string, string] => [item.fromPointId ? `p:${item.fromPointId}` : `a:${item.fromAnnotationId}`, item.toPointId ? `p:${item.toPointId}` : `a:${item.toAnnotationId}`]
export function schemeAnchors(points: SchemePoint[], annotations: SchemeAnnotation[]): SchemeAnchor[] {
  return [...points.map(p => ({ key: `p:${p.id}`, id: p.id, kind: 'point' as const, page: p.page, x: p.x, y: p.y, label: p.joint.label })),
    ...annotations.map(a => ({ key: `a:${a.id}`, id: a.id, kind: 'annotation' as const, page: a.page, x: a.x, y: a.y, label: a.label }))]
}
export function schemeDimensionPair(a: string, b: string) {
  const [from, to] = [a, b].sort()
  return { fromPointId: from.startsWith('p:') ? from.slice(2) : null, toPointId: to.startsWith('p:') ? to.slice(2) : null,
    fromAnnotationId: from.startsWith('a:') ? from.slice(2) : null, toAnnotationId: to.startsWith('a:') ? to.slice(2) : null }
}
export type SchemeDimensionChanges = { upsert: SchemeDimension[]; remove: string[] }
export type SchemeChanges = { upsert: SchemePointChange[]; remove: string[]; dimensions?: SchemeDimensionChanges; annotations?: { upsert: SchemeAnnotation[]; remove: string[] } }

/** The joint list only records whether and on which sheet a joint is placed.
 * Coordinate/style edits do not change that list; an unknown point is treated
 * conservatively as a new placement. */
export function hasSchemePlacementChanges(changes: Pick<SchemeChanges, 'upsert' | 'remove'>, saved: readonly Pick<SchemePoint, 'id' | 'page'>[]) {
  if (changes.remove.length) return true
  if (!changes.upsert.length) return false
  const pages = new Map(saved.map(point => [point.id, point.page]))
  return changes.upsert.some(point => pages.get(point.id) !== point.page)
}

export function schemeId(value: unknown, label = 'Идентификатор'): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label}: недопустимое значение.`)
  return value as number
}
export function schemeToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new Error('Недопустимый идентификатор операции схемы.')
  return value
}
export function validateSchemeChanges(value: SchemeChanges, pageCount = SCHEME_MAX_PAGES): SchemeChanges {
  if (!value || !Array.isArray(value.upsert) || !Array.isArray(value.remove)) throw new Error('Недопустимые изменения схемы.')
  const ids = new Set<string>()
  for (const point of value.upsert) {
    schemeToken(point.id)
    if (ids.has(point.id)) throw new Error('Точка указана повторно.')
    ids.add(point.id)
    if (!Number.isInteger(point.page) || point.page < 1 || point.page > pageCount || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error('Точка находится за границами листа.')
    if (point.rootId !== undefined) schemeId(point.rootId)
    if (point.physicalId !== undefined) schemeId(point.physicalId)
  }
  for (const id of value.remove) {
    schemeToken(id)
    if (ids.has(id)) throw new Error('Точка одновременно изменена и удалена.')
    ids.add(id)
  }
  if (value.dimensions) validateSchemeDimensions(value.dimensions, pageCount)
  if (value.annotations) validateSchemeAnnotations(value.annotations, pageCount)
  return value
}

export function validateSchemeDimensions(value: SchemeDimensionChanges, pageCount = SCHEME_MAX_PAGES) {
  if (!value || !Array.isArray(value.upsert) || !Array.isArray(value.remove)) throw new Error('Недопустимые изменения размеров.')
  const ids = new Set<string>(), pairs = new Set<string>()
  for (const dimension of value.upsert) {
    schemeToken(dimension.id)
    for (const [point, annotation] of [[dimension.fromPointId, dimension.fromAnnotationId], [dimension.toPointId, dimension.toAnnotationId]]) {
      if ((point != null) === (annotation != null)) throw new Error('Укажите одну привязку для каждого конца размера.')
      schemeToken(point ?? annotation)
    }
    const [from, to] = schemeDimensionEnds(dimension)
    if (ids.has(dimension.id)) throw new Error('Размер указан повторно.')
    ids.add(dimension.id)
    if (from >= to) throw new Error('Выберите две разные точки для размера.')
    const pair = `${from}:${to}`
    if (pairs.has(pair)) throw new Error('Между этими точками уже указан размер.')
    pairs.add(pair)
    if (!Number.isInteger(dimension.page) || dimension.page < 1 || dimension.page > pageCount) throw new Error('Недопустимый лист размера.')
    if (!Number.isFinite(dimension.distanceMm) || dimension.distanceMm <= 0) throw new Error('Расстояние должно быть положительным числом в миллиметрах.')
    if (dimension.color !== undefined && !SCHEME_DIMENSION_PALETTE.some(item => item.color === dimension.color) || dimension.strokeWidth !== undefined && !(SCHEME_DIMENSION_WIDTHS as readonly number[]).includes(dimension.strokeWidth)) throw new Error('Недопустимое оформление размера.')
    if (![dimension.offsetX, dimension.offsetY].every(value => Number.isFinite(value) && value >= -1 && value <= 1)) throw new Error('Недопустимое положение размера.')
  }
  for (const id of value.remove) {
    schemeToken(id)
    if (ids.has(id)) throw new Error('Размер одновременно изменён и удалён.')
    ids.add(id)
  }
}

export function validateSchemeAnnotations(changes: NonNullable<SchemeChanges['annotations']>, pageCount = SCHEME_MAX_PAGES) {
  if (!changes || !Array.isArray(changes.upsert) || !Array.isArray(changes.remove)) throw new Error('Недопустимые изменения обозначений.')
  const ids = new Set<string>()
  for (const a of changes.upsert) {
    schemeToken(a.id)
    if (ids.has(a.id)) throw new Error('Обозначение указано повторно.')
    ids.add(a.id)
    if (!Number.isInteger(a.page) || a.page < 1 || a.page > pageCount || ![a.x, a.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Обозначение находится за границами листа.')
    if (!['dot', 'triangle', 'line'].includes(a.shape)) throw new Error('Неизвестная форма обозначения.')
    if (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 120 || /[\x00-\x1f\x7f]/.test(a.label)) throw new Error('Название: от 1 до 120 символов, без переносов строк.')
    if (a.note !== undefined && (typeof a.note !== 'string' || a.note.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(a.note))) throw new Error('Примечание: не более 1000 символов.')
    if (!(SCHEME_ANNOTATION_COLORS as readonly string[]).includes(a.color) || ![16, 24, 32].includes(a.size) || ![1, 2, 3].includes(a.strokeWidth) || !Number.isInteger(a.rotation) || a.rotation < 0 || a.rotation > 359) throw new Error('Недопустимое оформление обозначения.')
  }
  for (const id of changes.remove) { schemeToken(id); if (ids.has(id)) throw new Error('Обозначение одновременно изменено и удалено.'); ids.add(id) }
}
