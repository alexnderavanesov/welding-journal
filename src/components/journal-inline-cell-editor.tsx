import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import type { CustomCellEditorProps } from 'ag-grid-react'
import type { WeldRow } from '@/lib/dispatcher-types'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { WeldFormFreeTextField } from './weld-form-field'
import { Button } from './ui/button'

/** Mounted only for the active edit. Reuses the card's suggestion source,
 * debounce, dropdown and free typing; ordinary cells retain their plain renderer. */
export default function JournalInlineCellEditor(props: CustomCellEditorProps<WeldRow>) {
  const field = FIELD_BY_KEY.get(props.column.getColId() as WeldFieldKey)!
  const [draft, setDraft] = useState<WeldInput>(() => ({ ...props.data, [field.key]:
    props.eventKey?.length === 1 ? props.eventKey : props.value ?? '' }))
  const latest = useRef(draft); latest.current = draft
  const fieldRefs = useRef<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>({})
  const change = useCallback((action: SetStateAction<WeldInput>) => {
    const next = typeof action === 'function' ? action(latest.current) : action
    latest.current = next; setDraft(next); props.onValueChange(next[field.key])
  }, [field.key, props.onValueChange])
  useEffect(() => {
    props.onValueChange(latest.current[field.key])
    const input = fieldRefs.current[field.key] as HTMLInputElement | null
    input?.focus({ preventScroll: true })
    if (!props.eventKey || props.eventKey.length !== 1) input?.select()
  }, [])
  return <div className="ag-custom-component-popup journal-inline-editor w-[min(390px,calc(100vw-24px))] rounded-lg border border-sky-200 bg-white p-3 shadow-xl"
    data-testid="journal-inline-editor" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.api.stopEditing(true) }
      else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); props.stopEditing() }
    }}>
    <p className="mb-2 text-xs font-medium text-slate-600">{field.label}</p>
    <WeldFormFreeTextField field={field} draft={draft} suggestionDraft={draft} setDraft={change} fieldRefs={fieldRefs} />
    <div className="mt-2 flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-500">Enter — сохранить · Esc — отменить</span>
      <Button type="button" variant="outline" size="sm" onMouseDown={event => event.preventDefault()} onClick={() => props.stopEditing()}>Сохранить</Button>
    </div>
  </div>
}
