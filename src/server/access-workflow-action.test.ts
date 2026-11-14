import { expect, it, vi } from 'vitest'
import { assertPermission, type AccessIdentity, type Permission } from '@/lib/access-permissions'
vi.mock('@/db', () => ({ requireDb: () => { throw new Error('The action policy must not read the database') } }))
import { getOperationPermissions, getOperationPolicy } from './access-operation-policy'
import { extendOperationPermissions } from './access-document-policy'

const cases = [
  ['weld-mutations-api.ts', 'manageLnkRequestDocument', 'lnk', 'rename'],
  ['weld-mutations-api.ts', 'managePstoRequestDocument', 'psto', 'rename'],
  ['psto-repeat-workflow.ts', 'correctPstoCycleStage', 'psto', 'update'],
  ['pre-heat-treatment-lnk-workflow.ts', 'correctPreHeatTreatmentLnkResult', 'lnk', 'update'],
] as const

for (const [file, operation, area, editAction] of cases) {
  async function allowed(action: unknown, granted: 'edit' | 'delete') {
    const identity: AccessIdentity = { id: 'editor', name: '', title: '', email: '', role: 'user', revision: 1,
      permissions: [`${area}.view`, `${area}.${granted}`] as Permission[] }
    const policy = getOperationPolicy(file, operation), input = { action }
    const required = getOperationPermissions(policy, input)
    required.forEach(permission => assertPermission(identity, permission))
    await extendOperationPermissions(identity, operation, policy, input, required)
    return required
  }
  it(`${operation} separates explicit deletion from ordinary editing`, async () => {
    await expect(allowed('delete', 'delete')).resolves.toEqual([`${area}.view`, `${area}.delete`])
    await expect(allowed('delete', 'edit')).rejects.toThrow('Недостаточно прав')
    await expect(allowed(editAction, 'edit')).resolves.toEqual([`${area}.view`, `${area}.edit`])
    await expect(allowed(editAction, 'delete')).rejects.toThrow('Недостаточно прав')
  })
  it(`${operation} does not guess the action for malformed or mixed commands`, async () => {
    for (const action of [undefined, null, '', 'DELETE', 'delete-and-update', ['delete', editAction]]) {
      await expect(allowed(action, 'delete')).rejects.toThrow()
    }
  })
}
