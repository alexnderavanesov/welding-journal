type DocumentRow = { id: string | number }

export type DocumentGridRowRangeState = { anchorId: string | null; endId: string | null }

export type DocumentGridRowRangeNode<T extends DocumentRow> = {
  id?: string
  rowIndex: number | null
  data?: T
  group?: boolean
  footer?: boolean
  stub?: boolean
  selectable?: boolean
  rowPinned?: string | null
}

type Input<T extends DocumentRow> = {
  nodes: readonly DocumentGridRowRangeNode<T>[]
  selected: readonly T[]
  state: DocumentGridRowRangeState
  targetId: string
  /** Ctrl and Meta have identical range-selection semantics. */
  metaKey?: boolean
}

type LoadedNode<T extends DocumentRow> = DocumentGridRowRangeNode<T> & { id: string; rowIndex: number }

/**
 * Native Shift / Ctrl+Shift row-selection semantics over the bounded cache.
 * A group covers a displayed index but never becomes a selected document.
 * Unknown indices keep AG's single-target fallback; no missing rows are loaded.
 */
export function selectDocumentGridRowRange<T extends DocumentRow>({ nodes, selected, state, targetId, metaKey = false }: Input<T>): {
  selected: T[]
  state: DocumentGridRowRangeState
} {
  const unchanged = () => ({ selected: [...selected], state })
  const loaded = nodes.filter((node): node is LoadedNode<T> => Boolean(node.id) && node.rowIndex != null
    && Number.isSafeInteger(node.rowIndex) && node.rowIndex >= 0 && !node.rowPinned && !node.stub)
  const byId = new Map(loaded.map(node => [node.id, node]))
  const target = byId.get(targetId)
  const isDocument = (node: LoadedNode<T>): node is LoadedNode<T> & { data: T } => Boolean(node.data)
    && !node.group && !node.footer && node.selectable !== false
  if (!target || !isDocument(target)) return unchanged()

  const current = new Map(selected.map(row => [String(row.id), row]))
  const anchor = state.anchorId ? byId.get(state.anchorId) : undefined
  if (!anchor) {
    // Native Ctrl+Shift without a loaded anchor does nothing. Plain Shift
    // selects the clicked row and makes it the next anchor.
    if (metaKey) return unchanged()
    current.set(String(target.data.id), target.data)
    return { selected: [...current.values()], state: { anchorId: target.id, endId: null } }
  }

  const byIndex = new Map(loaded.map(node => [node.rowIndex, node]))
  const ordered = [...byIndex.values()].sort((a, b) => a.rowIndex - b.rowIndex)
  const rangeTo = (end: LoadedNode<T> | undefined): LoadedNode<T>[] | null => {
    if (!end) return null
    const first = Math.min(anchor.rowIndex, end.rowIndex), last = Math.max(anchor.rowIndex, end.rowIndex)
    const range = ordered.filter(node => node.rowIndex >= first && node.rowIndex <= last)
    return range.length === last - first + 1 ? range : null
  }
  const previous = rangeTo(state.endId ? byId.get(state.endId) : undefined) ?? []
  const anchorSelected = Boolean(anchor.data && current.has(String(anchor.data.id)))
  const targetInPrevious = previous.findIndex(node => node.id === target.id)
  let keep: LoadedNode<T>[], discard: LoadedNode<T>[] = []
  let nextState: DocumentGridRowRangeState
  if ((!metaKey || anchorSelected) && targetInPrevious >= 0) {
    // Shortening retains the clicked endpoint's existing state, as AG does.
    const before = previous.slice(0, targetInPrevious), after = previous.slice(targetInPrevious + 1)
    const anchorFirst = previous[0].id === anchor.id
    keep = anchorFirst ? before : after
    discard = anchorFirst ? after : before
    nextState = { anchorId: anchor.id, endId: target.id }
  } else {
    const next = rangeTo(target)
    if (next) {
      keep = next
      if (!next.some(node => node.id === state.endId)) discard = previous
      nextState = { anchorId: anchor.id, endId: target.id }
    } else {
      keep = [target]
      nextState = { anchorId: target.id, endId: null }
    }
  }

  if (metaKey && !anchorSelected) {
    for (const node of keep) if (isDocument(node)) current.delete(String(node.data.id))
  } else {
    if (!anchorSelected) current.clear()
    else for (const node of discard) if (isDocument(node)) current.delete(String(node.data.id))
    for (const node of keep) if (isDocument(node)) current.set(String(node.data.id), node.data)
  }
  return { selected: [...current.values()], state: nextState }
}
