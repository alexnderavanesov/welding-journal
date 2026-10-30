/** Shared vocabulary only. The server is the authority for every operation. */
export const ACCESS_AREAS = {
  welding: 'Сварочный журнал', lnk: 'ЛНК', psto: 'ПСТО и ТВМТ',
  lines: 'Программа линий', references: 'Справочники', statistics: 'Статистика',
  documents: 'Документы', templates: 'Шаблоны документов',
  checks: 'Проверки сохранения', dispatcher: 'Диспетчер и ДЗ', exceptions: 'Принятые исключения',
  numbering: 'Заявки, заключения и нумерация', data: 'Настройки данных',
  wdi: 'Расчёт дюймов', processes: 'Процессы контроля', indexes: 'Системные индексы',
} as const
export type AccessArea = keyof typeof ACCESS_AREAS
export const ACCESS_ACTIONS = {
  view: 'Просмотр', edit: 'Изменение', import: 'Импорт и массовое заполнение',
  delete: 'Удаление и отмена', generate: 'Формирование документов', export: 'Выгрузка и печать',
} as const
export type AccessAction = keyof typeof ACCESS_ACTIONS
export type Permission = `${AccessArea}.${AccessAction}` | 'history.view' | 'history.joint'
export type AccountRole = 'owner' | 'admin' | 'user'
export type AccessIdentity = {
  id: string; name: string; email: string; title: string; role: AccountRole;
  permissions: Permission[]; revision: number
}
export const AREA_ACTIONS: Record<AccessArea, readonly AccessAction[]> = {
  welding: ['view', 'edit', 'import', 'delete', 'generate', 'export'],
  lnk: ['view', 'edit', 'delete', 'generate', 'export'], psto: ['view', 'edit', 'delete', 'generate', 'export'],
  lines: ['view', 'edit', 'delete', 'export'], references: ['view', 'edit', 'delete', 'export'], statistics: ['view', 'export'],
  documents: ['view', 'edit', 'delete', 'generate', 'export'], templates: ['view', 'edit', 'delete'],
  checks: ['view', 'edit'], dispatcher: ['view', 'edit'], exceptions: ['view', 'edit'], numbering: ['view', 'edit'],
  data: ['view', 'edit'], wdi: ['view', 'edit'], processes: ['view', 'edit'], indexes: ['view', 'edit'],
}
export const PERMISSIONS: Permission[] = [
  ...Object.entries(AREA_ACTIONS).flatMap(([area, actions]) => actions.map(action => `${area}.${action}` as Permission)),
  'history.view', 'history.joint',
]
const knownPermissions = new Set<string>(PERMISSIONS)
export function normalizePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !knownPermissions.has(item))) {
    throw new Error('Неизвестное разрешение доступа.')
  }
  const permissions = [...new Set(value as Permission[])]
  for (const permission of permissions) if (!permission.startsWith('history.') && !permission.endsWith('.view') && !permissions.includes(`${permission.split('.')[0]}.view` as Permission)) throw new Error('Для действия нужен просмотр соответствующего раздела.')
  return permissions.sort()
}
export function hasPermission(identity: Pick<AccessIdentity, 'role' | 'permissions'> | null | undefined, permission: Permission) {
  return !!identity && (identity.role === 'owner' || identity.role === 'admin' || (identity.permissions.includes(permission) && (permission.startsWith('history.') || permission.endsWith('.view') || identity.permissions.includes(`${permission.split('.')[0]}.view` as Permission))))
}
export function assertPermission(identity: AccessIdentity, permission: Permission) {
  if (!hasPermission(identity, permission)) throw new Error('Недостаточно прав для этого действия.')
}
export function canManageAccount(actor: AccessIdentity, target: { id: string; role: AccountRole }) {
  if (target.role === 'owner' || actor.id === target.id) return false
  return actor.role === 'owner' || (actor.role === 'admin' && target.role === 'user')
}
export const ACCESS_PROFILES: Record<string, { label: string; permissions: Permission[] }> = {
  reader: { label: 'Читатель', permissions: ['welding.view', 'lnk.view', 'psto.view', 'lines.view', 'references.view', 'statistics.view', 'documents.view'] },
  engineer: { label: 'Инженер', permissions: ['welding.view', 'welding.edit', 'welding.generate', 'welding.export', 'lnk.view', 'lnk.edit', 'lnk.generate', 'lnk.export', 'psto.view', 'psto.edit', 'psto.generate', 'psto.export', 'lines.view', 'references.view', 'statistics.view', 'documents.view', 'documents.generate', 'documents.export', 'history.joint'] },
}
export const REPORT_ACCESS_AREAS: Record<string, AccessArea> = {
  weldingJournal: 'welding', lnk: 'lnk', heatTreatment: 'psto', percentageLines: 'lines',
  welderStamps: 'references', statistics: 'statistics', documents: 'documents',
}
export const SETTING_ACCESS_AREAS: Record<string, AccessArea> = {
  'control-processes': 'processes', 'data-list': 'data', dispatcher: 'dispatcher',
  'dispatcher-background': 'dispatcher', 'dispatcher-reminders': 'dispatcher',
  other: 'wdi', 'request-conclusion': 'numbering', 'save-check': 'checks', 'system-index': 'indexes',
}
