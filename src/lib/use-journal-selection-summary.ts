import { useEffect, useState } from 'react'
import { summarizeJournalGridArea, summarizeJournalGridSelection } from '@/server/journal-grid-api'
import type { JournalSelectionSummary, JournalSummaryRange } from './journal-selection-summary'
import { journalReadErrorMessage } from './journal-read-error'

export function useJournalSelectionSummary(ids: ReadonlySet<number>, identity: string | undefined, ready: boolean, range: JournalSummaryRange = null, recoverRevision?: (error: unknown) => boolean) {
  const [attempt, setAttempt] = useState(0)
  const basis = range ?? ids
  const [state, setState] = useState<{ basis: typeof basis; identity: string; attempt: number; summary?: JournalSelectionSummary; error?: string }>()
  useEffect(() => {
    if (!identity || !ready || range?.error || (range ? !range.request : !ids.size)) return
    const controller = new AbortController()
    // Coalesce dragging/checkbox changes. Area IDs remain on the server.
    const timer = setTimeout(() => {
      const pending = range?.request
        ? summarizeJournalGridArea({ data: range.request, signal: controller.signal })
        : summarizeJournalGridSelection({ data: { ids: [...ids] }, signal: controller.signal })
      void pending.then(summary => {
        if (!controller.signal.aborted) setState({ basis, identity, attempt, summary })
      }).catch(error => {
        if (!controller.signal.aborted && !recoverRevision?.(error)) setState({ basis, identity, attempt, error: journalReadErrorMessage(error) })
      })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [basis, identity, ready, attempt, recoverRevision])
  const current = ready && state?.basis === basis && state.identity === identity && state.attempt === attempt ? state : undefined
  return { summary: current?.summary, error: range?.error ?? current?.error, retry: () => setAttempt(value => value + 1) }
}
