// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as {value: string}[], hash: vi.fn(), transaction: vi.fn() }))
vi.mock('better-auth/crypto', async original => ({ ...await original<typeof import('better-auth/crypto')>(), hashPassword: state.hash }))
vi.mock('@/db', () => ({ requireDb: () => ({
  insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{ count: 1 }] }) }) }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows }) }) }),
  transaction: state.transaction,
}) }))
import { completeAccountLink } from './account-management'

const input = { token: 'A'.repeat(48), kind: 'invite' as const, password: 'local-test-password' }
beforeEach(() => { state.rows = []; state.hash.mockReset(); state.transaction.mockReset() })

it('rejects an absent, expired or wrong-kind link before hashing or opening a write transaction', async () => {
  for (const rows of [[], [{ value: 'recovery:owner:1' }]]) {
    state.rows = rows
    await expect(completeAccountLink(input)).rejects.toThrow('Ссылка')
  }
  expect(state.hash).not.toHaveBeenCalled()
  expect(state.transaction).not.toHaveBeenCalled()
})

it('bounds concurrent password work without consuming a link and releases capacity after failure', async () => {
  state.rows = [{ value: 'invite:owner:1' }]
  let release!: (value: string) => void
  const pending = new Promise<string>(resolve => { release = resolve })
  state.hash.mockReturnValue(pending)
  state.transaction.mockRejectedValue(new Error('transaction rollback'))
  const admitted = [completeAccountLink(input)]
  try {
    await vi.waitFor(() => expect(state.hash).toHaveBeenCalledTimes(1))
    admitted.push(completeAccountLink(input))
    await vi.waitFor(() => expect(state.hash).toHaveBeenCalledTimes(2))
    await expect(completeAccountLink(input)).rejects.toMatchObject({ status: 429 })
    expect(state.transaction).not.toHaveBeenCalled()
  } finally { release('mock-hash'); await Promise.allSettled(admitted) }
  await expect(completeAccountLink(input)).rejects.toThrow('transaction rollback')
  expect(state.hash).toHaveBeenCalledTimes(3)
})
