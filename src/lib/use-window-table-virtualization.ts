import { useWindowVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, useState } from 'react'

const DEFAULT_THRESHOLD = 80
const DEFAULT_ROW_HEIGHT = 52
const DEFAULT_OVERSCAN = 12
const INITIAL_RENDER_COUNT = 24

type RowWithKey = {
  id?: number
  key?: string
}

type WindowTableVirtualizationOptions<T extends RowWithKey> = {
  rows: T[]
  threshold?: number
  estimateRowHeight?: number
  overscan?: number
}

export function useWindowTableVirtualization<T extends RowWithKey>({
  rows,
  threshold = DEFAULT_THRESHOLD,
  estimateRowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
}: WindowTableVirtualizationOptions<T>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const enabled = typeof window !== 'undefined' && rows.length >= threshold
  const virtualizer = useWindowVirtualizer<HTMLTableRowElement>({
    count: rows.length,
    enabled,
    estimateSize: () => estimateRowHeight,
    getItemKey: (index) => rows[index]?.id ?? rows[index]?.key ?? index,
    overscan,
    scrollMargin,
  })

  useLayoutEffect(() => {
    if (!enabled) return
    const body = bodyRef.current
    if (!body) return

    const updateScrollMargin = () => {
      const next = body.getBoundingClientRect().top + window.scrollY
      setScrollMargin((current) => (Math.abs(current - next) > 0.5 ? next : current))
    }

    updateScrollMargin()
    window.addEventListener('resize', updateScrollMargin)
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateScrollMargin)
    observer?.observe(body)

    return () => {
      window.removeEventListener('resize', updateScrollMargin)
      observer?.disconnect()
    }
  }, [enabled, rows.length])

  useLayoutEffect(() => {
    if (enabled) virtualizer.measure()
  }, [enabled, rows, virtualizer])

  const renderState = buildWindowTableRenderState({
    enabled,
    rows,
    scrollMargin,
    totalSize: virtualizer.getTotalSize(),
    virtualItems: virtualizer.getVirtualItems(),
  })

  return {
    ...renderState,
    bodyRef,
    measureRow: enabled ? virtualizer.measureElement : undefined,
  }
}

export function buildWindowTableRenderState<T>({
  enabled,
  rows,
  scrollMargin,
  totalSize,
  virtualItems,
}: {
  enabled: boolean
  rows: T[]
  scrollMargin: number
  totalSize: number
  virtualItems: VirtualItem[]
}) {
  if (!enabled) {
    return {
      rowIndexes: rows.map((_, index) => index),
      visibleRows: rows,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      virtualized: false,
    }
  }

  if (virtualItems.length === 0) {
    const visibleCount = Math.min(rows.length, INITIAL_RENDER_COUNT)
    const averageSize = rows.length > 0 ? totalSize / rows.length : 0
    return {
      rowIndexes: Array.from({ length: visibleCount }, (_, index) => index),
      visibleRows: rows.slice(0, visibleCount),
      topSpacerHeight: 0,
      bottomSpacerHeight: Math.max(0, totalSize - averageSize * visibleCount),
      virtualized: true,
    }
  }

  const first = virtualItems[0]
  const last = virtualItems[virtualItems.length - 1]
  const rowIndexes = virtualItems.map((item) => item.index)

  return {
    rowIndexes,
    visibleRows: rowIndexes.map((index) => rows[index]).filter((row): row is T => row !== undefined),
    topSpacerHeight: Math.max(0, first.start - scrollMargin),
    bottomSpacerHeight: Math.max(0, totalSize - (last.end - scrollMargin)),
    virtualized: true,
  }
}
