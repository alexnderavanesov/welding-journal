import { expect, it, vi } from 'vitest'
vi.mock('@/db', () => ({ requireDb: () => { throw new Error('This policy test must not access a database') } }))
import { extendOperationPermissions } from './access-document-policy'
import { getOperationPermissions, getOperationPolicy } from './access-operation-policy'
import type { AccessIdentity } from '@/lib/access-permissions'
const editor: AccessIdentity = { id: 'editor', name: 'Инженер', email: '', title: '', role: 'user', revision: 1,
  permissions: ['welding.view', 'welding.edit', 'lnk.view', 'lnk.edit', 'psto.view', 'psto.edit', 'lines.view', 'lines.edit', 'references.view', 'references.edit'] }

it.each([
  ['correctPstoCycleStage', { action: 'delete' }],
  ['correctPreHeatTreatmentLnkResult', { action: 'delete' }],
  ['changeLayeredControl', { assigned: false }],
  ['changeTechnologyCard', { action: 'archive' }],
  ['changeLineProgramApprovals', { action: 'approve' }],
  ['createEarlyCoilDecision', {}],
])('requires separate delete/exception permission for %s', async (name, input) => {
  await expect(extendOperationPermissions(editor, name, '@identity', input, [])).rejects.toThrow('Недостаточно прав')
})
it('keeps ordinary corrections available without delete permission', async () => {
  await expect(extendOperationPermissions(editor, 'correctPstoCycleStage', '@identity', { action: 'update' }, [])).resolves.toBeUndefined()
  await expect(extendOperationPermissions(editor, 'correctPreHeatTreatmentLnkResult', '@identity', { action: 'update' }, [])).resolves.toBeUndefined()
})

it.each([
  ['generated-documents.ts', 'getRemoteGeneratedDocumentSequence', 'templates.view'],
  ['generated-documents.ts', 'getRemoteGeneratedDocumentSequence', 'numbering.view'],
  ['generated-documents.ts', 'getRemoteGeneratedDocumentSequence', 'documents.view'],
  ['line-program.ts', 'findLineProgram', 'welding.view'],
  ['line-program.ts', 'findLineProgram', 'lines.view'],
  ['weld-read-api.ts', 'getWeldDataUsageSummary', 'data.view'],
  ['weld-read-api.ts', 'getWeldDataUsageSummary', 'indexes.view'],
])('allows the bounded helper %s#%s from its own screen (%s)', async (file, name, permission) => {
  const identity = { ...editor, permissions: [permission] as AccessIdentity['permissions'] }
  const policy = getOperationPolicy(file, name)
  const required = getOperationPermissions(policy, {})
  await extendOperationPermissions(identity, name, policy, {}, required)
  expect(required).toEqual([permission])
})

it.each([
  ['generated-documents.ts', 'getRemoteGeneratedDocumentSequence'],
  ['line-program.ts', 'findLineProgram'],
  ['weld-read-api.ts', 'getWeldDataUsageSummary'],
])('keeps the helper %s#%s closed without either screen permission', async (file, name) => {
  const identity = { ...editor, permissions: [] }
  const policy = getOperationPolicy(file, name)
  const required = getOperationPermissions(policy, {})
  // The same permission assertion is used by the RPC middleware after extension.
  const { assertPermission } = await import('@/lib/access-permissions')
  await expect((async () => {
    await extendOperationPermissions(identity, name, policy, {}, required)
    required.forEach(permission => assertPermission(identity, permission))
  })()).rejects.toThrow('Недостаточно прав')
})

it.each(['archive', 'delete'])('technology-card %s uses the separate deletion permission', async action => {
  const identity = { ...editor, permissions: ['references.view', 'references.delete'] as AccessIdentity['permissions'] }
  const policy = getOperationPolicy('technology-cards-api.ts', 'changeTechnologyCard')
  const required = getOperationPermissions(policy, { action })
  await extendOperationPermissions(identity, 'changeTechnologyCard', policy, { action }, required)
  expect(required.sort()).toEqual(['references.delete', 'references.view'])
  const edits = getOperationPermissions(policy, { action: 'update' })
  expect(edits).toContain('references.edit')
})
