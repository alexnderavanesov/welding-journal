import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { isTopModalDialog } from '@/lib/modal-layer'

/** Only the hovered annotation mounts this tooltip; empty notes mount nothing. */
export function LineSchemeNote({ text, anchor, onClose }: { text: string; anchor: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopModalDialog(anchor)) return
      event.preventDefault(); event.stopImmediatePropagation(); onClose()
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [anchor, onClose])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const box = anchor.getBoundingClientRect(), tip = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(innerWidth - tip.width - 8, box.left))}px`
    element.style.top = `${Math.max(8, box.bottom + tip.height + 12 < innerHeight ? box.bottom + 8 : box.top - tip.height - 8)}px`
  }, [anchor, text])
  return createPortal(<div ref={ref} role="tooltip" className="pointer-events-none fixed z-[140] max-h-[60vh] w-max max-w-[min(280px,calc(100vw-16px))] overflow-hidden whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 shadow-lg">{text}</div>, anchor.closest('[data-modal-dialog="true"]') ?? document.body)
}
