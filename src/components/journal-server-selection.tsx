import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import type { ICellRendererParams } from 'ag-grid-community'
import type { WeldRow } from '@/lib/dispatcher-types'
import { journalGroup, journalRouteKey } from '@/lib/journal-server-grid'

export type JournalSelectionContextValue = {
  ids: ReadonlySet<number>
  counts: Record<string, number>
  selectedTotal: number
  /** Exact all/none in this query, also for groups loaded later. */
  uniform?: boolean
  pending: boolean
  toggle: (row?: WeldRow) => void
}
export const JournalServerSelectionContext = createContext<JournalSelectionContextValue | null>(null)
function Checkbox({ checked, partial, disabled, label, onChange }: { checked: boolean; partial: boolean; disabled: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { if (ref.current) ref.current.indeterminate = partial }, [partial])
  return <span className="ag-selection-checkbox journal-server-checkbox"><span className={`ag-checkbox-input-wrapper ${partial ? 'ag-indeterminate' : checked ? 'ag-checked' : ''}`}><input className="ag-input-field-input ag-checkbox-input" ref={ref} type="checkbox" aria-label={label}
    checked={checked} aria-disabled={disabled} aria-busy={disabled}
    onKeyDown={event => { if (event.key === ' ') event.stopPropagation() }}
    onChange={() => { if (!disabled) onChange() }}
    onClick={event => {
      event.stopPropagation()
      // Clicking a checkbox must establish the keyboard return point too,
      // independently of the browser's native mouse-focus preference.
      event.currentTarget.focus({ preventScroll: true })
      if (disabled) event.preventDefault()
    }} /></span></span>
}
export function JournalServerSelectionCell({ data }: ICellRendererParams<WeldRow>) {
  const value = useContext(JournalServerSelectionContext)
  if (!value || !data) return null
  const group = journalGroup(data)
  const total = group?.recordCount ?? 1
  const count = group
    ? value.uniform === true ? total : value.uniform === false ? 0 : value.counts[journalRouteKey(group.route)] ?? 0
    : value.ids.has(data.id) ? 1 : 0
  return <Checkbox checked={count === total && total > 0} partial={count > 0 && count < total} disabled={value.pending}
    label={group ? `Выбрать стыки группы ${group.key || '(Пусто)'}` : `Выбрать стык ${data.joint || data.id}`} onChange={() => value.toggle(data)} />
}
export function JournalServerSelectionHeader() {
  const value = useContext(JournalServerSelectionContext)
  if (!value) return null
  const all = value.uniform === true
  return <Checkbox checked={all} partial={!all && value.selectedTotal > 0} disabled={value.pending}
    label="Выбрать все стыки по текущим фильтрам" onChange={() => value.toggle()} />
}
