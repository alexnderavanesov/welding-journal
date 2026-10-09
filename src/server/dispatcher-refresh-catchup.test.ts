import { expect, it } from 'vitest'
import { FULL_REBUILD_GENERATION_KIND as kind, getFullRebuildCatchUpScopes } from './dispatcher-refresh-catchup'

const scope = { projectTitle: 'P', subtitleCode: 'S', line: 'L1' }
const state = (sourceRevision: number, items: unknown[]) => ({ sourceRevision, dirtyScopes: JSON.stringify(items) })
const generation = (revision: number) => ({ kind, revision })

it('catches up scoped changes during a full calculation without accepting a later global invalidation', () => {
  expect(getFullRebuildCatchUpScopes(state(7, [generation(7)]), state(9, [generation(7), scope]))).toEqual([scope])
  expect(getFullRebuildCatchUpScopes(state(7, [generation(7)]), state(9, [generation(8), scope]))).toBeNull()
  expect(getFullRebuildCatchUpScopes(state(7, []), state(8, [generation(8)]))).toBeNull()
})
it('handles legacy empty metadata and deleted-line scopes without inventing an untracked change', () => {
  expect(getFullRebuildCatchUpScopes(state(7, []), state(7, []))).toEqual([])
  expect(getFullRebuildCatchUpScopes(state(7, []), state(8, [scope]))).toEqual([scope])
  expect(getFullRebuildCatchUpScopes(state(7, []), state(8, []))).toBeNull()
})
it.each(['broken', '{}', '[null]', '[{"kind":"unknown"}]', JSON.stringify([generation(-1)]),
  JSON.stringify([generation(1), generation(2)]), JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ ...scope, line: String(i) })))])(
  'rejects malformed or unbounded catch-up metadata: %s', dirtyScopes => {
    expect(getFullRebuildCatchUpScopes(state(7, []), { sourceRevision: 8, dirtyScopes })).toBeNull()
  },
)
