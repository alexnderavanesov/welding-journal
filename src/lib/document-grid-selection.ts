type DocumentRow = { id: string | number }

export type LoadedDocumentGridRow<T extends DocumentRow> = { document: T; groupIds: string[] }
export type DocumentGridGroupSelection = { loaded: number; selected: number }

/** One pass over cached leaves, including every ancestor of nested groups. */
export function documentGridGroupSelection<T extends DocumentRow>(rows: readonly LoadedDocumentGridRow<T>[], selected: ReadonlySet<string>) {
  const groups = new Map<string, DocumentGridGroupSelection>()
  for (const { document, groupIds } of rows) {
    for (const id of groupIds) {
      const state = groups.get(id) ?? { loaded: 0, selected: 0 }
      state.loaded++
      if (selected.has(String(document.id))) state.selected++
      groups.set(id, state)
    }
  }
  return groups
}

/** A loaded-row operation never removes explicit selections outside its scope. */
export function mergeLoadedDocumentGridSelection<T extends DocumentRow>(previous: readonly T[], loaded: readonly T[], selectedIds: ReadonlySet<string>): T[] {
  const selected = new Map(previous.map(row => [String(row.id), row]))
  for (const row of loaded) selectedIds.has(String(row.id)) ? selected.set(String(row.id), row) : selected.delete(String(row.id))
  return [...selected.values()]
}

export function toggleLoadedDocumentGridSelection<T extends DocumentRow>(previous: readonly T[], loaded: readonly T[]): T[] {
  const selected = new Set(previous.map(row => String(row.id)))
  const remove = loaded.length > 0 && loaded.every(row => selected.has(String(row.id)))
  return mergeLoadedDocumentGridSelection(previous, loaded, remove ? new Set() : new Set(loaded.map(row => String(row.id))))
}
