import { describe, expect, it, vi } from 'vitest'
import { appSettings } from '@/db/schema'
import { readSpecialistDefaults, rememberSpecialistDefaults } from './specialist-defaults'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

function setup(archived = false) {
  let preferences = { lnkConclusionVik: { first: 1, second: 1 }, pstoConclusion: { first: null, second: null } }
  const records = [{ id: 1, name: 'Иванов', kind: 'inspector', methods: ['ВИК'], certificate: '123', revision: 1, archived }]
  const selected = vi.fn((table: unknown) => table === appSettings ? [{ value: JSON.stringify(preferences) }] : records)
  const write = vi.fn(async (value: string) => { preferences = JSON.parse(value) })
  const mock = {
    select: vi.fn(() => ({ from(table: unknown) {
      const result = selected(table)
      const chain = { where: () => chain, orderBy: () => chain, for: async () => result, then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve) }
      return chain
    } })),
    insert: vi.fn(() => ({ values: ({ value }: { value: string }) => ({ onConflictDoUpdate: () => write(value) }) })),
  }
  return { tx: mock as unknown as SystemDocumentSequenceTransaction, selected, write }
}

describe('specialist defaults persistence', () => {
  it('loads all methods with only one settings read and one batched registry read', async () => {
    const { tx, selected } = setup()
    expect((await readSpecialistDefaults(tx)).specialistDefaults.lnkConclusionVik).toEqual({ first: 1, second: 1 })
    expect(selected).toHaveBeenCalledTimes(2)
  })
  it('keeps other methods, remembers an empty pair, and skips identical writes', async () => {
    const { tx, write } = setup()
    await rememberSpecialistDefaults(tx, 'lnkConclusionVik', { first: 1, second: 1 })
    expect(write).not.toHaveBeenCalled()
    await rememberSpecialistDefaults(tx, 'lnkConclusionVik', { first: null, second: null })
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ lnkConclusionVik: { first: null, second: null }, pstoConclusion: { first: null, second: null } })
    expect((await readSpecialistDefaults(tx)).specialistDefaults.lnkConclusionVik).toEqual({ first: null, second: null })
  })
  it('never persists stale archived or ineligible defaults, including when all documents have individual overrides', async () => {
    const { tx, write } = setup(true)
    await expect(rememberSpecialistDefaults(tx, 'lnkConclusionVik', { first: 1 })).rejects.toThrow('архивирован')
    expect(write).not.toHaveBeenCalled()
    expect((await readSpecialistDefaults(tx)).specialistDefaults.lnkConclusionVik).toEqual({ first: null, second: null })
  })
})
