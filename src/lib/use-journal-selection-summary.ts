import { useEffect, useState } from 'react'
import { summarizeJournalGridArea, summarizeJournalGridSelection } from '@/server/journal-grid-api'
import type { JournalSelectionSummary, JournalSummaryRange, JournalSelectionSnapshot } from './journal-selection-summary'
import { journalReadErrorMessage } from './journal-read-error'

export function useJournalSelectionSummary(ids: ReadonlySet<number>, identity: string | undefined, ready: boolean, range: JournalSummaryRange = null, recoverRevision?: (error: unknown) => boolean, expired = false, getSnapshot?: () => JournalSelectionSnapshot | undefined) {
  const [attempt, setAttempt] = useState(0)
  const basis = range ?? ids
  // Regrouping can install a new row revision without changing the selected
  // IDs or filter identity. Totals belong to that revision as well.
  const snapshot = getSnapshot?.()
  const revision = snapshot?.revision
  const [state, setState] = useState<{ basis: typeof basis; identity: string; revision?: JournalSelectionSnapshot['revision']; attempt: number; summary?: JournalSelectionSummary; error?: string }>()
  useEffect(() => {
    if (!identity || !ready || expired || range?.error || (range ? !range.request : !ids.size)) return
    const controller = new AbortController()
    // Coalesce dragging/checkbox changes. Area IDs remain on the server.
    const timer = setTimeout(() => {
      const pending = range?.request
        ? summarizeJournalGridArea({ data: range.request, signal: controller.signal })
        : summarizeJournalGridSelection({ data: { ids: [...ids], ...(getSnapshot ? { snapshot } : {}) }, signal: controller.signal })
      void pending.then(summary => {
        if (!controller.signal.aborted) setState({ basis, identity, revision, attempt, summary })
      }).catch(error => {
        if (!controller.signal.aborted && !recoverRevision?.(error)) setState({ basis, identity, revision, attempt, error: journalReadErrorMessage(error) })
      })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [basis, identity, revision, ready, attempt, recoverRevision, expired, getSnapshot])
  const current = ready && state?.basis === basis && state.identity === identity && state.revision === revision && state.attempt === attempt ? state : undefined
  return { summary: expired ? undefined : current?.summary, error: expired ? 'Обновите таблицу для актуальных итогов.' : range?.error ?? current?.error, retry: () => setAttempt(value => value + 1) }
}
