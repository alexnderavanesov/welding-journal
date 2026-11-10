import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, Minus, Plus, RotateCw, Scan, MoveHorizontal } from 'lucide-react'
import type { PdfCamera } from '@/lib/line-scheme-pdf-camera'
import { ContextActionMenu } from './context-action-menu'
import { Select } from './ui/select'

export const SCHEME_VIEW_MENU = 'scheme-view-menu'
/** Viewing state stays outside the PDF/marker tree; dimming only composes the
 * existing raster. Footer and context menu operate on this same camera/state. */
export function LineSchemeViewControls({ frame, target, camera, page, children }: {
  frame: RefObject<HTMLDivElement | null>; target: HTMLElement | null; camera: PdfCamera | null; page: number; children: ReactNode;
}) {
  const [percent, setPercent] = useState(100)
  const [menu, setMenu] = useState<{ x: number; y: number; anchorElement: HTMLElement } | null>(null)
  useLayoutEffect(() => { frame.current?.style.setProperty('--scheme-drawing-opacity', String(percent / 100)) }, [frame, percent])
  useEffect(() => {
    const element = frame.current
    const open = (event: Event) => { if (camera) { camera.stop(); setMenu((event as CustomEvent).detail) } }
    element?.addEventListener(SCHEME_VIEW_MENU, open)
    return () => element?.removeEventListener(SCHEME_VIEW_MENU, open)
  }, [frame, camera])
  useEffect(() => { setMenu(null) }, [camera])
  const close = () => { menu?.anchorElement.focus({ preventScroll: true }); setMenu(null) }
  return <>
    {target && createPortal(<div className="line-scheme-pdf-toolbar" aria-label="Управление PDF" data-pdf-current-page={page} data-pdf-flow="paged">
      <label className="line-scheme-tool-group gap-1 pl-2" title="Меньше значение — бледнее PDF. Точки и подписи сохраняют яркость."><span className="whitespace-nowrap text-slate-500">Фон PDF</span>
        <Select aria-label="Видимость чертежа" className="h-8 w-20 border-0 bg-transparent py-0 text-xs shadow-none" value={percent} onChange={event => setPercent(Number(event.target.value))}>{[10, 30, 60, 100].map(value => <option key={value} value={value}>{value}%</option>)}</Select>
      </label>{children}
    </div>, target)}
    <ContextActionMenu autoFocus="panel" closeOnEscapeWithModal onClose={close} menu={menu && camera ? { ...menu, heading: 'Чертёж', items: [
      { id: 'view', label: 'Вид чертежа', icon: Scan, onSelect: () => {}, children: [
      { id: 'in', label: 'Увеличить', icon: Plus, onSelect: () => camera.zoom(1.2, menu) },
      { id: 'out', label: 'Уменьшить', icon: Minus, onSelect: () => camera.zoom(1 / 1.2, menu) },
      { id: 'page', label: 'Весь лист', icon: Scan, onSelect: () => camera.fit('fit-page') },
      { id: 'width', label: 'По ширине', icon: MoveHorizontal, onSelect: () => camera.fit('fit-width') },
      { id: 'rotate', label: 'Повернуть на 90°', icon: RotateCw, onSelect: () => camera.rotate() },
      ] },
      { id: 'background', label: `Фон PDF · ${percent}%`, onSelect: () => {}, children: [10, 30, 60, 100].map(value => ({ id: String(value), label: `${value}%`, icon: value === percent ? Check : undefined, onSelect: () => setPercent(value) })) },
    ] } : null} />
  </>
}
