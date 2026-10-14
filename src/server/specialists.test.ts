import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generatedDocuments } from '@/db/schema'
import { applySpecialistAssignments, normalizeSpecialistCard, normalizeSpecialistAssignment } from './specialists'

const mocked = vi.hoisted(() => ({ database: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: mocked.database }))

const now = new Date('2026-10-12T00:00:00.000Z')
const card = { name: 'Иванов', kind: 'inspector' as const, certificate: '123', methods: ['ВИК' as const] }
function setup(count: number) {
  const documents = Array.from({ length: count }, (_, index) => ({ id: index + 1, type: 'system:lnkConclusionVik', specialists: null, specialistsRevision: 0, updatedAt: now, documentVersion: '101' }))
  const records = [{ ...card, id: 1, revision: 1 }]
  const tx = { select: vi.fn((fields?: unknown) => ({ from(table: unknown) { const chain = { where: vi.fn(() => chain), orderBy: vi.fn(() => chain), for: vi.fn(async () => table === generatedDocuments ? documents : records) }; return chain } })), execute: vi.fn(async () => ({ rows: [] })) }
  mocked.database.mockReturnValue({ transaction: (callback: (tx: unknown) => unknown) => callback(tx) })
  return { tx, documents, targets: documents.map(document => ({ id: document.id, revision: 0, updatedAt: now.toISOString(), documentVersion: document.documentVersion })) }
}

describe('specialist server validation and bounded database traffic', () => {
  beforeEach(() => vi.clearAllMocks())
  it('validates cards, normalizes thermists without method choices and requires a version for edits', () => {
    expect(normalizeSpecialistCard({ ...card, name: ' Иванов ' }).name).toBe('Иванов')
    expect(normalizeSpecialistCard({ ...card, kind: 'thermist' }).methods).toEqual([])
    for (const change of [{ name: '' }, { certificate: '' }, { methods: [] }, { id: 1 }]) expect(() => normalizeSpecialistCard({ ...card, ...change })).toThrow()
  })
  it('rejects empty and duplicate selections', () => {
    const { targets } = setup(1)
    expect(() => normalizeSpecialistAssignment({ documents: targets, selection: {} })).toThrow('хотя бы одной')
    expect(() => normalizeSpecialistAssignment({ documents: [targets[0], targets[0]], selection: { first: null } })).toThrow('выбор документов')
  })
  it.each([1, 10000])('uses two bounded reads and one bulk write for %i documents, never loading their 200k-weld composition', async count => {
    const { tx, targets } = setup(count)
    await expect(applySpecialistAssignments({ documents: targets, selection: { first: 1, second: 1 } })).resolves.toEqual({ count })
    expect(tx.select).toHaveBeenCalledTimes(2)
    expect(tx.execute).toHaveBeenCalledTimes(1)
    expect(tx.select.mock.calls[0][0]).not.toHaveProperty('sourceMetadata')
    expect(tx.select.mock.calls[0][0]).not.toHaveProperty('rowIds')
    expect(tx.select.mock.calls[0][0]).toHaveProperty('documentVersion')
  })
  it('does not read the registry when clearing, and rejects stale documents before any write', async () => {
    const { tx, targets } = setup(50)
    await applySpecialistAssignments({ documents: targets, selection: { first: null } })
    expect(tx.select).toHaveBeenCalledTimes(1)
    expect(tx.execute).toHaveBeenCalledOnce()
    tx.execute.mockClear()
    await expect(applySpecialistAssignments({ documents: targets.map(target => ({ ...target, revision: 7 })), selection: { first: null } })).rejects.toThrow('изменились')
    expect(tx.execute).not.toHaveBeenCalled()
  })
  it('rejects a mixed method batch atomically before the single write', async () => {
    const { tx, documents, targets } = setup(2)
    documents[1].type = 'system:lnkConclusionRk'
    await expect(applySpecialistAssignments({ documents: targets, selection: { first: 1 } })).rejects.toThrow('РК')
    expect(tx.execute).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'NaN', '0', ' 101 ', 101])('refuses a missing/malformed document token (%s) before accessing storage', async documentVersion => {
    const { targets } = setup(1)
    mocked.database.mockClear()
    await expect(applySpecialistAssignments({ documents: [{ ...targets[0], documentVersion }] as never, selection: { first: null } })).rejects.toThrow('служебную версию')
    expect(mocked.database).not.toHaveBeenCalled()
  })

  it.each(['system:lnkConclusionVik', 'system:lnkConclusionRk', 'system:lnkConclusionPvk', 'system:lnkConclusionUzk', 'system:pstoConclusion', 'system:tvmtConclusion', 'layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers'])('rejects stale xmin in %s even with the same timestamp/revision, without partial clearing', async type => {
    const { tx, targets, documents } = setup(2)
    documents.forEach(document => { document.type = type })
    documents[1].documentVersion = '102'
    await expect(applySpecialistAssignments({ documents: targets, selection: { first: null } })).rejects.toThrow('Документы изменились')
    expect(tx.select).toHaveBeenCalledTimes(1)
    expect(tx.execute).not.toHaveBeenCalled()
  })
})
