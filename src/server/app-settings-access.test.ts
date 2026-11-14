import { beforeEach, expect, it, vi } from 'vitest'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'

const state = vi.hoisted(() => ({ previous: {} as unknown, writes: [] as any[], selects: 0, entryPermissions: [] as string[], writePermissions: [] as string[] }))
vi.mock('@tanstack/react-start', () => ({ createServerOnlyFn: (fn: unknown) => fn,
  createServerFn: () => { const api = { validator: () => api, handler: (fn: unknown) => fn }; return api },
}))
vi.mock('./security', () => ({ assertSecurityScope: async () => {} }))
vi.mock('./weld-validation-settings-lock', () => ({ lockWeldValidationSettings: async () => {}, projectSettingAffectsWeldValidationSnapshot: () => true }))
vi.mock('./dispatcher-task-index-dirty', () => ({ invalidateDerivedCalculationCache: async () => {}, markDispatcherTaskIndexDirty: async () => {} }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: async (run: (tx: any) => unknown) => {
  const { accessContext } = await import('./access-store')
  state.entryPermissions = [...accessContext.getStore()!.permissions]
  const tx = {
    execute: async () => [],
    select: () => ({ from: () => ({ where: () => ({ limit: () => {
      const rows = ++state.selects === 1 ? [{ value: JSON.stringify(state.previous), updatedAt: new Date('2026-01-01') }] : [{ value: '{}' }]
      return Object.assign(Promise.resolve(rows), { for: async () => rows })
    } }) }) }),
    insert: () => ({ values: (value: any) => ({ onConflictDoUpdate: () => ({ returning: async () => {
      state.writes.push(value)
      state.writePermissions = [...accessContext.getStore()!.permissions]
      return [{ updatedAt: value.updatedAt }]
    } }) }) }),
  }
  return run(tx)
} }) }))

import { assertPermission } from '@/lib/access-permissions'
import { getOperationPermissions } from './access-operation-policy'
import { extendOperationPermissions } from './access-document-policy'
import { runWithAccess } from './access-context'
import { saveAppSetting } from './app-settings'

const rkTable = { fileName: 'RK', uploadedAt: '', entries: [{ diameter: 57, options: [{ label: '1', values: ['1'], isDefault: true, note: '' }] }] }
beforeEach(() => { state.previous = DEFAULT_OTHER_SETTINGS; state.writes = []; state.selects = 0; state.entryPermissions = []; state.writePermissions = [] })
async function save(areas: string[], value: unknown) {
  const identity: AccessIdentity = { id: 'editor', name: '', email: '', title: '', role: 'user', revision: 1,
    permissions: areas.flatMap(area => [`${area}.view`, `${area}.edit`]) as Permission[] }
  const data = { key: 'other', value, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }
  const permissions = getOperationPermissions('@settingEdit', data)
  for (const permission of permissions) assertPermission(identity, permission)
  await extendOperationPermissions(identity, 'saveAppSetting', '@settingEdit', data, permissions)
  return runWithAccess(identity, 'saveAppSetting', permissions, () => (saveAppSetting as unknown as (input: { data: unknown }) => Promise<unknown>)({ data }))
}

it('allows a process editor to save RK exposure settings without WDI rights', async () => {
  await expect(save(['processes'], { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: rkTable })).resolves.toBeDefined()
  expect(state.writes).toHaveLength(1)
  expect(state.entryPermissions).toContain('processes.edit')
  expect(state.writePermissions).toEqual(['processes.edit'])
})
it('rejects an RK change combined with a permitted WDI change, without any write', async () => {
  await expect(save(['wdi'], { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula', rkExposureTable: rkTable })).rejects.toThrow('Недостаточно прав')
  expect(state.writes).toHaveLength(0)
})
it('rejects changing the legacy DLS validation through WDI rights', async () => {
  state.previous = { ...DEFAULT_OTHER_SETTINGS, requireDlsForOfficialStamps: true }
  await expect(save(['wdi'], { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' })).rejects.toThrow('Недостаточно прав')
  expect(state.writes).toHaveLength(0)
})
it('checks implicit removal in a partial payload against the stored setting', async () => {
  state.previous = { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: rkTable }
  await expect(save(['wdi'], { wdiCalculationMode: 'formula' })).rejects.toThrow('Недостаточно прав')
  expect(state.writes).toHaveLength(0)
})
it('allows a WDI change retaining RK and DLS values without unrelated edit rights', async () => {
  state.previous = { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: rkTable, requireDlsForOfficialStamps: true }
  await expect(save(['wdi'], { ...state.previous as object, wdiCalculationMode: 'formula' })).resolves.toBeDefined()
  expect(state.writes).toHaveLength(1)
  expect(state.entryPermissions.some(permission => permission.endsWith('.edit'))).toBe(true)
  expect(state.writePermissions).toEqual(['wdi.edit'])
})
it('allows all changed areas when their edit permissions are present', async () => {
  await expect(save(['wdi', 'processes', 'checks'], { ...DEFAULT_OTHER_SETTINGS, rkExposureTable: rkTable, requireDlsForOfficialStamps: true, wdiCalculationMode: 'formula' })).resolves.toBeDefined()
  expect(state.writes).toHaveLength(1)
  expect(state.entryPermissions.some(permission => permission.endsWith('.edit'))).toBe(true)
  expect(state.writePermissions).toEqual(['checks.edit', 'wdi.edit', 'processes.edit'])
})
it('rejects an account with no relevant edit permission before any settings read', async () => {
  await expect(save([], DEFAULT_OTHER_SETTINGS)).rejects.toThrow('Недостаточно прав')
  expect(state.selects).toBe(0)
  expect(state.writes).toHaveLength(0)
})
