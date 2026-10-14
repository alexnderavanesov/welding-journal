import { describe, expect, it, vi } from 'vitest'
import { captureTransferredSpecialists, planTransferredSpecialists, restoreTransferredSpecialists } from './document-specialist-transfers'

vi.mock('./layered-control-documents', () => ({ lockLayeredControlDocumentsForWeldChange: vi.fn() }))
vi.mock('./system-document-index', () => ({ lockSystemDocumentIndexes: vi.fn() }))
vi.mock('./specialists', () => ({ writeDocumentSpecialists: vi.fn() }))
const snapshot = { first: { id: 1, name: 'Историческое ФИО', certificate: 'СТАРОЕ' }, second: null }
function setup(count: number, conflict = false) {
  const docs = Array.from({ length: count }, (_, index) => ({ id: index + 1, type: 'system:lnkConclusionVik', title: `ВИК-${index}`, date: '2026-10-01',
    snapshot, stage: 'beforeHeatTreatment', member: true, revision: 1, updatedAt: new Date('2026-10-01') }))
  if (conflict) docs.push({ ...docs[0], id: count + 1, stage: '', member: false, snapshot: { ...snapshot, first: { ...snapshot.first, certificate: 'НОВОЕ' } } })
  const tx = { select: vi.fn((_fields: unknown) => { const chain = { from: () => chain, where: () => chain, orderBy: () => chain,
    for: async () => docs, then: (resolve: (value: unknown) => unknown) => Promise.resolve(docs).then(resolve) }; return chain }), execute: vi.fn() }
  return { tx, docs }
}
describe('stage transfer specialist snapshots', () => {
  it.each([1, 10000])('one narrow read plans %i documents, preserving snapshots without registry access', async count => {
    const { tx } = setup(count)
    const plan = await planTransferredSpecialists(tx as never, [1], 'primary')
    expect(plan.transfers).toHaveLength(count)
    expect(plan.conflicts).toEqual([])
    expect(plan.transfers.every(item => item.snapshot.first?.certificate === 'СТАРОЕ')).toBe(true)
    expect(tx.select).toHaveBeenCalledTimes(1)
    expect(tx.select.mock.calls[0][0]).not.toHaveProperty('sourceMetadata')
    expect(tx.execute).not.toHaveBeenCalled()
  })
  it('requires the exact current snapshot acknowledgment, including certificate changes', async () => {
    const { tx, docs } = setup(1, true)
    const plan = await planTransferredSpecialists(tx as never, [1], 'primary')
    expect(plan.conflicts).toHaveLength(1)
    await expect(captureTransferredSpecialists(tx as never, [1], 'primary')).rejects.toThrow('подтвердите')
    const transfers = await captureTransferredSpecialists(tx as never, [1], 'primary', plan.confirmation)
    expect(transfers[0].snapshot).toEqual({ first: null, second: null })
    docs[1].revision++
    await expect(captureTransferredSpecialists(tx as never, [1], 'primary', plan.confirmation)).rejects.toThrow('Обновите')
    await expect(captureTransferredSpecialists(tx as never, [2], 'primary', plan.confirmation)).rejects.toThrow('Обновите')
    expect(tx.execute).not.toHaveBeenCalled()
  })
  it('does no work for KEEP and rejects a missing destination rather than losing history', async () => {
    const { tx } = setup(1)
    expect(await captureTransferredSpecialists(tx as never, [], 'primary')).toEqual([])
    expect(tx.select).not.toHaveBeenCalled()
    const plan = await planTransferredSpecialists(tx as never, [1], 'primary')
    tx.execute.mockResolvedValue({ rows: [] })
    await expect(restoreTransferredSpecialists(tx as never, plan.transfers)).rejects.toThrow('Ничего не изменено')
  })
})
