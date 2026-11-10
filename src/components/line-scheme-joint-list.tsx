import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SCHEME_LEGEND, type SchemeJoint } from '@/lib/line-schemes'
import { Check, Circle, CircleAlert } from 'lucide-react'
import { Button } from './ui/button'

export function LineSchemeJointRow({ joint, placed, selected, placing, onSelect, onInspect }: {
  joint: SchemeJoint; placed: { page: number | null; draft: boolean }; selected: boolean; placing: boolean;
  onSelect: (additive: boolean) => void; onInspect?: () => void;
}) {
  const problem = joint.color === 'error', color = SCHEME_LEGEND[joint.color]
  return <div className={`line-scheme-joint ${placed.page ? 'is-placed' : ''} ${selected ? 'is-selected' : ''}`}>
    <button type="button" data-scheme-placement={placed.page ? placed.draft ? 'draft' : 'saved' : 'unplaced'}
      aria-label={`${joint.label}${placed.page ? ` Лист ${placed.page}` : ''}`} aria-pressed={selected} className="line-scheme-joint-select" onClick={event => { event.currentTarget.focus({ preventScroll: true }); onSelect(event.ctrlKey || event.metaKey) }}
      title={`${joint.reason}${placed.draft ? ' · Изменения не сохранены' : ''}`}>
      <span aria-hidden="true" className="line-scheme-dot" style={{ background: color.fill, borderColor: color.stroke, visibility: problem ? 'hidden' : undefined }} />
      <span className="min-w-0 flex-1 truncate font-medium">{joint.label}</span>
      <span className={`line-scheme-placement ${placed.page || placing ? 'is-placed' : ''}`} aria-hidden="true">{placing ? 'Размещение' : placed.page ? <><Check size={12} /> Лист {placed.page}{placed.draft && <span title="Не сохранено">•</span>}</> : <><Circle size={11} /> Не нанесён</>}</span>
    </button>
    {problem && <button type="button" className="line-scheme-joint-problem" aria-label={`Открыть картину стыка ${joint.label}: проблема состояния`}
      title={`${joint.reason} · ${onInspect ? 'Открыть картину стыка' : 'Просмотр картины недоступен'}`} disabled={!onInspect} onClick={onInspect}><CircleAlert size={14} /></button>}
  </div>
}

export function LineSchemeJointList({ items, resetKey, hasMore, fetching, error, onMore, renderItem }: {
  items: SchemeJoint[]; resetKey: string; hasMore: boolean; fetching: boolean; error: Error | null
  onMore: () => void; renderItem: (item: SchemeJoint) => ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => viewport.current,
    estimateSize: () => 44, overscan: 6, getItemKey: index => items[index].key,
    initialRect: { width: 310, height: 520 } })
  const rows = virtualizer.getVirtualItems(), last = rows.at(-1)?.index ?? -1
  useLayoutEffect(() => { virtualizer.scrollToOffset(0) }, [resetKey])
  useEffect(() => {
    if (hasMore && !fetching && !error && (items.length === 0 || last >= items.length - 8)) onMore()
  }, [last, items.length, hasMore, fetching, error, onMore])
  return <div ref={viewport} className="line-scheme-joint-list" aria-label="Список физических стыков" tabIndex={0}>
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {rows.map(row => <div key={row.key} className="absolute left-0 top-0 w-full" style={{ height: row.size, transform: `translateY(${row.start}px)` }}>{renderItem(items[row.index])}</div>)}
    </div>
    {error ? <div role="alert" className="p-3 text-xs text-red-700">{error.message}<Button size="sm" variant="ghost" onClick={onMore}>Повторить загрузку стыков</Button></div>
      : fetching && !items.length ? <p role="status" className="p-3 text-xs text-slate-500">Загружаем стыки…</p>
        : !items.length ? <p className="p-3 text-xs text-slate-500">Нет подходящих стыков</p> : null}
  </div>
}
