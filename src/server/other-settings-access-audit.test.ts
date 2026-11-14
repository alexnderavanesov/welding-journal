import { expect, it, vi } from 'vitest'
import { authUsers, appSettings } from '@/db/schema'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
vi.mock('@/db', () => ({ requireDb: () => { throw new Error('No database in this unit regression') } }))
import { withAuditedTransactions } from './audited-database'
import { accessContext } from './access-store'
import { getOperationPermissions } from './access-operation-policy'
import { extendOperationPermissions } from './access-document-policy'
import { prepareOtherSettingsChange } from './other-settings-access'

it('installs the audited wrapper before resolving changed fields and rechecks their current permissions before writing', async () => {
  const identity: AccessIdentity = { id: 'editor', name: '', title: '', email: '', role: 'user', revision: 1,
    permissions: ['wdi.view', 'wdi.edit', 'processes.view', 'processes.edit'] }
  const permissions = getOperationPermissions('@settingEdit', { key: 'other' })
  await extendOperationPermissions(identity, 'saveAppSetting', '@settingEdit', { key: 'other' }, permissions)
  const write = vi.fn(), checkCurrentUser = vi.fn()
  const builder: any = { values: () => builder, returning: () => builder, then: (resolve: any) => { write(); return Promise.resolve([]).then(resolve) } }
  const tx = {
    execute: async () => [], insert: () => builder,
    select: () => ({ from: (table: unknown) => {
      expect(table).toBe(authUsers)
      return { where: () => ({ for: async () => {
        checkCurrentUser()
        // The user retained WDI but lost permission for the field being changed.
        return [{ ...identity, status: 'active', emailVerified: true, permissions: ['wdi.view', 'wdi.edit'] }]
      } }) }
    } }),
  }
  const db = withAuditedTransactions({ transaction: async (run: (tx: unknown) => unknown) => run(tx) } as any)
  await expect(accessContext.run({ identity, operation: 'saveAppSetting', operationId: 'audit-test', area: permissions[0]?.split('.')[0] ?? 'access', permissions },
    () => db.transaction(async current => {
      const next = prepareOtherSettingsChange(DEFAULT_OTHER_SETTINGS, { ...DEFAULT_OTHER_SETTINGS,
        rkExposureTable: { fileName: 'RK', entries: [{ diameter: 57, options: [{ values: ['1'] }] }] },
      })
      expect(accessContext.getStore()!.permissions).toEqual(['processes.edit'] satisfies Permission[])
      await current.insert(appSettings).values({ key: 'other', value: JSON.stringify(next) })
    }),
  )).rejects.toThrow('Недостаточно прав')
  expect(checkCurrentUser).toHaveBeenCalledOnce()
  expect(write).not.toHaveBeenCalled()
})
