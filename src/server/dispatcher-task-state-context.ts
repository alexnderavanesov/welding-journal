import { parseDispatcherTaskIndexPayload } from '@/lib/dispatcher-task-index-payload'
import type { JointChainContinuation } from '@/lib/dispatcher-types'

type DispatcherTaskState = { readonly repeatedTasks: string }
type DispatcherTaskStateContext = {
  readonly version: number
  readonly chainContinuations: readonly JointChainContinuation[]
}

// Server read contexts share the same state object within one snapshot. An
// explicitly supplied earlier read may share its parsed context only when the
// complete payload strings still match. No lookup by string/revision and no
// cached freshness verdict: each database read keeps its own metadata/guards.
// Weak keys release this context with its states, without retaining task pages.
const contexts = new WeakMap<DispatcherTaskState, {
  raw: string
  context: DispatcherTaskStateContext
}>()

/** Read-only consumers only: never mutate the returned continuation records. */
export function readDispatcherTaskStateContext(state: DispatcherTaskState, sourceState?: DispatcherTaskState): DispatcherTaskStateContext {
  const raw = state.repeatedTasks
  const cached = contexts.get(state)
  if (cached?.raw === raw) return cached.context

  const source = sourceState && contexts.get(sourceState)
  if (sourceState && source && source.raw === sourceState.repeatedTasks && source.raw === raw) {
    // Keep the target's own string, so a longer-lived target does not retain
    // both independent pg-decoded strings after the source object is released.
    contexts.set(state, { raw, context: source.context })
    return source.context
  }

  const payload = parseDispatcherTaskIndexPayload(raw)
  const context = { version: payload.version, chainContinuations: payload.chainContinuations }
  contexts.set(state, { raw, context })
  return context
}
