import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus, Trash2, Ruler } from 'lucide-react'
import { schemeDimensionEnds, type SchemeAnchor, type SchemeDimension } from '@/lib/line-schemes'
import { formatSchemeDistance } from '@/lib/line-scheme-dimensions'
import type { SchemeObjectMenuHandler } from '@/lib/line-scheme-interaction'
import { LineSchemeDimensionInput, type DimensionEditing } from './line-scheme-dimension-input'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { LineSchemePanelSearch } from './line-scheme-panel-search'

export function LineSchemeDimensionPanel({ dimensions, anchors, page, editable, measuring, measureFrom, visible, onVisible, editing, onEdit, onAdd, onCancel, onRemove, onMenu }: {
  dimensions: SchemeDimension[]; anchors: SchemeAnchor[]; page: number; editable: boolean; measuring: boolean; measureFrom: string | null;
  visible: boolean; onVisible: (value: boolean) => void; editing: DimensionEditing;
  onEdit: (item: SchemeDimension) => void; onAdd: () => void; onCancel: () => void; onRemove: (item: SchemeDimension) => void; onMenu: SchemeObjectMenuHandler;
}) {
  const viewport = useRef<HTMLDivElement>(null), [search, setSearch] = useState('')
  const names = useMemo(() => new Map(anchors.map(a => [a.key, a.label])), [anchors])
  const title = (item: SchemeDimension) => schemeDimensionEnds(item).map(key => names.get(key) ?? '—').join(' — ')
  const rows = dimensions.filter(item => item.id === editing.item?.id || `${title(item)} ${formatSchemeDistance(item.distanceMm)}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => viewport.current, estimateSize: () => 52, overscan: 5, getItemKey: index => rows[index].id })
  useLayoutEffect(() => { virtualizer.scrollToOffset(0) }, [page, search])
  useLayoutEffect(() => { const index = rows.findIndex(item => item.id === editing.item?.id); if (index >= 0 && editing.surface === 'list') virtualizer.scrollToIndex(index, { align: 'auto' }) }, [editing.item?.id, editing.surface])
  return <>
    <div className="space-y-3 border-b p-3">
      <LineSchemePanelSearch label="Поиск размеров" placeholder="Название или размер, мм" value={search} onChange={setSearch} summary={`Лист ${page} · Всего: ${dimensions.length}`}>
        <Button size="sm" variant={measuring ? 'default' : 'outline'} className="h-8 gap-1 px-2" aria-label="Добавить расстояние" aria-pressed={measuring} disabled={!editable || !!editing.item} onClick={onAdd}><Plus size={14} /> Добавить</Button></LineSchemePanelSearch>
      <label className="flex items-center gap-2 text-xs"><Checkbox checked={visible} onChange={event => onVisible(event.target.checked)} /> Показывать размеры</label>
      {measuring && <div className="rounded-lg bg-sky-50 p-3 text-xs text-sky-800" role="status">{measureFrom ? 'Выберите второй стык или обозначение.' : 'Выберите первый стык или обозначение.'}<button className="mt-2 block underline" onClick={onCancel}>Отменить выбор</button></div>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-2" ref={viewport} aria-label="Список размеров" tabIndex={0}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(row => { const item = rows[row.index], active = editing.item?.id === item.id; return <div key={item.id} className="absolute left-0 top-0 w-full pb-1" style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
          <div onContextMenu={event => { if ((event.target as Element).closest('input')) return; event.preventDefault(); event.stopPropagation(); onMenu('dimension', item.id, event) }}
            onKeyDown={event => { if (!(event.target as Element).closest('input') && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) { event.preventDefault(); event.stopPropagation(); onMenu('dimension', item.id, event) } }} className={`flex h-full items-center gap-1 rounded-lg border px-2 ${active ? 'border-sky-200 bg-sky-50' : 'border-slate-100 bg-slate-50'}`}>
            <button className="min-w-0 flex-1 truncate text-left text-xs text-slate-600" title={title(item)} aria-label={`Размер ${title(item)}`} onClick={() => onEdit(item)}>{title(item)}</button>
            {active && editing.surface === 'list' ? <LineSchemeDimensionInput key={item.id} item={item} editing={editing} /> : <button className="shrink-0 rounded px-1 py-2 text-xs font-medium tabular-nums hover:bg-sky-50" aria-label={`Изменить размер ${title(item)}`} onClick={() => onEdit(item)}>{item.distanceMm > 0 ? formatSchemeDistance(item.distanceMm) : '…'} <span className="font-normal text-slate-400">мм</span></button>}
            <Button variant="ghost" size="icon" className="h-7 w-6 shrink-0 text-slate-400 hover:text-rose-600" aria-label={`Удалить размер ${title(item)}`} disabled={!editable} onClick={() => onRemove(item)}><Trash2 size={13} /></Button>
          </div>
        </div> })}
      </div>
      {!rows.length && <div className="p-5 text-center text-xs leading-5 text-slate-400"><Ruler size={22} className="mx-auto mb-2" />{dimensions.length ? 'Нет подходящих размеров' : 'Нажмите «Добавить» и выберите два стыка или обозначения на чертеже.'}</div>}
    </div>
  </>
}
