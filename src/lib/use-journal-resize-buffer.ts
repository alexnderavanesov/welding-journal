import { useEffect } from 'react'
import type { ColumnResizedEvent, GridApi } from 'ag-grid-community'

/** Keep ordinary scroll overscan; avoid resizing offscreen DOM during a drag. */
export function useJournalResizeBuffer(api: GridApi | null, enabled: boolean) {
  useEffect(() => {
    if (!api || !enabled) return
    let active = false, interrupted = false, previous: number | undefined
    const restore = () => {
      if (!active) return
      active = false
      if (!api.isDestroyed()) api.setGridOption('rowBuffer', previous)
    }
    const finish = () => { restore(); interrupted = false }
    const interrupt = () => { if (active) { interrupted = true; restore() } }
    const resized = (event: ColumnResizedEvent) => {
      if (event.source !== 'uiColumnResized') return
      if (event.finished !== false) { finish(); return }
      if (active || interrupted) return
      previous = api.getGridOption('rowBuffer')
      active = true
      api.setGridOption('rowBuffer', 0)
    }
    api.addEventListener('columnResized', resized)
    api.addEventListener('dragStopped', finish)
    window.addEventListener('blur', interrupt)
    window.addEventListener('wheel', interrupt, { capture: true, passive: true })
    window.addEventListener('keydown', interrupt, true)
    return () => {
      restore()
      if (!api.isDestroyed()) {
        api.removeEventListener('columnResized', resized)
        api.removeEventListener('dragStopped', finish)
      }
      window.removeEventListener('blur', interrupt)
      window.removeEventListener('wheel', interrupt, true)
      window.removeEventListener('keydown', interrupt, true)
    }
  }, [api, enabled])
}
