import { useEffect } from 'react'

import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'

export function useWorkflowRootCauseEscapeKey({
  active,
  onReturn,
}: {
  active: boolean
  onReturn: () => void
}) {
  useEffect(() => {
    if (!active) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || shouldDeferModalEscape()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onReturn()
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [active, onReturn])
}
