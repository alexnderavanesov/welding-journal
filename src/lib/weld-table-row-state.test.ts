import { describe, expect, it } from 'vitest'

import {
  getWeldTableRowClassName,
  getWeldTableRowTitle,
  getWeldTableStickyCellBackgroundClassName,
} from '@/lib/weld-table-row-state'

describe('weld table row state', () => {
  it('uses one immediate row hover surface instead of animated cell highlights', () => {
    const className = getWeldTableRowClassName({
      rowIndex: 0,
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: false,
      hasDispatcherTask: false,
    })

    expect(className).toContain('weld-table-row--hoverable')
    expect(className).toContain('transition-none')
    expect(className).not.toContain('group')
    expect(
      getWeldTableStickyCellBackgroundClassName({
        rowIndex: 0,
        isHighlighted: false,
        isSelected: false,
        isDuplicate: false,
        hasDispatcherTask: false,
      }),
    ).not.toContain('group-hover')
  })

  it('does not replace selected and system-highlighted row colors on hover', () => {
    const selectedClassName = getWeldTableRowClassName({
      rowIndex: 0,
      readOnly: false,
      isHighlighted: false,
      isSelected: true,
      isDuplicate: false,
      hasDispatcherTask: false,
    })
    const dispatcherClassName = getWeldTableRowClassName({
      rowIndex: 0,
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: false,
      hasDispatcherTask: true,
    })

    expect(selectedClassName).not.toContain('weld-table-row--hoverable')
    expect(dispatcherClassName).not.toContain('weld-table-row--hoverable')
  })

  it('highlights rows with dispatcher tasks', () => {
    const className = getWeldTableRowClassName({
      rowIndex: 0,
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: false,
      hasDispatcherTask: true,
    })

    expect(className).toContain('bg-amber-100')
    expect(
      getWeldTableStickyCellBackgroundClassName({
        rowIndex: 0,
        isHighlighted: false,
        isSelected: false,
        isDuplicate: false,
        hasDispatcherTask: true,
      }),
    ).toContain('bg-amber-100')
    expect(getWeldTableRowTitle({ isHighlighted: false, isDuplicate: false, hasDispatcherTask: true })).toBe(
      'По этому стыку есть активная задача диспетчера',
    )
  })

  it('uses one visual color for duplicates and dispatcher tasks', () => {
    const className = getWeldTableRowClassName({
      rowIndex: 0,
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: true,
      hasDispatcherTask: true,
    })

    expect(className).toContain('bg-amber-100')
    expect(getWeldTableRowTitle({ isHighlighted: false, isDuplicate: true, hasDispatcherTask: true })).toBe(
      'Возможный дубль: совпадают ключевые поля стыка',
    )
  })

  it('keeps hover-like row highlight while context menu is open', () => {
    const className = getWeldTableRowClassName({
      rowIndex: 0,
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: false,
      hasDispatcherTask: false,
      isContextMenuAnchor: true,
    })

    expect(className).toContain('bg-[#cfeeff]')
    expect(
      getWeldTableStickyCellBackgroundClassName({
        rowIndex: 0,
        isHighlighted: false,
        isSelected: false,
        isDuplicate: false,
        hasDispatcherTask: false,
        isContextMenuAnchor: true,
      }),
    ).toContain('bg-[#cfeeff]')
  })

  it('uses a generic hint for temporary system highlights', () => {
    expect(getWeldTableRowTitle({ isHighlighted: true, isDuplicate: false, hasDispatcherTask: false })).toBe(
      'Строка временно выделена системой',
    )
  })

  it('keeps zebra colors tied to source row indexes during virtual scrolling', () => {
    const baseState = {
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: false,
      hasDispatcherTask: false,
    }

    const evenRow = getWeldTableRowClassName({ rowIndex: 10, ...baseState })
    const oddRow = getWeldTableRowClassName({ rowIndex: 11, ...baseState })

    expect(evenRow).toContain('bg-white')
    expect(oddRow).toContain('bg-[#f8fafc]')
    expect(evenRow).not.toContain('odd:')
    expect(oddRow).not.toContain('even:')
    expect(evenRow).toContain('h-[52px]')
  })
})
