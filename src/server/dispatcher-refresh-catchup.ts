import type { DispatcherDirtyScope } from './dispatcher-task-index-dirty'

// Internal dirty_scopes metadata, not a user-visible task or history entry.
// A new global invalidation replaces this generation and discards old scopes.
export const FULL_REBUILD_GENERATION_KIND = 'full-rebuild-generation'

type State = { sourceRevision: number; dirtyScopes: string | null }

export function getFullRebuildCatchUpScopes(before: State, current: State): DispatcherDirtyScope[] | null {
  if (before.sourceRevision === current.sourceRevision) return []
  const initial = parseDirtyState(before.dirtyScopes), latest = parseDirtyState(current.dirtyScopes)
  if (!initial || !latest || initial.generation !== latest.generation || !latest.scopes.length) return null
  return latest.scopes.length <= 500 ? latest.scopes : null
}

function parseDirtyState(value: string | null) {
  let items: unknown
  try { items = JSON.parse(value ?? '[]') } catch { return null }
  if (!Array.isArray(items)) return null
  let generation = 0
  const scopes: DispatcherDirtyScope[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') return null
    if (item.kind === FULL_REBUILD_GENERATION_KIND) {
      if (generation || !Number.isSafeInteger(item.revision) || item.revision < 1) return null
      generation = item.revision
    } else if (typeof item.projectTitle === 'string' && typeof item.subtitleCode === 'string' && typeof item.line === 'string') {
      scopes.push({ projectTitle: item.projectTitle, subtitleCode: item.subtitleCode, line: item.line })
    } else return null
  }
  return { generation, scopes }
}
