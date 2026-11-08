import { describe, expect, it, vi } from 'vitest'
import { accessContext } from './access-store'
import { loadDocumentTemplateParticipants, normalizeDocumentParticipantRequest } from './document-participants'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
vi.mock('./security-functions', () => ({ assertSecurityScope: vi.fn(async () => {}) }))
const identity: AccessIdentity = { id: 'u', name: 'User', email: '', title: '', role: 'user', permissions: ['documents.view'], revision: 1 }
const run = (permissions: Permission[], kinds: Array<'welder' | 'thermist' | 'inspector'>) => accessContext.run({ identity: { ...identity, permissions }, operation: 'participants', operationId: 'test', area: 'documents', permissions: [] }, () => loadDocumentTemplateParticipants({ rowIds: [], kinds }))
describe('participant access', () => {
  it('validates IDs and categories without limiting the size of a stored document', () => {
    expect(() => normalizeDocumentParticipantRequest({ rowIds: [0], kinds: ['welder'] })).toThrow()
    expect(() => normalizeDocumentParticipantRequest({ rowIds: [1], kinds: [] })).toThrow()
    expect(normalizeDocumentParticipantRequest({ rowIds: [1, 1, 2], kinds: ['welder', 'welder'] })).toEqual({ rowIds: [1, 2], kinds: ['welder'] })
  })
  it('requires only the work areas actually requested and never silently returns a partial list', async () => {
    for (const kind of ['welder', 'thermist', 'inspector'] as const) await expect(run(['documents.view'], [kind])).rejects.toThrow('Недостаточно прав')
    await expect(run(['documents.view', 'welding.view'], ['welder'])).rejects.toThrow('Недостаточно прав')
    await expect(run(['documents.view', 'welding.view', 'references.view'], ['welder'])).resolves.toEqual([])
    await expect(run(['documents.view', 'psto.view'], ['thermist'])).resolves.toEqual([])
    await expect(run(['documents.view', 'lnk.view'], ['inspector'])).resolves.toEqual([])
    await expect(run(['lnk.view'], ['inspector'])).rejects.toThrow('Недостаточно прав')
  })
})
