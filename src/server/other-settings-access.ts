import { hasPermission, type AccessIdentity, type Permission } from '@/lib/access-permissions'
import { normalizeOtherSettings, type OtherSettings } from '@/lib/other-settings'
import { requireContextPermission } from './access-payload'
import { accessContext } from './access-store'

const fieldPermissions = {
  requireDlsForOfficialStamps: 'checks.edit',
  wdiCalculationMode: 'wdi.edit',
  wdiCalculationRules: 'wdi.edit',
  wdiTable: 'wdi.edit',
  rkExposureTable: 'processes.edit',
} satisfies Record<keyof OtherSettings, Permission>
const editPermissions = [...new Set(Object.values(fieldPermissions))]

/** The legacy storage key contains three independently delegated sections. */
export function assertOtherSettingsEntry(identity: AccessIdentity): Permission {
  const permission = editPermissions.find(permission => hasPermission(identity, permission))
  if (!permission) throw new Error('Недостаточно прав для этого действия.')
  return permission
}

/** Compare complete effective values under the setting lock. Omitting a field
 * can reset it, so checking only submitted keys would allow cross-area changes. */
export function prepareOtherSettingsChange(previous: unknown, value: unknown): OtherSettings {
  const before = normalizeOtherSettings(previous), after = normalizeOtherSettings(value)
  const required: Permission[] = [...new Set((Object.keys(fieldPermissions) as (keyof OtherSettings)[])
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => fieldPermissions[key]))]
  const context = accessContext.getStore()
  // Middleware supplies one eligible edit permission so the database installs
  // its audited transaction wrapper. Once stored values are locked, replace
  // that provisional permission with exactly the fields this write changes.
  if (context) {
    const entry = assertOtherSettingsEntry(context.identity)
    if (!required.length) required.push(entry)
    const index = context.permissions.indexOf(entry)
    if (index >= 0) context.permissions.splice(index, 1)
  }
  for (const permission of required) requireContextPermission(permission)
  // Keep the audit event in the section actually changed, including an RK-only
  // edit by a process editor. The write rechecks every required permission.
  if (context && required.length) context.area = required[0].split('.')[0]
  return after
}
