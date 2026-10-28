import { expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { deleteEmptyGeneratedDocuments, loadGeneratedDocumentIdsForWeldDeletion } from './generated-document-cleanup'

it.each([1, 1000, 200000])('captures and cleans %i memberships in two database statements', async count => {
  const ids = Array.from({ length: count }, (_, index) => index + 1)
  const query = vi.fn(async (config: { text: string }) => ({ rows: config.text.startsWith('select distinct') ? ids.map(id => [id]) : [] }))
  const tx = drizzle({ query } as unknown as Client) as unknown as SystemDocumentSequenceTransaction
  const documents = await loadGeneratedDocumentIdsForWeldDeletion(tx, ids)
  expect(documents).toEqual(ids)
  await deleteEmptyGeneratedDocuments(tx, documents)
  expect(query).toHaveBeenCalledTimes(2)
  // One array parameter per scope, not a placeholder or request per record.
  const calls = query.mock.calls as unknown as Array<[{ text: string }, unknown[]]>
  expect(calls.map(([, parameters]) => parameters)).toEqual([[ids], [ids]])
})

it('does no database work when the operation has no deleted welds or affected documents', async () => {
  const tx = {} as SystemDocumentSequenceTransaction
  expect(await loadGeneratedDocumentIdsForWeldDeletion(tx, [])).toEqual([])
  await deleteEmptyGeneratedDocuments(tx, [])
})
