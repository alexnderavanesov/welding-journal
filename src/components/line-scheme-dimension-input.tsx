import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Check, X } from 'lucide-react'
import type { SchemeDimension } from '@/lib/line-schemes'
import { parseSchemeDistance } from '@/lib/line-scheme-dimensions'

export type DimensionEditing = {
  item: SchemeDimension | null; surface: 'list' | 'drawing'; editable: boolean;
  buffer: RefObject<{ id: string; value: string } | null>;
  onApply: (item: SchemeDimension) => void; onCancel: () => void; onDirty: (dirty: boolean) => void;
}
/** Raw typing stays local; the drawing doesn't rerender on every keystroke. */
export function LineSchemeDimensionInput({ item, editing }: { item: SchemeDimension; editing: DimensionEditing }) {
  const initial = item.distanceMm > 0 ? String(item.distanceMm).replace('.', ',') : ''
  const [value, setValue] = useState(editing.buffer.current?.id === item.id ? editing.buffer.current.value : initial)
  const [error, setError] = useState(''), input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select() }, [])
  return <form aria-label="Расстояние между точками" className="relative flex shrink-0 items-center gap-1" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); editing.onCancel() } }}
    onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (!editing.editable) return; try { editing.onApply({ ...item, distanceMm: parseSchemeDistance(value) }) } catch (reason) { setError((reason as Error).message) } }}>
    <input ref={input} aria-label="Расстояние, мм" aria-invalid={!!error} disabled={!editing.editable} inputMode="decimal" placeholder="мм" value={value}
      className="h-7 w-[76px] rounded border border-sky-300 bg-white px-1.5 text-xs tabular-nums outline-none focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
      onChange={event => { setValue(event.target.value); editing.buffer.current = { id: item.id, value: event.target.value }; setError(''); editing.onDirty(item.distanceMm <= 0 || event.target.value !== initial) }} />
    <button type="submit" aria-label="Применить размер" title="Enter — применить" disabled={!editing.editable} className="rounded p-1 text-sky-700 hover:bg-sky-100"><Check size={14} /></button>
    <button type="button" aria-label="Отменить ввод размера" title="Escape — отменить" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={editing.onCancel}><X size={14} /></button>
    {error && <span role="alert" className="absolute right-0 top-full z-20 mt-1 w-52 whitespace-normal rounded border border-rose-200 bg-white p-2 text-xs text-rose-700 shadow">{error}</span>}
  </form>
}
