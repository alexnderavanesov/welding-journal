import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContextActionMenuItem, ContextActionMenuState } from '@/components/context-action-menu'
import type { WeldRow } from './dispatcher-types'
import type { WeldFieldKey } from './weld-fields'
import { isModalDialogOpen, MODAL_DIALOG_SELECTOR } from './modal-layer'
import { useReportSelectionAction } from './use-report-selection-action'
import { useStableEventCallback } from './use-stable-event-callback'

type Position = Pick<NonNullable<ContextActionMenuState>, 'x' | 'y' | 'anchorElement' | 'closeOnScroll'>
type Intent = { position: Position; rowId?: number; fieldKey?: WeldFieldKey }
type Options = {
  rowsReady: boolean
  queryIdentity: string
  /** Navigation-only group menus can survive unrelated lazy block loads. */
  customQueryIdentity?: string
  selectedIds: ReadonlySet<number>
  rows: readonly WeldRow[]
  fresh?: boolean
  loadRowsByIds?: (ids: number[]) => Promise<WeldRow[]>
  onError?: (message: string) => void
  getItems: (row: WeldRow, rows: WeldRow[], fieldKey?: WeldFieldKey) => ContextActionMenuItem[] | undefined
}
const unavailable = async (): Promise<WeldRow[]> => { throw new Error('Не удалось загрузить выбранные стыки.') }

/** One explicit exact-selection request; never hydrate a report in the background. */
export function useWeldTableContextMenu(options: Options) {
  const intent = useRef<Intent | null>(null)
  const [stored, setStored] = useState<{ scope: object; menu: ContextActionMenuState; custom?: boolean } | null>(null)
  const customScope = useMemo(() => ({}), [options.customQueryIdentity, options.rowsReady])
  const resolve = useStableEventCallback((rows: WeldRow[]) => {
    const request = intent.current
    if (!request || isModalDialogOpen() || (request.position.anchorElement && !request.position.anchorElement.isConnected)) { close(); return }
    const row = request.rowId == null ? rows[0] : rows.find(row => row.id === request.rowId)
    if (!row) { close(); return }
    const provided = request.fieldKey == null ? options.getItems(row, rows) : options.getItems(row, rows, request.fieldKey)
    const items = provided?.filter((item, index, list) =>
      item.type !== 'separator' || (index > 0 && list[index - 1]?.type !== 'separator' && index < list.length - 1 && list[index + 1]?.type !== 'separator'))
    intent.current = null
    setStored(items?.length ? { scope: action.scope, menu: {
      ...request.position, anchorRowId: row.id, ...getWeldContextMenuIdentity(row, rows), items,
    } } : null)
  })
  const action = useReportSelectionAction({ ...options,
    loadRowsByIds: options.loadRowsByIds ?? unavailable,
    onOpen: resolve,
    onError: message => { close(); options.onError?.(message) },
  })
  const close = useStableEventCallback(() => {
    intent.current = null
    action.cancel()
    setStored(null)
  })
  // The same guard hides an existing menu immediately, including row versions.
  const menu = stored?.scope === (stored?.custom ? customScope : action.scope) && options.rowsReady ? stored.menu : null
  useEffect(() => {
    if (stored?.custom && stored.scope === customScope) return
    close()
  }, [action.scope, customScope, close])
  useEffect(() => {
    if (!menu) return
    // Report backgrounds can be frozen while portals are open. Observe only
    // body roots, not virtualized cells; props alone cannot see a modal A/B/A.
    const observer = new MutationObserver(records => {
      if (isModalDialogOpen() || records.some(record => [...record.addedNodes].some(node =>
        node instanceof Element && (node.matches(MODAL_DIALOG_SELECTOR) || node.querySelector(MODAL_DIALOG_SELECTOR))))) close()
    })
    observer.observe(document.body, { childList: true })
    return () => observer.disconnect()
  }, [menu, close])
  const allSelectedLoaded = useMemo(() => {
    const available = new Set(options.rows.map(row => row.id))
    return [...options.selectedIds].every(id => available.has(id))
  }, [options.rows, options.selectedIds])
  const selectionAvailable = options.rowsReady && (Boolean(options.loadRowsByIds) || allSelectedLoaded)
  const openSelection = useStableEventCallback((position: Position, rowId?: number, fieldKey?: WeldFieldKey) => {
    if (!selectionAvailable || options.selectedIds.size === 0 || isModalDialogOpen()) return
    // Preserve the first pending intent and coalesce repeated opening events.
    if (intent.current) {
      if (intent.current.rowId === rowId && intent.current.fieldKey === fieldKey) return
      close()
    }
    intent.current = { position, rowId, fieldKey }
    setStored({ scope: action.scope, menu: { ...position, anchorRowId: rowId,
      heading: `Выбрано стыков: ${options.selectedIds.size}`,
      items: [{ type: 'label', id: 'selection-loading', label: 'Загружаем выбранные стыки…' }],
    } })
    void action.run()
  })
  const openRow = useStableEventCallback((row: WeldRow, position: Position, fieldKey?: WeldFieldKey) => {
    if (!options.rowsReady || isModalDialogOpen()) return
    if (options.selectedIds.has(row.id)) { openSelection(position, row.id, fieldKey); return }
    close()
    intent.current = { position, rowId: row.id, fieldKey }
    if (options.fresh) {
      setStored({ scope: action.scope, menu: { ...position, anchorRowId: row.id,
        items: [{ type: 'label', id: 'row-loading', label: 'Загружаем стык…' }],
      } })
      void action.run([row.id])
    } else resolve([row])
  })
  const openCustom = useStableEventCallback((custom: NonNullable<ContextActionMenuState>) => {
    if (!options.rowsReady || isModalDialogOpen()) return
    close()
    setStored(options.customQueryIdentity === undefined ? { scope: action.scope, menu: custom }
      : { scope: customScope, menu: custom, custom: true })
  })
  return { menu, close, openRow, openSelection, openCustom, selectionAvailable }
}

function getWeldContextMenuIdentity(row: WeldRow, rows: WeldRow[]) {
  if (rows.length > 1) {
    const lines = new Set(rows.map(row => String(row.line ?? '').trim()).filter(Boolean))
    return { heading: `Выбрано стыков: ${rows.length}`, description: lines.size === 1 ? `Линия ${[...lines][0]}` : 'Групповые действия' }
  }
  const joint = String(row.joint ?? '').trim(), line = String(row.line ?? '').trim()
  return { heading: joint ? `Стык ${joint}` : 'Действия по строке', description: line ? `Линия ${line}` : undefined }
}
