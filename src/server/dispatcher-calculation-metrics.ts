import { channel } from 'node:diagnostics_channel'

// Opt-in, aggregate diagnostics only. No identifiers, facts or credentials;
// no logging, timers, queries or retained history in the application itself.
export type DispatcherCalculationMetrics = ReturnType<typeof startDispatcherCalculationMetrics>

export function startDispatcherCalculationMetrics() {
  if (typeof window !== 'undefined') return undefined
  const diagnostics = channel('welding.dispatcher.full-calculation')
  if (!diagnostics.hasSubscribers) return undefined
  const started = performance.now()
  const stages: Record<string, { milliseconds: number; visits: number }> = {}
  let previous = started
  let current = 'initialization'
  const mark = (stage: string) => {
    const now = performance.now()
    const total = stages[current] ??= { milliseconds: 0, visits: 0 }
    total.milliseconds += now - previous
    total.visits++
    previous = now
    current = stage
  }
  return {
    mark,
    finish(outcome: 'completed' | 'failed') {
      mark('finished')
      diagnostics.publish({ outcome, milliseconds: performance.now() - started, stages })
    },
  }
}
