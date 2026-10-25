import { useState } from 'react'

// Capture the current selection on opening AND on every filter transition.
// Returning A -> B -> A must not join an old A fetch with different selected
// IDs. Checkbox changes within the same filter still stay entirely local.
export function useWorkflowQuerySelection(identity: object | null, includeRowIds: number[] = []) {
  const key = JSON.stringify(identity)
  const [selection, setSelection] = useState(() => ({ key, ids: includeRowIds }))
  if (selection.key !== key) {
    const next = { key, ids: includeRowIds }
    setSelection(next)
    return next.ids
  }
  return selection.ids
}
