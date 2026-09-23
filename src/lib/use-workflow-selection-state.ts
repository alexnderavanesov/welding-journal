import { useCallback, useReducer, type SetStateAction } from 'react'

import { WORKFLOW_SELECTION_LIMIT, WORKFLOW_SELECTION_LIMIT_MESSAGE } from '@/lib/workflow-selection-limit'

type SelectionState = { ids: Set<number>; warning: string | null }
type SelectionAction = SetStateAction<Set<number>> | 'dismiss-warning'

function initialState(initial: Set<number> | (() => Set<number>)): SelectionState {
  const ids = typeof initial === 'function' ? initial() : initial
  return ids.size > WORKFLOW_SELECTION_LIMIT
    ? { ids: new Set(), warning: WORKFLOW_SELECTION_LIMIT_MESSAGE }
    : { ids, warning: null }
}

function reduceSelection(state: SelectionState, action: SelectionAction): SelectionState {
  if (action === 'dismiss-warning') return state.warning ? { ...state, warning: null } : state
  const ids = typeof action === 'function' ? action(state.ids) : action
  if (ids.size > WORKFLOW_SELECTION_LIMIT) {
    return state.warning === WORKFLOW_SELECTION_LIMIT_MESSAGE
      ? state
      : { ...state, warning: WORKFLOW_SELECTION_LIMIT_MESSAGE }
  }
  // Sync effects deliberately return the same Set when nothing changed.
  // Preserve useState's bailout semantics; otherwise those effects can loop.
  if (ids === state.ids) return state
  return { ids, warning: null }
}

// Keep a rejected batch atomic, including updates queued together by React.
export function useWorkflowSelectionState(initial: Set<number> | (() => Set<number>)) {
  const [state, dispatch] = useReducer(reduceSelection, initial, initialState)
  const dismissWarning = useCallback(() => dispatch('dismiss-warning'), [])
  return [state.ids, dispatch, state.warning, dismissWarning] as const
}
