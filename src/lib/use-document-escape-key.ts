import { isContextActionMenuOpen } from './context-action-menu-state'
import { isModalDialogOpen } from './modal-layer'
import { useWindowEscapeKey } from './use-window-escape-key'

/** Match the journal: close the top UI first, then selection, then filters. */
export function useDocumentEscapeKey({
  enabled = true, selectedCount = 0, hasFilters, onClearSelection, onClearFilters,
}: {
  enabled?: boolean
  selectedCount?: number
  hasFilters: boolean
  onClearSelection?: () => void
  onClearFilters: () => void
}) {
  useWindowEscapeKey(enabled, event => {
    if (event.defaultPrevented || isModalDialogOpen() || isContextActionMenuOpen()) return
    if (!selectedCount && !hasFilters) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (selectedCount) onClearSelection?.()
    else onClearFilters()
  })
}
