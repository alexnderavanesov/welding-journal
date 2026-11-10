import { useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus, Trash2, ArrowLeft } from 'lucide-react'
import { LineSchemePanelSearch } from './line-scheme-panel-search'
import { SCHEME_ANNOTATION_PALETTE, type SchemeAnnotation } from '@/lib/line-schemes'
import type { SchemeObjectMenuHandler } from '@/lib/line-scheme-interaction'
import { AnnotationShape } from './line-scheme-annotation-shape'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Checkbox } from './ui/checkbox'

export function LineSchemeAnnotationPanel({ items, selected, selectionCount = selected.size, editor, adding, placing, page, editable, visible, onVisible, onAdd, onSelect, onRemove, onRemoveSelected, onMenu, onApply, onCancel, onDirty }: {
  items: SchemeAnnotation[]; selected: Set<string>; selectionCount?: number; editor: SchemeAnnotation | null; adding: boolean; placing: boolean; page: number; editable: boolean; visible: boolean;
  onVisible: (value: boolean) => void; onAdd: () => void; onSelect: (item: SchemeAnnotation, additive?: boolean) => void; onRemoveSelected: () => void; onMenu: SchemeObjectMenuHandler; onRemove: (item: SchemeAnnotation) => void;
  onApply: (item: SchemeAnnotation) => void; onCancel: () => void; onDirty: (value: boolean) => void;
}) {
  const savedScroll = useRef(0)
  const viewport = useRef<HTMLDivElement>(null), [search, setSearch] = useState('')
  const rows = items.filter(a => a.label.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => viewport.current, estimateSize: () => 44, overscan: 5, getItemKey: index => rows[index].id })
  useLayoutEffect(() => { savedScroll.current = 0; virtualizer.scrollToOffset(0) }, [page, search])
  useLayoutEffect(() => { if (!editor && viewport.current) viewport.current.scrollTop = savedScroll.current }, [editor?.id])
  if (editor) return <AnnotationEditor key={editor.id} item={editor} adding={adding} editable={editable} onApply={onApply} onCancel={onCancel} onDirty={onDirty} />
  return <>
    <div className="space-y-3 border-b p-3">
      <LineSchemePanelSearch label="Поиск обозначений" placeholder="Найти обозначение" value={search} onChange={setSearch} summary={`Лист ${page} · Всего: ${items.length}`}><Button size="sm" variant="outline" className="h-8 px-2" disabled={!editable || !!editor} onClick={onAdd} aria-label="Добавить обозначение"><Plus size={14} /> Добавить</Button></LineSchemePanelSearch>
      <label className="flex items-center gap-2 text-xs"><Checkbox checked={visible} onChange={event => onVisible(event.target.checked)} /> Показывать обозначения</label>
      {placing && <p className="text-xs text-sky-700">Укажите место на чертеже. <button className="underline" onClick={onCancel}>Отмена</button></p>}
      <p className="text-[11px] text-slate-400">Ctrl / ⌘ + клик — выбрать несколько</p>
    </div>
    <div ref={viewport} onScroll={event => { savedScroll.current = event.currentTarget.scrollTop }} className="min-h-0 flex-1 overflow-auto p-2" aria-label="Список обозначений">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>{virtualizer.getVirtualItems().map(row => { const item = rows[row.index]; return <div key={item.id} className="absolute left-0 top-0 flex w-full items-center gap-2 rounded-lg px-2" style={{ height: row.size - 2, transform: `translateY(${row.start}px)`, background: selected.has(item.id) ? '#f0f9ff' : '#f8fafc' }}>
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs" aria-label={`Обозначение ${item.label}`} aria-pressed={selected.has(item.id)} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onSelect(item, event.ctrlKey || event.metaKey) }}
          onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onMenu('annotation', item.id, event) }}
          onKeyDown={event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); onMenu('annotation', item.id, event) } }}><span className="h-5 w-5 shrink-0"><AnnotationShape item={{ ...item, rotation: 0 }} /></span><span className="truncate">{item.label}</span></button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-rose-600" disabled={!editable} aria-label={`Удалить обозначение ${item.label}`} onClick={() => onRemove(item)}><Trash2 size={13} /></Button>
      </div> })}</div>
      {!rows.length && <p className="p-4 text-center text-xs leading-5 text-slate-400">{items.length ? 'Нет подходящих обозначений' : 'Добавьте точку, треугольник или линию с названием. Размер можно провести от центра обозначения.'}</p>}
    </div>
    {selectionCount > 1 && <div className="flex items-center justify-between gap-2 border-t p-3"><span className="text-xs text-slate-500">Выбрано объектов: {selectionCount}</span><Button variant="outline" size="sm" disabled={!editable} onClick={onRemoveSelected}><Trash2 size={13} /> Убрать выбранные</Button></div>}
  </>
}
function AnnotationEditor({ item, adding, editable, onApply, onCancel, onDirty }: {
  item: SchemeAnnotation; adding: boolean; editable: boolean; onApply: (item: SchemeAnnotation) => void; onCancel: () => void; onDirty: (value: boolean) => void;
}) {
  const [value, setValue] = useState(item), [error, setError] = useState('')
  const change = (patch: Partial<SchemeAnnotation>) => { setValue(old => ({ ...old, ...patch })); onDirty(true); setError('') }
  return <form aria-label="Оформление обозначения" className="flex min-h-0 flex-1 flex-col" onSubmit={event => {
    event.preventDefault(); if (!editable) return
    if (!value.label.trim()) { setError('Введите название обозначения.'); return }
    onApply({ ...value, label: value.label.trim() })
  }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() } }}>
    <div className="flex items-center gap-2 border-b px-3 py-2"><Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Вернуться к списку обозначений" onClick={onCancel}><ArrowLeft size={15} /></Button><h3 className="text-xs font-medium">{adding ? 'Новое обозначение' : 'Оформление обозначения'}</h3></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
    <div className="flex gap-1">{(['dot', 'triangle', 'line'] as const).map(shape => <button key={shape} type="button" disabled={!editable} aria-pressed={value.shape === shape} aria-label={{ dot: 'Точка', triangle: 'Треугольник', line: 'Линия' }[shape]} onClick={() => change({ shape })} className={`flex flex-1 items-center justify-center gap-1 rounded border p-1.5 text-[11px] ${value.shape === shape ? 'border-sky-300 bg-white' : 'border-transparent'}`}><span className="h-4 w-4"><AnnotationShape item={{ ...value, shape, rotation: 0 }} /></span>{{ dot: 'Точка', triangle: 'Треуг.', line: 'Линия' }[shape]}</button>)}</div>
    <label className="grid gap-1.5 text-xs text-slate-500">Название<Input aria-label="Название обозначения" placeholder="Например, опора ОП-12" className="h-8 text-xs" maxLength={120} disabled={!editable} value={value.label} onChange={event => change({ label: event.target.value })} /></label>
    <label className="grid gap-1.5 text-xs text-slate-500">Примечание <span className="sr-only">обозначения</span><textarea aria-label="Примечание обозначения" placeholder="Необязательно · видно при наведении" rows={3} maxLength={1000} disabled={!editable} value={value.note ?? ''} onChange={event => change({ note: event.target.value })} className="w-full resize-y rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 outline-none focus:border-sky-300 disabled:opacity-50" /></label>
    <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-500">Цвет</span><div className="flex gap-2">{SCHEME_ANNOTATION_PALETTE.map(({ color, name }) => <button key={color} type="button" disabled={!editable} aria-label={`Цвет: ${name}`} aria-pressed={value.color === color} onClick={() => change({ color })} className={`h-5 w-5 rounded-full border-2 border-white ${value.color === color ? 'ring-2 ring-sky-300' : ''}`} style={{ background: color }} />)}</div></div>
    <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-500">
      <label>Размер<Select aria-label="Размер обозначения" disabled={!editable} className="mt-1 h-8 px-1 text-xs" value={value.size} onChange={event => change({ size: +event.target.value })}><option value="16">Малый</option><option value="24">Средний</option><option value="32">Крупный</option></Select></label>
      <label>Толщина<Select aria-label="Толщина обозначения" disabled={!editable} className="mt-1 h-8 px-1 text-xs" value={value.strokeWidth} onChange={event => change({ strokeWidth: +event.target.value })}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}</Select></label>
      <label>Поворот, °<Input aria-label="Поворот обозначения" disabled={!editable} className="mt-1 h-8 px-2 text-xs" type="number" step="15" value={value.rotation} onChange={event => { const n = Number(event.target.value); if (Number.isInteger(n)) change({ rotation: (n % 360 + 360) % 360 }) }} /></label>
    </div>
    </div>
    <div className="shrink-0 space-y-2 border-t bg-white p-3">
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    <div className="flex gap-2"><Button type="submit" disabled={!editable} size="sm" className="h-7 text-xs">{adding ? 'Разместить' : 'Применить'}</Button><Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>Отмена</Button></div></div>
  </form>
}
