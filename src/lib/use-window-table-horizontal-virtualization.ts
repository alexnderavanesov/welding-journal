import { startTransition, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  buildWeldTableFieldSpans,
  getVisibleWeldTableFieldKeys,
  getWeldTableHorizontalRange,
  type WeldTableHorizontalRange,
} from '@/lib/weld-table-horizontal-window'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'

const DEFAULT_THRESHOLD = 24
const DEFAULT_OVERSCAN = 720

export function useWindowTableHorizontalVirtualization({
  tableRef,
  sections,
  extraColumns,
  leadingWidth,
  threshold = DEFAULT_THRESHOLD,
  overscan = DEFAULT_OVERSCAN,
}: {
  tableRef: RefObject<HTMLTableElement | null>
  sections: WeldTableDisplaySection[]
  extraColumns: WeldTableExtraColumn[]
  leadingWidth: number
  threshold?: number
  overscan?: number
}) {
  const allFieldKeys = useMemo(
    () => sections.flatMap((section) => section.fields.map((field) => field.key as WeldFieldKey)),
    [sections],
  )
  const spans = useMemo(
    () => buildWeldTableFieldSpans({ sections, extraColumns, leadingWidth }),
    [extraColumns, leadingWidth, sections],
  )
  const enabled = typeof window !== 'undefined' && allFieldKeys.length >= threshold
  const [visibleFieldKeyList, setVisibleFieldKeyList] = useState<WeldFieldKey[]>(allFieldKeys)
  const visibleSignatureRef = useRef('')

  useLayoutEffect(() => {
    if (!enabled) {
      visibleSignatureRef.current = allFieldKeys.join('|')
      setVisibleFieldKeyList(allFieldKeys)
      return
    }

    let frame = 0
    let range: WeldTableHorizontalRange | null = null
    const contentEnd = spans.at(-1)?.end ?? 0
    const update = () => {
      frame = 0
      const table = tableRef.current
      if (!table) return
      const rect = table.getBoundingClientRect()
      const viewportStart = -rect.left
      const viewportEnd = window.innerWidth - rect.left
      const nextRange = getWeldTableHorizontalRange({ current: range, viewportStart, viewportEnd, contentEnd, overscan })
      if (nextRange === range) return
      // Initial layout, resizing and jumps outside the buffer cannot wait for a
      // transition. Normal prefetches remain interruptible by the next input.
      const urgent = !range || range.viewportWidth !== nextRange.viewportWidth
        || viewportStart < range.start || viewportEnd > range.end
      range = nextRange
      const nextKeys = getVisibleWeldTableFieldKeys({
        spans,
        viewportStart: range.start,
        viewportEnd: range.end,
        overscan: 0,
      })
      const signature = nextKeys.join('|')
      if (signature === visibleSignatureRef.current) return
      visibleSignatureRef.current = signature
      if (urgent) setVisibleFieldKeyList(nextKeys)
      else startTransition(() => setVisibleFieldKeyList(nextKeys))
    }
    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }
    const onScroll = (event: Event) => {
      if (event.target === document) scheduleUpdate()
    }

    update()
    window.addEventListener('resize', scheduleUpdate)
    document.addEventListener('scroll', onScroll, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate)
    if (tableRef.current) observer?.observe(tableRef.current)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleUpdate)
      document.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [allFieldKeys, enabled, overscan, spans, tableRef])

  const visibleFieldKeys = useMemo(
    () => new Set(enabled ? visibleFieldKeyList : allFieldKeys),
    [allFieldKeys, enabled, visibleFieldKeyList],
  )

  return {
    enabled,
    visibleFieldKeys,
  }
}
