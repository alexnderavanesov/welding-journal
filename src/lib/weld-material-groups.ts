const statisticalGroupOrder = new Intl.Collator('ru', { numeric: true })

/** Order is meaningful: the first group belongs to D1/T1, the second to D2/T2.
 * A single group belongs to both sides. Never sort persisted joint values. */
export function splitWeldMaterialGroups(value: unknown): string[] {
  return [...new Set(String(value ?? '').split('+').map(part => part.trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean))]
}

export function normalizeWeldMaterialGroups(value: unknown): string {
  return splitWeldMaterialGroups(value).join(' + ')
}

export function getWeldMaterialGroupsError(value: unknown, options?: readonly string[]): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parts = raw.split('+')
  if (parts.length > 2) return 'Поле "Группа материалов": можно указать не более двух групп — по одной для материалов 1 и 2.'
  if (parts.some(part => !part.trim())) return 'Поле "Группа материалов": укажите группу с каждой стороны знака «+», например М05 + М01.'
  const groups = splitWeldMaterialGroups(raw)
  if (options && groups.some(group => !options.includes(group))) {
    return `Поле "Группа материалов" должно содержать значения из настроек: ${options.join(', ') || 'список не заполнен'}. Значение "${groups.filter(group => !options.includes(group)).join(' + ')}" не подходит.`
  }
  return null
}

/** Statistical category only; this must not be written back to a joint. */
export function getStatisticalMaterialGroup(value: unknown): string {
  return splitWeldMaterialGroups(value).sort(statisticalGroupOrder.compare).join(' + ')
}
