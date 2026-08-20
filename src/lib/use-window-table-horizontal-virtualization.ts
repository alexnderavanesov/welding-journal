import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  buildWeldTableFieldSpans,
  getVisibleWeldTableFieldKeys,
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
    const update = () => {
      frame = 0
      const table = tableRef.current
      if (!table) return
      const rect = table.getBoundingClientRect()
      const nextKeys = getVisibleWeldTableFieldKeys({
        spans,
        viewportStart: -rect.left,
        viewportEnd: window.innerWidth - rect.left,
        overscan,
      })
      const signature = nextKeys.join('|')
      if (signature === visibleSignatureRef.current) return
      visibleSignatureRef.current = signature
      setVisibleFieldKeyList(nextKeys)
    }
    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('resize', scheduleUpdate)
    document.addEventListener('scroll', scheduleUpdate, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate)
    if (tableRef.current) observer?.observe(tableRef.current)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleUpdate)
      document.removeEventListener('scroll', scheduleUpdate, true)
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
