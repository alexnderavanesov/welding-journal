import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => ({ createWeldJoint: vi.fn(), updateWeldJoint: vi.fn(), updateWeldJoints: vi.fn() }))
vi.mock('@/server/weld-mutations-api', () => rpc)
vi.mock('@/server/weld-import-api', () => ({}))
import { createWeldRowOrThrow, updateWeldRowOrThrow, updateWeldRowsOrThrow } from './weld-save-utils'

beforeEach(() => { vi.resetAllMocks(); rpc.createWeldJoint.mockResolvedValue({ id: 1 }); rpc.updateWeldJoint.mockResolvedValue({ id: 1 }); rpc.updateWeldJoints.mockResolvedValue([{ id: 1 }]) })
it('keeps the record version and welding change without resubmitting derived control results or service dates', async () => {
  await updateWeldRowOrThrow({ id: 1, rowVersion: '123', isometry: 'NEW', vikResult: 'ожидает заявку', pstoResult: 'ожидает заявку', finalStatus: 'ожидает заявку', lnkCreatedAt: '2026-10-30' })
  const input = rpc.updateWeldJoint.mock.calls[0][0].data
  expect(input).toMatchObject({ id: 1, expectedVersion: '123', isometry: 'NEW' })
  for (const key of ['vikResult', 'pstoResult', 'finalStatus', 'lnkCreatedAt']) expect(input).not.toHaveProperty(key)
})
it('sends only LNK working fields in a full workflow draft while preserving the batch concurrency contract', async () => {
  await updateWeldRowsOrThrow([{ id: 1, rowVersion: '124', isometry: 'context', vikRequest: 'V-1', vikRequestDate: '30.10.2026', pstoNote: 'context', lnkCreatedAt: '2026-10-30' }], undefined, { mutationScope: 'lnk' })
  const input = rpc.updateWeldJoints.mock.calls[0][0].data
  expect(input).toMatchObject({ expectedVersions: [{ id: 1, version: '124' }], mutationScope: 'lnk', records: [{ id: 1, vikRequest: 'V-1', vikRequestDate: '2026-10-30' }] })
  for (const key of ['isometry', 'pstoNote', 'lnkCreatedAt']) expect(input.records[0]).not.toHaveProperty(key)
})
it('creates a joint without client supplied system defaults', async () => {
  await createWeldRowOrThrow({ joint: 'F1', officiality: 'действующий', finalStatus: 'ожидает сварку' })
  expect(rpc.createWeldJoint.mock.calls[0][0].data).toEqual({ joint: 'F1' })
})
