import { describe, expect, it } from 'vitest'
import { loadRebuildWeldFacts } from './system-document-rebuild-facts'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

describe('document fact snapshots', () => {
  it('keeps fact revisions stable when PostgreSQL returns the same rows in a different order', async () => {
    const first = { id: 1, joint: 'А', psto_request: 'Заявка №10', psto_request_date: '2026-10-09' }
    const second = { id: 2, joint: 'Б', psto_request: 'Заявка №11', psto_request_date: '2026-10-09' }
    const transaction = (facts: Array<Record<string, unknown>>) => ({
      select: () => ({ from: () => ({ where: async () => facts.map(fact => ({ facts: fact })) }) }),
    }) as unknown as SystemDocumentSequenceTransaction

    const forward = await loadRebuildWeldFacts(transaction([first, second]), [1, 2])
    const backward = await loadRebuildWeldFacts(transaction([second, first]), [1, 2])
    expect(backward.map(item => item.row.id)).toEqual([1, 2])
    expect(backward).toEqual(forward)
    const changed = await loadRebuildWeldFacts(transaction([first, { ...second, joint: 'Изменённый' }]), [1, 2])
    expect(changed[1].revision).not.toBe(forward[1].revision)
  })
})
