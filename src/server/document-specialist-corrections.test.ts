import { expect, it, vi } from 'vitest'
import { captureCorrectedDocumentSpecialists, planCorrectedDocumentSpecialists, restoreCorrectedDocumentSpecialists } from './document-specialist-corrections'
import { writeDocumentSpecialists } from './specialists'
vi.mock('./layered-control-documents', () => ({ lockLayeredControlDocumentsForWeldChange: vi.fn() }))
vi.mock('./system-document-index', () => ({ lockSystemDocumentIndexes: vi.fn() }))
vi.mock('./specialists', () => ({ writeDocumentSpecialists: vi.fn() }))
const snapshot = { first: { id: 1, name: 'Историческое ФИО', certificate: 'СТАРОЕ' }, second: null }
const doc = { id: 1, type: 'system:lnkConclusionVik', title: 'ВИК', date: '2026-10-01', snapshot, revision: 2, positions: ['vik:1:pre:1'], total: 1 }

it('preserves snapshots when ordinary correction recreates or splits a document, without registry lookup', () => {
  expect(planCorrectedDocumentSpecialists([doc], [{ ...doc, id: 2, title: 'Другое имя', snapshot: null, revision: 0 }])[0].snapshot).toEqual(snapshot)
  expect(planCorrectedDocumentSpecialists([doc], [doc])).toEqual([])
  expect(planCorrectedDocumentSpecialists([doc], [{ ...doc, id: 2, positions: ['vik:1:pre:2'], snapshot: null }])).toEqual([])
  expect(planCorrectedDocumentSpecialists([doc], [])).toEqual([])
})
it('treats a pre-existing empty destination pair as a conflict too', () => {
  expect(planCorrectedDocumentSpecialists([doc], [{ ...doc, id: 2, total: 2, snapshot: null }])[0]).toMatchObject({ conflict: true, snapshot: { first: null, second: null } })
})
it.each([1, 10000])('uses one capture and one restoration query for %i positions', async count => {
  const before = Array.from({ length: count }, (_, index) => ({ ...doc, id: index + 1, positions: [`vik:${index}:pre:1`] }))
  const after = before.map(document => ({ ...document, id: document.id + count, snapshot: null }))
  const tx = { execute: vi.fn().mockResolvedValueOnce({ rows: before }).mockResolvedValueOnce({ rows: after }) }
  const captured = await captureCorrectedDocumentSpecialists(tx as never, before.map(document => document.id))
  await restoreCorrectedDocumentSpecialists(tx as never, captured)
  expect(tx.execute).toHaveBeenCalledTimes(2)
  expect(vi.mocked(writeDocumentSpecialists).mock.lastCall?.[1]).toHaveLength(count)
})
it('confirmation survives recreated IDs but rejects changed certificate/revision', async () => {
  const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ ...doc, id: 3, title: 'Объединённое', total: 2, snapshot: null, revision: 0 }] }) }
  const captured = { rowIds: [1], documents: [doc] }
  const message = await restoreCorrectedDocumentSpecialists(tx as never, captured).catch(error => error.message as string)
  const token = String(message).match(/specialist-confirmation:([a-f0-9]{64})/)![1]
  tx.execute.mockResolvedValue({ rows: [{ ...doc, id: 4, title: 'Объединённое', total: 2, snapshot: null, revision: 0 }] })
  await expect(restoreCorrectedDocumentSpecialists(tx as never, captured, token)).resolves.toBeUndefined()
  await expect(restoreCorrectedDocumentSpecialists(tx as never, { ...captured, documents: [{ ...doc, revision: 3 }] }, token)).rejects.toThrow('specialist-confirmation')
  tx.execute.mockResolvedValue({ rows: [{ ...doc, id: 4, title: 'Объединённое', total: 2, snapshot: null, revision: 0, membership: 'another-weld-with-the-same-count' }] })
  await expect(restoreCorrectedDocumentSpecialists(tx as never, captured, token)).rejects.toThrow('specialist-confirmation')
})
