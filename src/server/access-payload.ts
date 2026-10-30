import { WELD_FIELDS, type WeldFieldKey } from '@/lib/weld-fields'
import { hasPermission, type AccessIdentity } from '@/lib/access-permissions'
import { canViewWeldField, RESTRICTED_WELD_FIELDS } from '@/lib/weld-field-access'
import { WELD_MUTATION_FIELD_KEYS, LNK_PROFILE_FIELD_KEYS, PSTO_PROFILE_FIELD_KEYS, WELDING_PROFILE_FIELD_KEYS } from './weld-mutation-policy'
import { accessContext } from './access-store'
import type { WeldMutationScope } from './weld-contracts'

/** Validate query selectors before a cache/SQL read, including aggregate/filter probes. */
export function assertReadableQuery(identity: AccessIdentity, value: unknown) {
  const visit = (input: unknown, parent = '') => {
    if (!input || typeof input !== 'object') return
    for (const [key, item] of Object.entries(input)) {
      if (key === 'search' && typeof item === 'string' && item.trim() && !['welding.view', 'lnk.view', 'psto.view'].every(permission => hasPermission(identity, permission as any))) throw new Error('Общий поиск требует просмотра всех рабочих областей. Используйте фильтр доступного столбца.')
      if (['columnFilters', 'filterModel', 'filters'].includes(key) && item && typeof item === 'object') {
        for (const field of Object.keys(item)) if (RESTRICTED_WELD_FIELDS.has(field) && !canViewWeldField(identity, field)) throw new Error('Фильтр использует недоступное поле.')
      }
      if ((['fieldKey', 'field', 'colId', 'columnKey', 'sortKey'].includes(key) || key === 'key' && parent === 'sort') && typeof item === 'string' && RESTRICTED_WELD_FIELDS.has(item) && !canViewWeldField(identity, item)) throw new Error('Запрос использует недоступное поле.')
      if (['fieldKeys', 'columns', 'groupKeys', 'groupBy'].includes(key) && Array.isArray(item)) for (const field of item) {
        if (typeof field === 'string' && RESTRICTED_WELD_FIELDS.has(field) && !canViewWeldField(identity, field)) throw new Error('Запрос использует недоступное поле.')
      }
      visit(item, key)
    }
  }
  visit(value)
}
/** Full client drafts are accepted only when fields outside this operation are unchanged. */
export function assertSubmittedWeldFields(input: Record<string, any>, previous: Record<string, any> | undefined, scope: WeldMutationScope) {
  if (!accessContext.getStore()) return // Trusted local fixture / migration path, never an HTTP bypass.
  const allowed = new Set<string>(WELD_MUTATION_FIELD_KEYS[scope])
  const normalized = (key: string, value: unknown) => value == null || value === '' || key === 'officiality' && value === 'действующий' ? null : value instanceof Date ? value.toISOString() : value
  for (const [key, value] of Object.entries(input)) {
    if (!RESTRICTED_WELD_FIELDS.has(key) || allowed.has(key)) continue
    if (!canViewWeldField(accessContext.getStore()!.identity, key)) throw new Error(`Поле «${key}» недоступно для этого пользователя. Ничего не сохранено.`)
    if (JSON.stringify(normalized(key, value)) !== JSON.stringify(normalized(key, previous?.[key]))) throw new Error(`Поле «${key}» недоступно для изменения в этой операции. Ничего не сохранено.`)
  }
}
export function requireContextPermission(permission: Parameters<typeof hasPermission>[1]) {
  const context = accessContext.getStore()
  if (context && !hasPermission(context.identity, permission)) throw new Error('Недостаточно прав для этого действия.')
  if (context && !context.permissions.includes(permission)) context.permissions.push(permission)
}

/** Import can carry historical specialty facts; it needs each affected specialty,
 * in addition to its import permission. Existing business import checks still run. */
export function assertImportedWeldFields(input: Record<string, unknown>, previous?: Record<string, unknown>) {
  const context = accessContext.getStore()
  if (!context) return
  const welding = new Set<string>(WELDING_PROFILE_FIELD_KEYS)
  for (const [key, value] of Object.entries(input)) {
    if (!RESTRICTED_WELD_FIELDS.has(key) || key === 'id') continue
    const normalize = (entry: unknown) => entry == null || entry === '' || key === 'officiality' && entry === 'действующий' ? null : entry instanceof Date ? entry.toISOString() : entry
    if (JSON.stringify(normalize(value)) === JSON.stringify(normalize(previous?.[key]))) continue
    if (welding.has(key)) continue
    if (PSTO_PROFILE_FIELD_KEYS.has(key as WeldFieldKey)) requireContextPermission('psto.edit')
    else if (LNK_PROFILE_FIELD_KEYS.has(key as WeldFieldKey)) requireContextPermission('lnk.edit')
  }
}

export function accessibleReportInput<T extends { fieldKeys?: string[]; kind?: string }>(input: T): T {
  const context = accessContext.getStore()
  if (!context || context.identity.role !== 'user') return input
  if (input.kind && input.kind !== 'current') for (const area of ['welding', 'lnk', 'psto']) requireContextPermission(`${area}.view` as any)
  assertReadableQuery(context.identity, input)
  return { ...input, fieldKeys: input.fieldKeys ?? [...RESTRICTED_WELD_FIELDS].filter(key => canViewWeldField(context.identity, key) && WELD_FIELDS.some(field => field.key === key)) }
}
