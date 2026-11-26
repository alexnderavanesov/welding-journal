import { PublicRequestError } from '@/lib/public-request-error'
import { WELD_FIELDS, type WeldFieldKey } from '@/lib/weld-fields'
import { hasPermission, type AccessIdentity } from '@/lib/access-permissions'
import { canViewWeldField, RESTRICTED_WELD_FIELDS } from '@/lib/weld-field-access'
import { WELD_MUTATION_FIELD_KEYS, WELDING_PROFILE_FIELD_KEYS } from './weld-mutation-policy'
import { accessContext } from './access-store'
import type { WeldMutationScope } from './weld-contracts'

const importFieldKeys = new Set<string>(WELD_FIELDS.map(field => field.key))
const writableImportFieldKeys = new Set<string>(WELDING_PROFILE_FIELD_KEYS)

/** Validate query selectors before a cache/SQL read, including aggregate/filter probes. */
export function assertReadableQuery(identity: AccessIdentity, value: unknown, searchArea?: 'lnk' | 'psto') {
  const visit = (input: unknown, parent = '') => {
    if (!input || typeof input !== 'object') return
    for (const [key, item] of Object.entries(input)) {
      if (key === 'search' && typeof item === 'string' && item.trim() &&
        !(searchArea && hasPermission(identity, `${searchArea}.view`)) &&
        !['welding.view', 'lnk.view', 'psto.view'].every(permission => hasPermission(identity, permission as any))) throw new PublicRequestError('Общий поиск требует просмотра всех рабочих областей. Используйте фильтр доступного столбца.', 403)
      if (['columnFilters', 'filterModel', 'filters'].includes(key) && item && typeof item === 'object') {
        for (const field of Object.keys(item)) if (RESTRICTED_WELD_FIELDS.has(field) && !canViewWeldField(identity, field)) throw new PublicRequestError('Фильтр использует недоступное поле.', 403)
      }
      if ((['fieldKey', 'field', 'colId', 'columnKey', 'sortKey'].includes(key) || key === 'key' && parent === 'sort') && typeof item === 'string' && RESTRICTED_WELD_FIELDS.has(item) && !canViewWeldField(identity, item)) throw new PublicRequestError('Запрос использует недоступное поле.', 403)
      if (['fieldKeys', 'columns', 'groupKeys', 'groupBy'].includes(key) && Array.isArray(item)) for (const field of item) {
        if (typeof field === 'string' && RESTRICTED_WELD_FIELDS.has(field) && !canViewWeldField(identity, field)) throw new PublicRequestError('Запрос использует недоступное поле.', 403)
      }
      visit(item, key)
    }
  }
  visit(value)
}

/** These handlers search only shared identity and their own specialty fields.
 * Never infer the scope from client input or exempt field selectors themselves.
 */
export function getOperationSearchArea(filename: string, name: string): 'lnk' | 'psto' | undefined {
  if (filename.replaceAll('\\', '/').split('/').at(-1) !== 'weld-read-api.ts') return
  if (['listLnkWorkflowRows', 'getLnkWorkflowRequestSummary'].includes(name)) return 'lnk'
  if (['listPstoWorkflowRows', 'getPstoWorkflowRequestOptions'].includes(name)) return 'psto'
}
/** Full client drafts are accepted only when fields outside this operation are unchanged. */
export function assertSubmittedWeldFields(input: Record<string, any>, previous: Record<string, any> | undefined, scope: WeldMutationScope) {
  assertNoSubmittedWorkflowAccess(input)
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

/** Import changes journal fields only. Specialty permissions never authorize
 * creating workflow history through this entry point, including local calls. */
export function assertImportedWeldFields(input: Record<string, unknown>, previous?: Record<string, unknown>) {
  assertNoSubmittedWorkflowAccess(input)
  if (Object.hasOwn(input, 'preHeatTreatmentRequired') || Object.hasOwn(input, 'newPreHeatTreatmentChoice')) {
    throw new Error('Требование НК до ТО не задаётся импортом. Измените его в карточке исходного стыка и подтвердите состав цепочки.')
  }
  for (const key of Object.keys(input)) {
    if (!importFieldKeys.has(key)) throw new Error(`Поле «${key}» недоступно для импорта. Связанные этапы и состояние цепочки определяются по сохранённым данным.`)
  }
  const forbidden: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (key === 'id' || writableImportFieldKeys.has(key)) continue
    const normalize = (entry: unknown) => entry == null || entry === '' || key === 'officiality' && entry === 'действующий' ? null : entry instanceof Date ? entry.toISOString() : entry
    if (JSON.stringify(normalize(value)) === JSON.stringify(normalize(previous?.[key]))) continue
    forbidden.push(key)
  }
  if (forbidden.length) throw new Error(`Поля «${forbidden.join('», «')}» недоступны для импорта. Заявки, результаты, заключения и другие системные данные изменяются только через соответствующие разделы системы. Ничего не сохранено.`)
}

function assertNoSubmittedWorkflowAccess(input: Record<string, unknown>) {
  if (Object.hasOwn(input, 'controlWorkflowAccess')) throw new Error('Поле «controlWorkflowAccess» недоступно для изменения. Готовность этапов проверяется по сохранённым данным.')
}

export function accessibleReportInput<T extends { fieldKeys?: string[]; kind?: string }>(input: T): T {
  const context = accessContext.getStore()
  if (!context || context.identity.role !== 'user') return input
  if (input.kind && input.kind !== 'current') for (const area of ['welding', 'lnk', 'psto']) requireContextPermission(`${area}.view` as any)
  assertReadableQuery(context.identity, input)
  return { ...input, fieldKeys: input.fieldKeys ?? [...RESTRICTED_WELD_FIELDS].filter(key => canViewWeldField(context.identity, key) && WELD_FIELDS.some(field => field.key === key)) }
}
