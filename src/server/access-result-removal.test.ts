import { expect, it } from 'vitest'
import { assertPermission, type AccessIdentity } from '@/lib/access-permissions'
import { getOperationPermissions, getOperationPolicy } from './access-operation-policy'

const identity: AccessIdentity = { id: 'delete-only', name: '', title: '', email: '', role: 'user', revision: 1,
  permissions: ['lnk.view', 'lnk.delete'] }
const change = { rowId: 1, relationId: 2, expectedVersion: 'v1', result: null }
it('permits pure preheat result removal without granting ordinary editing', () => {
  const policy = getOperationPolicy('pre-heat-treatment-lnk-workflow.ts', 'savePreHeatTreatmentLnkResultEdits')
  const permissions = getOperationPermissions(policy, { changes: [change] })
  expect(() => permissions.forEach(permission => assertPermission(identity, permission))).not.toThrow()
  expect(permissions).toEqual(['lnk.view', 'lnk.delete'])
  const mixed = getOperationPermissions(policy, { changes: [change, { ...change, rowId: 3, relationId: 4, result: 'годен' }] })
  expect(mixed).toEqual(['lnk.view', 'lnk.edit', 'lnk.delete'])
  expect(() => mixed.forEach(permission => assertPermission(identity, permission))).toThrow('Недостаточно прав')
})
it('does not classify invalid preheat edits as a deletion', () => {
  const policy = getOperationPolicy('pre-heat-treatment-lnk-workflow.ts', 'savePreHeatTreatmentLnkResultEdits')
  for (const changes of [[], [{ ...change, result: undefined }], [{ ...change, expectedVersion: '' }]]) {
    expect(() => getOperationPermissions(policy, { changes })).toThrow()
  }
})
