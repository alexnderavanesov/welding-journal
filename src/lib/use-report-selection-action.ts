import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'

type ReportSelectionActionOptions = {
  rowsReady: boolean
  isModalOpen?: boolean
  queryIdentity: string
  selectedIds: ReadonlySet<number>
  rows: readonly WeldRow[]
  loadRowsByIds: (ids: number[]) => Promise<WeldRow[]>
  onOpen: (rows: WeldRow[]) => void
  onError: (message: string) => void
}

export function useReportSelectionAction(options: ReportSelectionActionOptions) {
  const selectionKey = useMemo(() => JSON.stringify([...options.selectedIds]), [options.selectedIds])
  // Prepared display arrays are recreated on renders; only IDs/versions are
  // relevant here. Never serialize the full (potentially wide) report rows.
  const rowVersions = useMemo(() => JSON.stringify(options.rows.map(row => [row.id, row.rowVersion ?? null])), [options.rows])
  const scope = {
    ready: options.rowsReady && !options.isModalOpen,
    identity: options.queryIdentity,
    selectionKey,
    rowVersions,
  }
  const latest = useRef(scope)
  if (latest.current.ready !== scope.ready || latest.current.identity !== scope.identity ||
    latest.current.selectionKey !== selectionKey || latest.current.rowVersions !== rowVersions) {
    latest.current = scope
  }
  // Object identity distinguishes A/B/A, including a temporarily stale query
  // or another dialog opened and closed before this request completes.
  const current = latest.current
  const pending = useRef<{ scope: typeof scope } | null>(null)
  const [loading, setLoading] = useState<{ scope: typeof scope } | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const cancel = useCallback(() => {
    pending.current = null
    if (mounted.current) setLoading(null)
  }, [])
  const isCurrent = () => mounted.current && latest.current === current && current.ready
  return {
    scope: current,
    cancel,
    disabled: !current.ready || loading?.scope === current,
    run: async () => {
      if (!isCurrent() || pending.current?.scope === current) return
      const ids = [...options.selectedIds]
      const available = new Map(options.rows.map(row => [row.id, row]))
      if (ids.every(id => available.has(id))) {
        options.onOpen(options.rows.filter(row => options.selectedIds.has(row.id)))
        return
      }
      // A separate token also distinguishes cancel/retry within the same scope.
      const request = { scope: current }
      pending.current = request
      setLoading(request)
      const isRequestCurrent = () => isCurrent() && pending.current === request
      try {
        // Fetch the exact selection as one batch, not the whole report or a
        // partial table intersection. Modal entry must not change user intent.
        const rows = await options.loadRowsByIds(ids)
        if (!isRequestCurrent()) return
        const byId = new Map(rows.map(row => [row.id, row]))
        if (rows.length !== ids.length || byId.size !== ids.length || ids.some(id => !byId.has(id))) {
          throw new Error('Не удалось загрузить все выбранные стыки. Выбор сохранён; обновите данные и повторите действие.')
        }
        options.onOpen(ids.map(id => byId.get(id)!))
      } catch (error) {
        if (isRequestCurrent()) options.onError(error instanceof Error ? error.message : 'Не удалось загрузить выбранные стыки. Повторите действие.')
      } finally {
        if (pending.current === request) {
          pending.current = null
          if (mounted.current) setLoading(null)
        }
      }
    },
  }
}
