import { useRef, type Key, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

const VIRTUALIZATION_THRESHOLD = 20
const FALLBACK_RENDER_COUNT = 12

type DialogVirtualizedRowsProps<T> = {
  items: readonly T[]
  footer: ReactNode
  estimateRowHeight?: number
  getItemKey: (item: T) => Key
  renderItem: (item: T) => ReactNode
}

export function DialogVirtualizedRows<T>({
  items,
  footer,
  estimateRowHeight = 68,
  getItemKey,
  renderItem,
}: DialogVirtualizedRowsProps<T>) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const enabled = typeof window !== 'undefined' && items.length > VIRTUALIZATION_THRESHOLD
  const virtualizer = useVirtualizer({
    count: items.length,
    enabled,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => estimateRowHeight,
    getItemKey: (index) => {
      const item = items[index]
      return item === undefined ? index : getItemKey(item)
    },
    overscan: 4,
    initialRect: { width: 960, height: 360 },
  })

  const virtualItems = virtualizer.getVirtualItems()
  const fallbackIndexes = enabled && virtualItems.length === 0
    ? Array.from({ length: Math.min(items.length, FALLBACK_RENDER_COUNT) }, (_, index) => index)
    : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable]">
        {enabled ? (
          <div
            className="relative w-full"
            style={{ height: `${Math.max(virtualizer.getTotalSize(), fallbackIndexes.length * estimateRowHeight)}px` }}
          >
            {(virtualItems.length > 0 ? virtualItems : fallbackIndexes.map((index) => ({
              index,
              key: getItemKey(items[index] as T),
              start: index * estimateRowHeight,
            }))).map((virtualItem) => {
              const item = items[virtualItem.index]
              if (item === undefined) return null
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualItems.length > 0 ? virtualizer.measureElement : undefined}
                  className="absolute left-0 top-0 w-full border-b border-slate-100 last:border-b-0"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {renderItem(item)}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">{items.map((item) => (
            <div key={getItemKey(item)}>{renderItem(item)}</div>
          ))}</div>
        )}
      </div>
      {footer}
    </div>
  )
}
