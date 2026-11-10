import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { SCHEME_LEGEND, type SchemeColor, type SchemePoint } from '@/lib/line-schemes'
import { isTopModalDialog } from '@/lib/modal-layer'

export const SCHEME_POINT_DETAILS_EVENT = 'scheme-point-details'
const statuses: Record<SchemeColor, string> = {
  planned: 'Ещё не сварен', waiting: 'Ожидает завершения', good: 'Годен', rejected: 'Брак · ожидает исправление',
  repair: 'Ремонт выполнен · ожидает НК', inactive: 'Не действует', error: 'Ошибка данных',
}
type Tip = { anchor: HTMLElement; pointId: string; pinned: boolean }

/** One delegated popup for the visible sheet; hovering never fetches data or rerenders its markers. */
export function LineSchemePointTooltip({ frame, points }: { frame: RefObject<HTMLDivElement | null>; points: SchemePoint[] }) {
  const id = useId(), panel = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const byId = useMemo(() => new Map(points.map(point => [point.id, point])), [points])
  const point = tip ? byId.get(tip.pointId) : undefined
  const closeRef = useRef(() => {})
  const keepOpenRef = useRef(() => {})
  useEffect(() => {
    const root = frame.current
    if (!root) return
    let current: Tip | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const close = () => { clearTimeout(timer); current = null; setTip(null) }
    closeRef.current = close
    keepOpenRef.current = () => clearTimeout(timer)
    const marker = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-scheme-point]') : null
    const show = (anchor: HTMLElement, pinned: boolean) => {
      clearTimeout(timer)
      if (!root.contains(anchor) || !isTopModalDialog(anchor)) return
      current = { anchor, pointId: anchor.dataset.schemePoint!, pinned }; setTip(current)
    }
    const enter = (event: MouseEvent) => {
      if (event.buttons || current?.pinned) return
      const anchor = marker(event.target)
      if (!anchor || anchor.contains(event.relatedTarget as Node | null)) return
      clearTimeout(timer)
      timer = setTimeout(() => show(anchor, false), 300)
    }
    const leave = (event: MouseEvent) => {
      if (current?.pinned) return
      const anchor = marker(event.target)
      if (!anchor || anchor.contains(event.relatedTarget as Node | null) || panel.current?.contains(event.relatedTarget as Node | null)) return
      clearTimeout(timer); timer = setTimeout(close, 120)
    }
    const details = (event: Event) => { const anchor = marker(event.target); if (anchor) show(anchor, true) }
    const outside = (event: Event) => { if (!panel.current?.contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !current || !isTopModalDialog(current.anchor)) return
      event.preventDefault(); event.stopImmediatePropagation(); const anchor = current.anchor; close(); anchor.focus({ preventScroll: true })
    }
    root.addEventListener('mouseover', enter)
    root.addEventListener('mouseout', leave)
    root.addEventListener(SCHEME_POINT_DETAILS_EVENT, details)
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('contextmenu', close, true)
    window.addEventListener('dblclick', close, true)
    window.addEventListener('wheel', outside, { capture: true, passive: true })
    window.addEventListener('scroll', outside, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', escape, true)
    return () => {
      clearTimeout(timer)
      root.removeEventListener('mouseover', enter); root.removeEventListener('mouseout', leave)
      root.removeEventListener(SCHEME_POINT_DETAILS_EVENT, details)
      window.removeEventListener('pointerdown', outside, true); window.removeEventListener('contextmenu', close, true)
      window.removeEventListener('dblclick', close, true); window.removeEventListener('wheel', outside, true)
      window.removeEventListener('scroll', outside, true); window.removeEventListener('resize', close)
      window.removeEventListener('keydown', escape, true)
    }
  }, [frame])
  useLayoutEffect(() => {
    if (!tip || !point || !panel.current || !tip.anchor.isConnected) { if (tip) closeRef.current(); return }
    const anchor = tip.anchor.getBoundingClientRect(), box = panel.current.getBoundingClientRect()
    const gap = 10
    setPosition({ left: Math.max(gap, Math.min(anchor.left, window.innerWidth - box.width - gap)),
      top: Math.max(gap, Math.min(anchor.bottom + gap + box.height <= window.innerHeight - gap ? anchor.bottom + gap : anchor.top - box.height - gap, window.innerHeight - box.height - gap)) })
    tip.anchor.setAttribute('aria-describedby', id)
    return () => { if (tip.anchor.getAttribute('aria-describedby') === id) tip.anchor.removeAttribute('aria-describedby') }
  }, [tip, point, id])
  if (!tip || !point) return null
  const { joint } = point, info = joint.weldInfo, color = SCHEME_LEGEND[joint.color]
  const dimension = (value: number | null) => value == null ? '—' : value.toLocaleString('ru-RU')
  const close = () => { closeRef.current(); tip.anchor.focus({ preventScroll: true }) }
  return createPortal(<div ref={panel} id={id} role="tooltip" aria-label={`Сведения о стыке ${joint.label}`}
    data-scheme-point-tooltip data-pinned={tip.pinned} className="line-scheme-point-tooltip" style={position}
    onMouseEnter={() => keepOpenRef.current()} onMouseLeave={() => { if (!tip.pinned) closeRef.current() }}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><div className="text-[11px] text-slate-400">Стык</div><div className="break-words text-sm font-semibold text-slate-800">{joint.label}</div></div>
      {tip.pinned && <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Закрыть сведения о стыке" onClick={close}><X size={16} /></button>}
    </div>
    <div className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-700"><span className="h-2.5 w-2.5 shrink-0 rounded-full border" style={{ background: color.fill, borderColor: color.stroke }} />{statuses[joint.color]}</div>
    {(joint.color === 'inactive' || joint.color === 'error') && <p className="mt-1 text-xs text-slate-500">{joint.reason}</p>}
    {info ? <>
      <dl className="my-3 flex items-center justify-between gap-3 border-y border-slate-100 py-2 text-xs"><dt className="text-slate-500">Дата сварки</dt><dd className="font-medium text-slate-700">{info.date?.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1') || 'Не указана'}</dd></dl>
      <table className="w-full table-fixed text-left text-xs"><caption className="sr-only">Материалы, марки стали и размеры</caption><thead><tr className="text-[11px] font-normal text-slate-400"><th className="w-[68px] font-normal" /><th className="font-normal">Материал / сталь</th><th className="w-[105px] font-normal" title="Диаметр × толщина стенки, мм">Ø × t, мм</th></tr></thead><tbody>
        {([{ element: info.element1, material: info.material1, d: info.d1, t: info.t1 }, { element: info.element2, material: info.material2, d: info.d2, t: info.t2 }]).map(({ element, material, d, t }, index) => <tr key={index}><th className="py-1.5 align-top font-normal text-slate-500">Сторона {index + 1}</th><td className="break-words py-1.5 pr-2 align-top text-slate-700"><div>{element || '—'}</div><div className="mt-0.5 text-[11px] text-slate-500">{material || '—'}</div></td><td className="py-1.5 align-top tabular-nums text-slate-700">{d == null && t == null ? '—' : `Ø ${dimension(d)} × ${dimension(t)}`}</td></tr>)}
      </tbody></table>
      <table className="mt-2 w-full table-fixed border-t border-slate-100 text-left text-xs"><caption className="sr-only">Клейма сварщиков</caption><thead><tr className="text-[11px] text-slate-400"><th className="w-20" /><th className="pt-2 font-normal">Официальное</th><th className="pt-2 font-normal">Фактическое</th></tr></thead><tbody>
        {[[info.stamp1, info.stamp1Fact], [info.stamp2, info.stamp2Fact]].map(([official, factual], index) => <tr key={index}><th className="py-1.5 font-normal text-slate-500">Клеймо_{index + 1}</th><td className="break-words pr-2 font-medium text-slate-700">{official || '—'}</td><td className="break-words text-slate-700">{factual || '—'}</td></tr>)}
      </tbody></table>
    </> : <p className="mt-3 text-xs text-slate-400">Сведения о стыке недоступны.</p>}
  </div>, tip.anchor.closest('[data-modal-dialog="true"]') ?? document.body)
}
