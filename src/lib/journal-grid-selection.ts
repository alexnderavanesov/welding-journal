import type { GridApi, IRowNode } from 'ag-grid-community'

/** Reconcile explicit leaf selection without visiting every loaded journal row. */
export function restoreJournalGridSelection<T extends { id: number }>(
  api: Pick<GridApi<T>, 'getSelectedNodes' | 'getRowNode' | 'setNodesSelected'>,
  selectedIds: ReadonlySet<number>,
) {
  const deselect = api.getSelectedNodes().filter(node => node.data && !node.group && !selectedIds.has(node.data.id))
  const select: IRowNode<T>[] = []
  for (const id of selectedIds) {
    const node = api.getRowNode(String(id))
    // Selection may include records outside the loaded pages. Keep those IDs,
    // but apply native selection only to the leaves that currently exist.
    if (node?.data && !node.group && node.isSelected() !== true) select.push(node)
  }
  // Group checkbox totals are calculated once for each batch, not per row.
  if (deselect.length) api.setNodesSelected({ nodes: deselect, newValue: false })
  if (select.length) api.setNodesSelected({ nodes: select, newValue: true })
}
