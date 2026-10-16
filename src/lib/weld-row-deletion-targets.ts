import type { WeldRow } from './dispatcher-types'
import type { WeldRowVersionTarget } from './weld-row-version'

// Capture the rows the operator saw before password/confirmation can await.
// A lazily loaded menu can include selected rows outside the current page.
export function captureWeldRowDeletionTargets(
  ids: readonly number[],
  rows: readonly WeldRow[],
): WeldRowVersionTarget[] | null {
  const byId = new Map(rows.map(row => [row.id, row]))
  const targets = [...new Set(ids)].map(id => ({
    id,
    version: String(byId.get(id)?.rowVersion ?? '').trim(),
  }))
  return targets.every(target => target.version) ? targets : null
}
