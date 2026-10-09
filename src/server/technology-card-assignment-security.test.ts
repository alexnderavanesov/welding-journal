import { beforeEach, expect, it, vi } from 'vitest'
import { previewAssignments, assignmentDetails, applyAssignments } from './technology-cards'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), transaction: vi.fn(), scan: vi.fn(), details: vi.fn(), apply: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: mocks.transaction }) }))
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: mocks.guard }))
vi.mock('@/server/technology-card-assignment', () => ({ scanTechnologyCardAssignments: mocks.scan, readTechnologyCardAssignmentDetails: mocks.details, applyTechnologyCardAssignments: mocks.apply }))
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue(undefined); mocks.transaction.mockImplementation(callback => callback('tx')) })
it.each([{ fn: previewAssignments, impl: mocks.scan }, { fn: assignmentDetails, impl: mocks.details }])('requires entry for read-only previews', async ({ fn, impl }) => {
  await fn({} as never)
  expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('entry')
  expect(impl).toHaveBeenCalledExactlyOnceWith('tx', {})
  expect(mocks.apply).not.toHaveBeenCalled()
})
it('requires edit independently of registry settings permissions', async () => {
  await applyAssignments({} as never)
  expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('edit')
  expect(mocks.apply).toHaveBeenCalledExactlyOnceWith('tx', {})
})
it('a denied edit cannot start a transaction', async () => {
  mocks.guard.mockRejectedValue(new Error('Доступ запрещён'))
  await expect(applyAssignments({} as never)).rejects.toThrow('Доступ запрещён')
  expect(mocks.transaction).not.toHaveBeenCalled()
})
