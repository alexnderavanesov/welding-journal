import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { copyTextToClipboard } from '@/lib/clipboard'

/** Copy the displayed number, without a label or thousands separators. */
export function JournalSummaryValue({ label, value }: { label: string; value: string | number }) {
  const [notice, setNotice] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setNotice('')
    return () => { generation.current++; clearTimeout(timer.current) }
  }, [value])
  return <span className="relative inline-block">
    <button type="button" className="rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      aria-label={`Скопировать ${label}: ${value}`} title="Копировать число"
      onMouseDown={event => event.preventDefault()}
      onClick={async event => {
        const button = event.currentTarget
        const focused = document.activeElement
        const attempt = ++generation.current
        const copied = await copyTextToClipboard(String(value).replace(/\s/g, '')).catch(() => false)
        if (generation.current !== attempt) return
        if (document.activeElement === document.body && focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true })
        const rect = button.getBoundingClientRect()
        setPosition({ left: Math.max(100, Math.min(window.innerWidth - 100, rect.left + rect.width / 2)), top: Math.max(30, rect.top - 6) })
        setNotice(copied ? 'Скопировано' : 'Не удалось скопировать')
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setNotice(''), 1600)
      }}>{value}</button>
    {notice ? createPortal(<span role="status" style={{ ...position, transform: 'translate(-50%, -100%)', zIndex: 100 }} className="pointer-events-none fixed whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white">{notice}</span>, document.body) : null}
  </span>
}
