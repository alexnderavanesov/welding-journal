import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GridFilterValue, GridValueFilterPanel, type GridFilterOption } from './grid-value-filter'

export function StampCheckReferenceFilter({ title, anchor, options, selected, onChange, onClose }: {
  title: string
  anchor: HTMLButtonElement
  options: GridFilterOption[]
  selected: ReadonlySet<string>
  onChange: (values: string[]) => void
  onClose: (restoreFocus?: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const query = search.trim().toLocaleLowerCase('ru')
  const found = options.filter(option => option.label.toLocaleLowerCase('ru').includes(query))

  useLayoutEffect(() => {
    const panel = popup.current!
    let lastAnchor = anchor.getBoundingClientRect()
    const position = () => {
      const rect = anchor.getBoundingClientRect()
      const header = anchor.closest('thead')?.getBoundingClientRect()
      if (!anchor.isConnected || !anchor.getClientRects().length || rect.bottom < 0 || rect.top > window.innerHeight
        || (header && (rect.right <= header.left || rect.left >= header.right))) {
        onClose(false)
        return
      }
      const bounds = panel.getBoundingClientRect(), { width, height } = bounds
      if (panel.dataset.filterResized) {
        panel.style.left = `${Math.max(12, Math.min(bounds.left + rect.right - lastAnchor.right, window.innerWidth - width - 12))}px`
        panel.style.top = `${Math.max(12, Math.min(bounds.top + rect.bottom - lastAnchor.bottom, window.innerHeight - height - 12))}px`
        lastAnchor = rect
        return
      }
      lastAnchor = rect
      const below = rect.bottom + 8
      const preferredTop = below + height <= window.innerHeight - 12 ? below : rect.top - height - 8
      panel.style.top = `${Math.max(12, Math.min(preferredTop, window.innerHeight - height - 12))}px`
      panel.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`
    }
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !anchor.contains(event.target)) onClose(false)
    }
    position()
    input.current?.focus({ preventScroll: true })
    const observer = new ResizeObserver(position)
    observer.observe(panel)
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('focusin', dismiss)
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('focusin', dismiss)
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', position, true)
    }
  }, [anchor, onClose])

  return createPortal(<div ref={popup} data-filter-popup className="fixed z-[160] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl [&_.journal-filter-values]:h-auto">
    <GridValueFilterPanel title={title} search={search} onSearchChange={setSearch} inputRef={input}
      onClose={() => onClose()} canSelectFound={found.length > 0} onSelectFound={() => onChange(found.map(option => option.value))}
      onReset={() => onChange([])} isFetching={false} isError={false} isLoading={false} onRetry={() => {}} empty={!found.length}>
      {found.map(option => <GridFilterValue key={option.value} option={option} selectedValues={selected} ariaLabel={option.label}
        onToggleValues={values => {
          const next = new Set(selected)
          for (const value of values) next.has(value) ? next.delete(value) : next.add(value)
          onChange([...next])
        }} />)}
    </GridValueFilterPanel>
  </div>, document.body)
}
